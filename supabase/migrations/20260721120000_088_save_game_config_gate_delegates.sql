-- 088 — save_game_config: KEY-GATE the delegates write (fixes a LIVE silent-wipe, #625).
--
-- The delegates block was the one list-write NOT gated on key presence. Every sibling —
-- `matches` / `groups` / `participants` — runs only `IF p_payload ? 'key'`, so an absent
-- key means "don't touch". Delegates instead ran on EVERY Organizer save and did
-- `DELETE … ; INSERT … FROM jsonb_array_elements_text(COALESCE(p_payload->'delegates','[]'))`
-- — so an OMITTED key wiped every delegate.
--
-- That is LIVE, not theoretical: the client's `delegates` slice is seeded from
-- `games.listOrganizers` (`serverDelegates = orgQ.data ?? []`), and the payload sends
-- `delegates: draft.delegates` unconditionally. So an Organizer who Saves before that query
-- resolves — or whenever it errors — sends `delegates: []`, read by the old RPC as "clear
-- them all". This is the delegate wipe's THIRD appearance (P1 mirror seeded `[]`; the
-- un-hashed delegates write; now the un-gated wipe).
--
-- Fix: `IF v_is_org AND p_payload ? 'delegates'`. ABSENT key → PRESERVE (the sibling
-- contract); PRESENT `[]` → clear (the deliberate remove-all). Dropped the now-pointless
-- `COALESCE(...,'[]')`. The client follow-up stops SENDING the key on an unchanged/unknown
-- set (so the phantom-empty is never emitted) — this migration lands FIRST so that omit is
-- safe. Everything else is 087 verbatim (CREATE OR REPLACE re-emits the whole body).
--
-- 081–087 applied and immutable; this is a new migration.

