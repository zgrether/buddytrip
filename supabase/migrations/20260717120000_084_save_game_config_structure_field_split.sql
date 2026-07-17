-- 084 — save_game_config: split match STRUCTURE from match FIELDS; retire GAME_LIVE;
--        server-guard every locked-tier setting.
--
-- Freeze-redesign foundation. `scoring_enabled`-as-a-lock is retired (§0): it's now a
-- pure VISIBILITY flag, and the real guards key on scores ACTUALLY existing. Per-row
-- locking moves to the client; the SERVER refuses exactly the three destroys-tier
-- changes when scores exist — uniformly, not two-of-three.
--
-- (1) `matchesDirty` conflated two different writes, so editing a HANDICAP or a
--     per-match POINT OVERRIDE on a scored game was wrongly refused:
--       • STRUCTURE — which matches, each side's roster, the shape. No stable row
--         identity → clean-replace (fresh UUIDs) → orphans scores → REFUSED with
--         scores (HAS_SCORES). Unchanged.
--       • FIELDS — handicap + point_value, values on rows that survive. Same set →
--         in-place UPDATE → allowed with scores (WARNED tier: results recalculate,
--         nothing orphaned).
--     The client sends `matchesStructureDirty` (set changed) instead of `matchesDirty`.
--     Strictly smaller than the still-deferred upsert-by-identity: this is "set is
--     identical, a field differs" — no UUID reconciliation.
--
--     VERIFY-ON-SKIP-PATH: the in-place branch writes fields by POSITIONAL key
--     (match_number), so if the set actually differs it would write a handicap to the
--     wrong player, SILENTLY. The baseHash conflict check catches this — but it's
--     validated OUTSIDE the FOR UPDATE lock (the accepted sub-100ms window). Under the
--     lock, a positional write demands re-verification: the in-place branch confirms
--     each payload match's roster still matches the DB row of that match_number, and
--     RAISEs STRUCTURE_MISMATCH otherwise. (setPairings/setHandicap edit by row id and
--     don't share this path.)
--
--     A field change on a SCORED game changes a recompute INPUT, and the RPC only
--     WRITES — plpgsql can't call the ONE shared JS engine (buildDecided/matchState/
--     glorious). So the games.saveConfig tRPC handler runs computeMatchPlayResults
--     AFTER a successful save (Design A, parity with setHandicap/setPointValue).
--     ACCEPTED: that recompute is OUTSIDE this tx — a crash between the field write and
--     the recompute leaves game_results briefly stale, but it's DERIVED (the next
--     save / finish / corrections edit re-derives) and the live client view recomputes
--     from scores regardless. Recoverable, logged.
--
-- (2) Locked-tier server guards, all keyed on scores existing (computed once):
--       • MATCHES structure change → HAS_SCORES (existing).
--       • COURSE change            → COURSE_LOCKED (existing).
--       • ENTRY_MODE change        → ENTRY_MODE_LOCKED (NEW). Entry Mode orphans
--         entered data (score↔outcome); its orphan is semantic (data goes dormant, not
--         an FK break) but Zach's UX call is Locked — scores vanishing mid-round reads
--         as catastrophe reversible or not. A client-only lock on a destroy op is the
--         exact gap the flip closed for setPairings/setHandicap; entry_mode was the
--         last one still client-only. Now all three refuse server-side.
--
-- (3) GAME_LIVE gone. 081's reject and 083's narrow true→true write are removed; a
--     live score-less game saves its full config; step-4 re-affirms the live state.
--
-- DEPLOY WINDOW: `matchesStructureDirty` is dual-read with the legacy `matchesDirty`
-- so an old client (pre-this-app-ship) works against this migration. REMOVE the
-- `matchesDirty` fallback once the app carrying the new payload has shipped to prod.
--
-- 081/082/083 are applied and immutable; this is a new migration.

-- Read-only helper: the member user-ids on a side, sorted, for roster verification.
-- A user side → [its id]; a play_group side → its participants' user_ids.
CREATE OR REPLACE FUNCTION public._game_side_members(p_game_id text, p_side jsonb)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_side IS NULL OR p_side->>'id' IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  IF p_side->>'type' = 'play_group' THEN
    RETURN ARRAY(
      SELECT user_id FROM public.game_participants
       WHERE game_id = p_game_id AND play_group_id = p_side->>'id'
       ORDER BY user_id
    );
  END IF;
  RETURN ARRAY[p_side->>'id'];
END;
$$;

