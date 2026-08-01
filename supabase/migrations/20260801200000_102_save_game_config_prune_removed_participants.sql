-- 102 — save_game_config: prune participants removed from every grouping.
--
-- Section 2b has always been INSERT-ONLY. Its own comment says so — "upsert the roster
-- union (keeps existing rows + their scores)" — so removing a player from every grouping
-- rebuilt the groups around them and left their `game_participants` row behind. Nothing
-- ever wrote their `play_group_id` to NULL either; that is `ON DELETE SET NULL` cascading
-- off the `DELETE FROM play_groups` rebuild.
--
-- The result is a person who is in the game, in no group, and has no scores.
--
-- FOUND IN PRODUCTION, not by inspection. Querying "BBMI Playground (Points)" / Test1
-- turned up eight participants where one had played: the other seven were exactly this
-- shape. The stroke engine aggregated them at 0 strokes and, under lowest-total-wins,
-- three teams that had hit no shots tied for FIRST while the only team that played
-- finished fourth.
--
-- It also composed badly with the guard directly above it: that guard refuses removing a
-- SCORED player from every group, so the only players you are permitted to remove are
-- unscored ones — which are precisely the ones that survived. Every successful removal
-- left a ghost, by construction.
--
-- WHY STILL DO THIS, given #803. #803 fixed the consequence at the aggregation: only a
-- player who COMPLETED the round is scored, so a ghost can no longer win a golf
-- tournament by not playing. That makes this migration redundant FOR CORRECTNESS and it
-- is landing anyway, because the rows are still wrong and stale participants will
-- mislead the next reader of that table — a roster count, a readiness gate, a
-- notification audience, a future format. Data that is only harmless because one
-- consumer happens to filter it is a trap set for the second consumer.
--
-- Scope: this touches ONLY the groupings branch (stroke + rack). Match play reaches
-- `game_participants` through its own clean-replace path, which already deletes. The
-- delete is additive to an existing branch and changes no signature, so it replays
-- cleanly from zero.

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
  -- The GROUPINGS changed (membership / name / tee_time). Defaults TRUE so an old or terse
  -- client that sends `groups` without the flag is treated conservatively (rebuild +
  -- removal-guarded), never a silent skip.
  v_groups_structure_dirty boolean := COALESCE((p_payload->>'groupsStructureDirty')::boolean, true);
  v_has_scores boolean;
  -- #708 duplicate-participant pre-flight
  v_dup_uid  text;
  v_dup_name text;
  v_dup_m1   int;
  v_dup_m2   int;
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
  -- 093 — competition-attachment (read once, pre-write; unaffected by this call) + the
  -- POST-write point total (read fresh below, since pointsTotal may have just been set
  -- in this same call).
  v_competition_id text;
  v_points_total numeric;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  -- FOR UPDATE serializes concurrent saves; the optimistic base-config-hash check
  -- lives in the games.saveConfig tRPC front door (reuses computeConfigHash / #16).
  SELECT trip_id, scoring_enabled, status, game_type_id, entry_mode,
         course_id, back_course_id, scorecard_schema, competition_id
    INTO v_trip_id, v_was_live, v_status, v_type, v_cur_entry_mode,
         v_cur_course_id, v_cur_back_course_id, v_cur_schema, v_competition_id
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
  -- `matches`, so the default-true flag must NOT fire this guard for them. Match play's
  -- matchups are AUTHORED + STORED (game_matches) — a real snapshot — so this stays coarse.
  IF p_payload ? 'matches' AND v_matches_structure_dirty AND v_has_scores THEN
    RAISE EXCEPTION 'HAS_SCORES: this game already has scores. Reset scores in the game''s Danger zone before changing its matchups.'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- GROUPINGS (rack + stroke, 089) — PRECISE guard (was coarse, #594 / DEFERRED). Slots are
  -- DERIVED and scores key to user_id, so the ONLY groups change that strands a score is
  -- REMOVING a scored player from every group. Refuse just that; allow add / re-group /
  -- rename / tee-time (incl. growing the field mid-round). A scored player = a user_id with
  -- `score_entries` (participant_type='user'); "removed" = absent from every group in the
  -- new payload. NOT IN over an EMPTY groups payload is TRUE for all → emptying groups with
  -- scores present is correctly refused.
  IF p_payload ? 'groups' AND v_groups_structure_dirty AND v_has_scores THEN
    IF EXISTS (
      SELECT 1 FROM public.score_entries se
       WHERE se.game_id = p_game_id
         AND se.participant_type = 'user'
         AND se.participant_id NOT IN (
           SELECT jsonb_array_elements_text(g->'userIds')
             FROM jsonb_array_elements(COALESCE(p_payload->'groups', '[]'::jsonb)) AS g
         )
    ) THEN
      RAISE EXCEPTION 'HAS_SCORES: a player with entered scores can''t be dropped from the groupings mid-round. Keep every scored player in a group, or reset scores in the game''s Danger zone first.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  -- DUPLICATE PARTICIPANT (#708) — a player may be in exactly ONE match per game.
  --
  -- This is a PRE-FLIGHT validation, deliberately not a catch of the 23505 that
  -- `game_participants_game_id_user_id_key` (migration 033) would raise a few lines
  -- below. Three reasons it belongs here instead:
  --   * it is deterministic — the constraint reports whichever INSERT happened to
  --     collide, which depends on match order and can only ever name the SECOND
  --     occurrence;
  --   * it can name BOTH matches, which is the half of the message that tells the
  --     owner what to actually do;
  --   * it runs before any write, so atomicity needs no thought.
  -- The UNIQUE constraint stays as the backstop and is NOT relaxed — it is also what
  -- gives `configHash`'s game_participants read (ordered by user_id) its total order.
  --
  -- Why the payload can carry a duplicate at all: match sides are authored client-side
  -- and `_write_game_side` inserts each side of each match blind to the others, so one
  -- person in side_a of match 1 and side_b of match 2 has no single write that looks
  -- wrong — only the SET across matches is invalid. The client bug that produced such a
  -- draft is fixed in `assignInDraft` (`src/lib/matchDraft.ts`); this is the guard that
  -- makes the refusal legible if anything ever composes one again.
  --
  -- Unconditional on the payload carrying matches — including the FIELDS-only branch,
  -- which inserts no participants. Refusing invalid input is right in both branches.
  IF p_payload ? 'matches' THEN
    SELECT d.uid, d.lo, d.hi
      INTO v_dup_uid, v_dup_m1, v_dup_m2
      FROM (
        SELECT x.uid, min(x.mn) AS lo, max(x.mn) AS hi
          FROM (
            SELECT COALESCE((mm->>'matchNumber')::int, 0) AS mn,
                   jsonb_array_elements_text(mm->'a') AS uid
              FROM jsonb_array_elements(COALESCE(p_payload->'matches', '[]'::jsonb)) mm
            UNION ALL
            SELECT COALESCE((mm->>'matchNumber')::int, 0) AS mn,
                   jsonb_array_elements_text(mm->'b') AS uid
              FROM jsonb_array_elements(COALESCE(p_payload->'matches', '[]'::jsonb)) mm
          ) x
         GROUP BY x.uid
        HAVING count(*) > 1
         ORDER BY min(x.mn), x.uid
         LIMIT 1
      ) d;

    IF v_dup_uid IS NOT NULL THEN
      SELECT COALESCE(NULLIF(btrim(u.name), ''), 'A player')
        INTO v_dup_name
        FROM public.users u
       WHERE u.id = v_dup_uid;
      v_dup_name := COALESCE(v_dup_name, 'A player');

      -- Same match on both sides (the "playing himself" shape) vs two different
      -- matches — the message names what actually happened rather than emitting
      -- "Match 1 and Match 1".
      IF v_dup_m1 = v_dup_m2 THEN
        RAISE EXCEPTION 'DUPLICATE_PARTICIPANT: % is on both sides of Match % — a player can only be in one match per game.',
          v_dup_name, v_dup_m1
          USING ERRCODE = 'object_not_in_prerequisite_state';
      ELSE
        RAISE EXCEPTION 'DUPLICATE_PARTICIPANT: % is in Match % and Match % — a player can only be in one match per game.',
          v_dup_name, v_dup_m1, v_dup_m2
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
    END IF;
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

  -- 2b · Groupings (rack + stroke, 085) — the STRUCTURE unit. The removal-only guard above
  -- already refused dropping a scored player. On a real change, mirror setFoursomes: upsert
  -- the roster union (keeps existing rows + their scores), rebuild play_groups, reassign.
  -- Skipped when nothing changed → a no-op save leaves play_groups byte-identical.
  IF p_payload ? 'groups' AND v_groups_structure_dirty THEN
    INSERT INTO public.game_participants (id, game_id, user_id, play_group_id, team_id)
    SELECT gen_random_uuid()::text, p_game_id, u.uid, NULL, NULL
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(g->'userIds') AS uid
          FROM jsonb_array_elements(COALESCE(p_payload->'groups', '[]'::jsonb)) AS g
      ) u
    ON CONFLICT (game_id, user_id) DO NOTHING;

    -- 102 · …and REMOVE the ones who left. The union above only ever ADDED, so a player
    -- dropped from every grouping kept their `game_participants` row forever. Their
    -- `play_group_id` went NULL — not written by anything, just `ON DELETE SET NULL`
    -- cascading off the rebuild below — leaving a person who is in the game, in no
    -- group, with no scores.
    --
    -- Found in production ("BBMI Playground (Points)" / Test1): seven such rows. The
    -- stroke engine aggregated them at 0 strokes and, under lowest-wins, three teams
    -- that had played no golf tied for FIRST.
    --
    -- #803 fixed that at the aggregation (only a player who COMPLETED the round is
    -- scored), so this delete is no longer load-bearing for correctness. It is here
    -- because the rows are still WRONG, and the next thing to read
    -- `game_participants` will be written by someone who does not know that some of
    -- them are ghosts.
    --
    -- Two conditions, both required:
    --   * absent from every group in the new payload — the same definition of
    --     "removed" the guard above uses, so the two can't drift apart; and
    --   * NO score entries. Belt and braces: the guard above already refuses removing
    --     a scored player, but it only runs when the GAME has scores at all
    --     (`v_has_scores`), so on a scoreless game it never fires. This check is
    --     per-player and unconditional, and it means the delete can never strand a
    --     score no matter how the guard above evolves.
    --
    -- Consequence worth naming rather than discovering: an EMPTY `groups` payload
    -- means nobody is in any group, so every unscored participant is removed. That is
    -- deliberate — migration 089 made groupings MANDATORY for stroke and rack ("an
    -- ungrouped player isn't in the game"), and the readiness gate below counts only
    -- participants WITH a `play_group_id`. Emptying the groups of a game that HAS
    -- scores is still refused outright by the guard above.
    --
    -- Rides the RPC's existing transaction: a plpgsql function body is one
    -- transaction, so this commits with the group rebuild or not at all. `configHash`
    -- fingerprints `game_participants`, so the removal propagates cross-device on the
    -- next poll like any other structural change (#16).
    DELETE FROM public.game_participants AS gp
     WHERE gp.game_id = p_game_id
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(p_payload->'groups', '[]'::jsonb)) AS g,
                jsonb_array_elements_text(g->'userIds') AS uid
          WHERE uid = gp.user_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.score_entries se
          WHERE se.game_id = p_game_id
            AND se.participant_type = 'user'
            AND se.participant_id = gp.user_id
       );

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
  IF v_is_org AND p_payload ? 'delegates' THEN
    DELETE FROM public.game_delegates WHERE game_id = p_game_id;
    INSERT INTO public.game_delegates (game_id, user_id, granted_by)
    SELECT p_game_id, d, (auth.uid())::text
      FROM jsonb_array_elements_text(p_payload->'delegates') AS d;
  END IF;

  -- 4 · The scoring_enabled transition, applied LAST so it reads the config just
  -- written. go-live is readiness-gated POST-write; true→true re-affirms; true→false
  -- disables. Readiness branches per format (match / stroke+rack grouped / else), PLUS
  -- (093) a shared competition-attachment check that applies BEFORE any of them.
  IF v_go_live THEN
    -- 093 — a competition-attached game worth 0 points can be scored end-to-end and
    -- finalized without moving the standings; the failure is invisible until it's too
    -- late to fix. Standalone games (v_competition_id IS NULL) are UNAFFECTED — same
    -- shape as the client's `!gameCompId ||` short-circuit. FRESH ENABLE ONLY
    -- (`NOT v_was_live`) — see the header comment for why a re-affirm must not
    -- re-trigger this. Reads points_total FRESH (not the pre-write value captured
    -- above) since this same call may have just set it in step 1. One check, shared
    -- by all four formats — the format-specific structural checks below are unchanged
    -- (still apply on top of this, and still re-check on every re-affirm as before).
    IF v_competition_id IS NOT NULL AND NOT v_was_live THEN
      SELECT points_total INTO v_points_total FROM public.games WHERE id = p_game_id;
      IF COALESCE(v_points_total, 0) <= 0 THEN
        RAISE EXCEPTION 'NOT_READY: set a point value before enabling scoring'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

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
      -- Grouped participants only (089): groupings are MANDATORY for BOTH formats now —
      -- an ungrouped player isn't in the game, so a roster with no groups isn't ready.
      SELECT count(*) INTO v_part_count
        FROM public.game_participants WHERE game_id = p_game_id AND play_group_id IS NOT NULL;
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