CREATE OR REPLACE FUNCTION public.save_game_config(p_trip_id text, p_game_id text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id text;
  v_was_live boolean;
  v_status text;
  v_type text;
  v_cur_entry_mode text;
  v_is_org boolean;
  v_go_live boolean := COALESCE((p_payload->>'scoringEnabled')::boolean, false);
  -- The match SET changed (structure) — NOT a mere field edit. A MISSING flag defaults
  -- true (conservative rebuild); the legacy `matchesDirty` fallback was dropped in 087
  -- (no client sends it anymore).
  v_matches_structure_dirty boolean := COALESCE((p_payload->>'matchesStructureDirty')::boolean, true);
  -- The rack GROUPINGS changed (membership / name / tee_time). Defaults TRUE so an old
  -- or terse client that sends `groups` without the flag is treated conservatively
  -- (rebuild + HAS_SCORES-guarded), never a silent skip.
  v_groups_structure_dirty boolean := COALESCE((p_payload->>'groupsStructureDirty')::boolean, true);
  v_has_scores boolean;
  v_cur_course_id text;
  v_cur_back_course_id text;
  v_cur_schema jsonb;
  v_course_dirty boolean;
  v_match jsonb;
  v_ord int;
  v_mid text;
  v_side_a jsonb;
  v_side_b jsonb;
  v_group jsonb;
  v_gid text;
  v_gord int;
  v_part jsonb;
  v_paired int := 0;
  v_total int := 0;
  v_part_count int := 0;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  -- FOR UPDATE serializes concurrent saves; the optimistic base-config-hash check
  -- lives in the games.saveConfig tRPC front door (reuses computeConfigHash / #16).
  SELECT trip_id, scoring_enabled, status, game_type_id, entry_mode,
         course_id, back_course_id, scorecard_schema
    INTO v_trip_id, v_was_live, v_status, v_type, v_cur_entry_mode,
         v_cur_course_id, v_cur_back_course_id, v_cur_schema
    FROM public.games WHERE id = p_game_id AND trip_id = p_trip_id
    FOR UPDATE;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  v_is_org := public.has_trip_role(v_trip_id, ARRAY['Owner'::text, 'Organizer'::text]);

  -- Scores exist? Computed ONCE — the locked-tier guards below all key on it.
  SELECT EXISTS (SELECT 1 FROM public.score_entries WHERE game_id = p_game_id)
      OR EXISTS (SELECT 1 FROM public.match_hole_outcomes WHERE game_id = p_game_id)
    INTO v_has_scores;

  -- ── Locked-tier guards (uniform: every destroys-tier change refused with scores) ─

  -- ENTRY MODE — orphans entered score/outcome data (match play only; other formats
  -- never send entryMode, so the NULL check skips them).
  IF p_payload->>'entryMode' IS NOT NULL
     AND (p_payload->>'entryMode') IS DISTINCT FROM v_cur_entry_mode
     AND v_has_scores THEN
    RAISE EXCEPTION 'ENTRY_MODE_LOCKED: this game already has scores. Reset scores in the game''s Danger zone before changing how it''s scored.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- COURSE — re-applying par/index would silently rescore. Applies to every golf
  -- format (match / stroke / rack); non-golf never sends course keys.
  v_course_dirty :=
        (p_payload->>'courseId')     IS DISTINCT FROM v_cur_course_id
     OR (p_payload->>'backCourseId') IS DISTINCT FROM v_cur_back_course_id
     OR NULLIF(p_payload->'scorecardSchema', 'null'::jsonb) IS DISTINCT FROM v_cur_schema;
  IF v_course_dirty AND v_has_scores THEN
    RAISE EXCEPTION 'COURSE_LOCKED: this game already has scores. Reset scores in the game''s Danger zone before changing its course.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- MATCHES structure — the clean-replace mints fresh UUIDs that would orphan scores.
  -- Gated on the payload actually carrying matches (085): a rack/stroke save has no
  -- `matches`, so the default-true flag must NOT fire this guard for them.
  IF p_payload ? 'matches' AND v_matches_structure_dirty AND v_has_scores THEN
    RAISE EXCEPTION 'HAS_SCORES: this game already has scores. Reset scores in the game''s Danger zone before changing its matchups.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- GROUPINGS structure (rack, 085) — same clean-replace / orphan concern (#594).
  IF p_payload ? 'groups' AND v_groups_structure_dirty AND v_has_scores THEN
    RAISE EXCEPTION 'HAS_SCORES: this game already has scores. Reset scores in the game''s Danger zone before changing its groupings.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- ── Write the config ────────────────────────────────────────────────────────

  -- 1 · Scalar game columns. points_total is Organizer-only. Each format sends the
  -- FULL config it owns; a key it doesn't own is absent → its column resets to the
  -- honest empty for that format (non-golf → null course/schema, {} modifiers).
  UPDATE public.games SET
      name                = COALESCE(NULLIF(btrim(p_payload->>'name'), ''), name),
      rules_for_today     = p_payload->>'rulesForToday',
      entry_mode          = COALESCE(p_payload->>'entryMode', entry_mode),
      modifiers           = COALESCE(NULLIF(p_payload->'modifiers', 'null'::jsonb), '{}'::jsonb),
      points_total        = CASE WHEN v_is_org
                                 THEN NULLIF(p_payload->>'pointsTotal', '')::numeric
                                 ELSE points_total END,
      points_distribution = NULLIF(p_payload->'pointsDistribution', 'null'::jsonb),
      course_id           = p_payload->>'courseId',
      back_course_id      = p_payload->>'backCourseId',
      scorecard_schema    = NULLIF(p_payload->'scorecardSchema', 'null'::jsonb),
      -- competition_format (086) — non-golf's Quiet-tier structure label (head-to-head /
      -- bracket / best-of-N / live-results). COALESCE-PRESERVE (not the unconditional
      -- overwrite the other scalars use): the golf formats never send it, so absent must
      -- KEEP the existing value, never null it. Non-golf sends it explicitly to change it.
      -- Already hashed (GAME_CONFIG_COLS); this is the write side catching up so a format
      -- edit can ride the atomic Save as a draft slice instead of a live games.update.
      competition_format  = COALESCE(p_payload->>'competitionFormat', competition_format)
    WHERE id = p_game_id AND trip_id = p_trip_id;

  -- 2 · Matches — the STRUCTURE / FIELDS split (match play only; gated on the key).
  IF p_payload ? 'matches' THEN
    IF v_matches_structure_dirty THEN
      -- STRUCTURE changed → clean-replace. (HAS_SCORES already refused above.)
      -- children reference play_groups ON DELETE SET NULL, so clear children first.
      DELETE FROM public.game_matches WHERE game_id = p_game_id;
      DELETE FROM public.game_participants WHERE game_id = p_game_id;
      DELETE FROM public.play_groups WHERE game_id = p_game_id;

      v_ord := 0;
      FOR v_match IN SELECT jsonb_array_elements(COALESCE(p_payload->'matches', '[]'::jsonb))
      LOOP
        INSERT INTO public.game_matches
          (id, game_id, play_group_id, match_number, display_order, side_a, side_b, status, point_value)
        VALUES (
          gen_random_uuid()::text,
          p_game_id,
          NULL,
          COALESCE((v_match->>'matchNumber')::int, v_ord + 1),
          v_ord,
          public._write_game_side(p_game_id, v_match->'a', COALESCE((v_match->>'strokesA')::int, 0)),
          public._write_game_side(p_game_id, v_match->'b', COALESCE((v_match->>'strokesB')::int, 0)),
          'pending',
          NULLIF(v_match->>'pointValue', '')::numeric
        );
        v_ord := v_ord + 1;
      END LOOP;
    ELSE
      -- FIELDS only (same set): UPDATE handicap + point_value in place, roster verified
      -- under the lock. No HAS_SCORES guard: warned tier.
      FOR v_match IN SELECT jsonb_array_elements(COALESCE(p_payload->'matches', '[]'::jsonb))
      LOOP
        SELECT id, side_a, side_b INTO v_mid, v_side_a, v_side_b
          FROM public.game_matches
         WHERE game_id = p_game_id
           AND match_number = COALESCE((v_match->>'matchNumber')::int, -1);

        IF v_mid IS NULL
           OR public._game_side_members(p_game_id, v_side_a)
                IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(v_match->'a') ORDER BY 1)
           OR public._game_side_members(p_game_id, v_side_b)
                IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(v_match->'b') ORDER BY 1)
        THEN
          RAISE EXCEPTION 'STRUCTURE_MISMATCH: this game changed on another device — reload before saving.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
        END IF;

        UPDATE public.game_matches
           SET point_value = NULLIF(v_match->>'pointValue', '')::numeric
         WHERE id = v_mid;

        PERFORM public._write_side_handicap(p_game_id, v_side_a, COALESCE((v_match->>'strokesA')::int, 0));
        PERFORM public._write_side_handicap(p_game_id, v_side_b, COALESCE((v_match->>'strokesB')::int, 0));
      END LOOP;
    END IF;
  END IF;

  -- 2b · Groupings (rack, 085) — the STRUCTURE unit. Locked-tier guard already refused
  -- a change with scores. On a real change, mirror setFoursomes: upsert the roster
  -- union (keeps existing rows + their scores), rebuild play_groups, reassign. Skipped
  -- when nothing changed → a no-op save leaves play_groups byte-identical.
  IF p_payload ? 'groups' AND v_groups_structure_dirty THEN
    INSERT INTO public.game_participants (id, game_id, user_id, play_group_id, team_id)
    SELECT gen_random_uuid()::text, p_game_id, u.uid, NULL, NULL
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(g->'userIds') AS uid
          FROM jsonb_array_elements(COALESCE(p_payload->'groups', '[]'::jsonb)) AS g
      ) u
    ON CONFLICT (game_id, user_id) DO NOTHING;

    DELETE FROM public.play_groups WHERE game_id = p_game_id;

    v_gord := 0;
    FOR v_group IN SELECT jsonb_array_elements(COALESCE(p_payload->'groups', '[]'::jsonb))
    LOOP
      v_gid := gen_random_uuid()::text;
      INSERT INTO public.play_groups (id, game_id, display_name, tee_time)
      VALUES (
        v_gid,
        p_game_id,
        COALESCE(NULLIF(btrim(v_group->>'name'), ''), 'Group ' || (v_gord + 1)),
        NULLIF(v_group->>'teeTime', '')
      );
      UPDATE public.game_participants
         SET play_group_id = v_gid
       WHERE game_id = p_game_id
         AND user_id IN (SELECT jsonb_array_elements_text(v_group->'userIds'));
      v_gord := v_gord + 1;
    END LOOP;
  END IF;

  -- 2c · Per-participant handicap strokes (rack + stroke, 085) — the FIELD (warned)
  -- tier: in-place, unguarded, clamped 0–18 (0→NULL, matching _write_side_handicap so
  -- a no-op save round-trips unchanged). The tRPC handler re-derives results after.
  IF p_payload ? 'participants' THEN
    FOR v_part IN SELECT jsonb_array_elements(COALESCE(p_payload->'participants', '[]'::jsonb))
    LOOP
      UPDATE public.game_participants
         SET handicap_strokes = NULLIF(GREATEST(0, LEAST(18, COALESCE((v_part->>'strokes')::int, 0))), 0)
       WHERE game_id = p_game_id AND user_id = v_part->>'userId';
    END LOOP;
  END IF;

  -- 3 · Delegates — Organizer-only (a delegate cannot sub-delegate). KEY-GATED (088):
  --     only touch delegates when the payload CARRIES the `delegates` key, mirroring
  --     matches / groups / participants (`p_payload ? 'key'`). An ABSENT key now PRESERVES
  --     the current set; a PRESENT `[]` clears it (the deliberate "remove all delegates").
  --     Before this, the block ran on every Organizer save and `COALESCE(...,'[]')` meant
  --     an omitted key wiped every delegate — the live silent-wipe when a client Saves
  --     before `listOrganizers` resolves (empty result read as "clear them"). The client
  --     stops sending the key on an unchanged/unknown delegate set (follow-up commit).
  IF v_is_org AND p_payload ? 'delegates' THEN
    DELETE FROM public.game_delegates WHERE game_id = p_game_id;
    INSERT INTO public.game_delegates (game_id, user_id, granted_by)
    SELECT p_game_id, d, (auth.uid())::text
      FROM jsonb_array_elements_text(p_payload->'delegates') AS d;
  END IF;

  -- 4 · The scoring_enabled transition, applied LAST so it reads the config just
  -- written. go-live is readiness-gated POST-write; true→true re-affirms; true→false
  -- disables. Readiness already branches per format (match / stroke+rack / else).
  IF v_go_live THEN
    IF v_type = 'gtt_match_play' THEN
      SELECT
        count(*) FILTER (WHERE side_a->>'id' IS NOT NULL AND side_b->>'id' IS NOT NULL),
        count(*)
        INTO v_paired, v_total
        FROM public.game_matches WHERE game_id = p_game_id;
      IF NOT (v_total > 0 AND v_paired = v_total) THEN
        RAISE EXCEPTION 'NOT_READY: finish setting up this game before switching it to scoring'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF v_type IN ('gtt_stroke_play', 'gtt_rack_n_stack') THEN
      IF v_type = 'gtt_rack_n_stack' THEN
        SELECT count(*) INTO v_part_count
          FROM public.game_participants WHERE game_id = p_game_id AND play_group_id IS NOT NULL;
      ELSE
        SELECT count(*) INTO v_part_count
          FROM public.game_participants WHERE game_id = p_game_id;
      END IF;
      IF v_part_count = 0 THEN
        RAISE EXCEPTION 'NOT_READY: finish setting up this game before switching it to scoring'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.games
                     WHERE id = p_game_id
                       AND (points_distribution IS NOT NULL OR points_total IS NOT NULL)) THEN
        RAISE EXCEPTION 'NOT_READY: finish setting up this game before switching it to scoring'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    UPDATE public.games
       SET scoring_enabled = true, status = 'active', pairings_published_at = now()
     WHERE id = p_game_id AND trip_id = p_trip_id;
    UPDATE public.game_matches SET status = 'active'
     WHERE game_id = p_game_id AND status = 'pending';

  ELSIF v_was_live THEN
    UPDATE public.games
       SET scoring_enabled = false,
           pairings_published_at = NULL,
           status = CASE WHEN status = 'active' THEN 'pending' ELSE status END
     WHERE id = p_game_id AND trip_id = p_trip_id
     RETURNING status INTO v_status;
    IF v_status = 'pending' THEN
      UPDATE public.game_matches SET status = 'pending'
       WHERE game_id = p_game_id AND status = 'active';
    END IF;
  END IF;
END;
$$;