-- Write a side's handicap in place (the in-place counterpart to _write_game_side's
-- INSERT). NULLIF(_,0) so "no strokes" persists as NULL (matches _write_game_side +
-- effectiveStrokes' ?? 0).
CREATE OR REPLACE FUNCTION public._write_side_handicap(p_game_id text, p_side jsonb, p_strokes int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_side IS NULL OR p_side->>'id' IS NULL THEN
    RETURN;
  END IF;
  IF p_side->>'type' = 'play_group' THEN
    UPDATE public.play_groups
       SET handicap_strokes = NULLIF(p_strokes, 0)
     WHERE id = p_side->>'id' AND game_id = p_game_id;
  ELSE
    UPDATE public.game_participants
       SET handicap_strokes = NULLIF(p_strokes, 0)
     WHERE user_id = p_side->>'id' AND game_id = p_game_id;
  END IF;
END;
$$;

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
  -- The match SET changed (structure) — NOT a mere field edit. Dual-read the legacy
  -- key so an old client works during the deploy window (remove the fallback later).
  v_matches_structure_dirty boolean := COALESCE(
    (p_payload->>'matchesStructureDirty')::boolean,
    (p_payload->>'matchesDirty')::boolean,
    true);
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
  v_paired int := 0;
  v_total int := 0;
  v_part_count int := 0;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  -- FOR UPDATE serializes concurrent saves; the optimistic base-config-hash check
  -- lives in the games.saveConfig tRPC front door (reuses computeConfigHash / #16).
  -- ACCEPTED (not closed): the hash is validated OUTSIDE this lock, so a sub-100ms
  -- lost-update window stays reachable; human-timescale collisions ARE caught. See
  -- 081's header. The in-place field path re-verifies the roster UNDER this lock,
  -- which closes the "positional write to the wrong row" corner of that same window.
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

  -- Scores exist? Computed ONCE — the three locked-tier guards below all key on it.
  SELECT EXISTS (SELECT 1 FROM public.score_entries WHERE game_id = p_game_id)
      OR EXISTS (SELECT 1 FROM public.match_hole_outcomes WHERE game_id = p_game_id)
    INTO v_has_scores;

  -- ── Locked-tier guards (uniform: every destroys-tier change refused with scores) ─
  -- Each gated on an ACTUAL change, so an unchanged value round-trips freely (a
  -- game that KEPT its scores through a disable can still edit everything else).

  -- ENTRY MODE — orphans entered score/outcome data (084).
  IF p_payload->>'entryMode' IS NOT NULL
     AND (p_payload->>'entryMode') IS DISTINCT FROM v_cur_entry_mode
     AND v_has_scores THEN
    RAISE EXCEPTION 'ENTRY_MODE_LOCKED: this game already has scores. Reset scores in the game''s Danger zone before changing how it''s scored.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- COURSE — re-applying par/index would silently rescore. jsonb IS DISTINCT FROM is
  -- key-order-normalized, so an untouched schema round-tripping the client compares equal.
  v_course_dirty :=
        (p_payload->>'courseId')     IS DISTINCT FROM v_cur_course_id
     OR (p_payload->>'backCourseId') IS DISTINCT FROM v_cur_back_course_id
     OR NULLIF(p_payload->'scorecardSchema', 'null'::jsonb) IS DISTINCT FROM v_cur_schema;
  IF v_course_dirty AND v_has_scores THEN
    RAISE EXCEPTION 'COURSE_LOCKED: this game already has scores. Reset scores in the game''s Danger zone before changing its course.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- MATCHES structure — the clean-replace mints fresh UUIDs that would orphan scores.
  IF v_matches_structure_dirty AND v_has_scores THEN
    RAISE EXCEPTION 'HAS_SCORES: this game already has scores. Reset scores in the game''s Danger zone before changing its matchups.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- ── Write the config ────────────────────────────────────────────────────────
  -- 084: no GAME_LIVE reject, no narrow true→true write. scoring_enabled is a pure
  -- visibility flag; every case writes the full config here and step-4 handles the flag.

  -- 1 · Scalar game columns. points_total is Organizer-only.
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
      scorecard_schema    = NULLIF(p_payload->'scorecardSchema', 'null'::jsonb)
    WHERE id = p_game_id AND trip_id = p_trip_id;

  -- 2 · Matches — the STRUCTURE / FIELDS split.
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
    -- FIELDS only (same set): UPDATE handicap + point_value in place. Match payload →
    -- rows by match_number, but VERIFY the roster first (positional write, under the
    -- lock — see the header). No HAS_SCORES guard: warned tier.
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

      -- strokesA→side_a, strokesB→side_b. The client pre-split the signed handicap
      -- (exactly one side non-zero), so this also zeroes the non-recipient.
      PERFORM public._write_side_handicap(p_game_id, v_side_a, COALESCE((v_match->>'strokesA')::int, 0));
      PERFORM public._write_side_handicap(p_game_id, v_side_b, COALESCE((v_match->>'strokesB')::int, 0));
    END LOOP;
  END IF;

  -- 3 · Delegates — Organizer-only (a delegate cannot sub-delegate).
  IF v_is_org THEN
    DELETE FROM public.game_delegates WHERE game_id = p_game_id;
    INSERT INTO public.game_delegates (game_id, user_id, granted_by)
    SELECT p_game_id, d, (auth.uid())::text
      FROM jsonb_array_elements_text(COALESCE(p_payload->'delegates', '[]'::jsonb)) AS d;
  END IF;

  -- 4 · The scoring_enabled transition, applied LAST so it reads the config just
  -- written. go-live is readiness-gated POST-write (rolls the tx back if not ready);
  -- true→true re-affirms live (idempotent); true→false disables.
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
    -- true→false: DISABLE. Close to the crew, return to setup, revert active match
    -- rows. Scores are NEVER touched. Config above already wrote in the same tx.
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

-- The private helpers must never be reachable directly (Supabase auto-grants EXECUTE
-- to PUBLIC/anon/authenticated; mirrors _write_game_side's revoke).
REVOKE EXECUTE ON FUNCTION public._game_side_members(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._write_side_handicap(text, jsonb, int) FROM PUBLIC, anon, authenticated;
