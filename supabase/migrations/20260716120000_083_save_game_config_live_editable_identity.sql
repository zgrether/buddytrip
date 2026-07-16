-- 083 — save_game_config: name / rules / delegates are editable while LIVE
--
-- 082 kept 081's rule that a true→true save (a live game staying live) is a hard
-- GAME_LIVE refusal. That froze the game's NAME, its ASSIGNMENT (delegates), and its
-- RULES OF THE DAY the moment scoring started. But none of those can affect a
-- completed hole, and adding a delegate mid-round is exactly when you need it — a
-- co-organiser stepping in to help score. Freezing them was overreach.
--
-- (It also silently broke a promise the UI already makes: the scoring-lock banner
-- says "Rules of the day can still be edited," and GameRulesNote is gated on plain
-- canEdit — but under draft-then-save that edit routes through THIS rpc, so the
-- true→true refusal meant it could never actually save. This fixes that too.)
--
-- 083: true→true is no longer refused. It does a NARROW write of exactly the fields
-- that can't rescore anything — name, rules_for_today, and (Organizer-only) the
-- delegate list — then RETURNs. Everything game-altering stays frozen: matches,
-- course/scorecard, points, entry_mode, modifiers are NOT written on a live game. The
-- client already locks those rows, so a well-behaved payload never changes them, and
-- this branch ignores them regardless (defence in depth). No scoring flip, no
-- readiness assert, no clean-replace.
--
-- Why this is the safe field set: it's the same "notes / identity / access, not
-- scoring" carve-out Rules of the Day already had. entry_mode is EXCLUDED (switching
-- score↔outcome mid-round orphans entered data); points are EXCLUDED (they move the
-- award math — a separate, riskier decision the owner should make in Setup).
--
-- Everything below the state machine is byte-identical to 082. 082 is applied, so it
-- is never edited; this is a new migration (CLAUDE.md Migration Workflow).

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
  v_is_org boolean;
  v_go_live boolean := COALESCE((p_payload->>'scoringEnabled')::boolean, false);
  v_matches_dirty boolean := COALESCE((p_payload->>'matchesDirty')::boolean, true);
  v_has_scores boolean;
  v_cur_course_id text;
  v_cur_back_course_id text;
  v_cur_schema jsonb;
  v_course_dirty boolean;
  v_match jsonb;
  v_ord int;
  v_paired int := 0;
  v_total int := 0;
  v_part_count int := 0;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  -- FOR UPDATE serializes concurrent saves against this game: two simultaneous
  -- commits can't interleave (the second blocks until the first's tx ends). The
  -- optimistic base-config-hash check lives in the games.saveConfig tRPC front
  -- door (it reuses computeConfigHash / #16 — re-implementing that FNV-1a canonical
  -- hash in plpgsql would drift from the JS and false-reject every save).
  --
  -- ACCEPTED LIMITATION (not closed): the hash is validated OUTSIDE this lock, so a
  -- true lost update — A checks, B checks, A writes, B clobbers — is still reachable
  -- in the sub-100ms window between the JS hash-check and this write. We accept it:
  -- human-timescale collisions (two people editing settings seconds apart) ARE
  -- caught by the JS check; fully closing it would need a stored version column
  -- bumped under this lock, which every other write path would have to maintain and
  -- which false-rejects when stale. FOR UPDATE only removes the RPC-vs-RPC interleave.
  SELECT trip_id, scoring_enabled, status, game_type_id, course_id, back_course_id, scorecard_schema
    INTO v_trip_id, v_was_live, v_status, v_type, v_cur_course_id, v_cur_back_course_id, v_cur_schema
    FROM public.games WHERE id = p_game_id AND trip_id = p_trip_id
    FOR UPDATE;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  v_is_org := public.has_trip_role(v_trip_id, ARRAY['Owner'::text, 'Organizer'::text]);

  -- ── The scoring_enabled state machine (keyed off the SERVER's current value) ─
  -- 083: true→true is no longer refused. A live game stays live, but its NAME, RULES
  -- and (Organizer-only) DELEGATES are written — the fields that can't rescore a
  -- completed hole. Nothing game-altering is touched (the client locks those rows;
  -- this branch ignores them regardless), and scoring_enabled/status don't move.
  IF v_was_live AND v_go_live THEN
    UPDATE public.games SET
        name            = COALESCE(NULLIF(btrim(p_payload->>'name'), ''), name),
        rules_for_today = p_payload->>'rulesForToday'
      WHERE id = p_game_id AND trip_id = p_trip_id;
    IF v_is_org THEN
      DELETE FROM public.game_delegates WHERE game_id = p_game_id;
      INSERT INTO public.game_delegates (game_id, user_id, granted_by)
      SELECT p_game_id, d, (auth.uid())::text
        FROM jsonb_array_elements_text(COALESCE(p_payload->'delegates', '[]'::jsonb)) AS d;
    END IF;
    RETURN;
  END IF;

  -- ── Not (live staying live): write the whole config atomically ──────────────

  -- Course freeze boundary — mirrors games.applyCourse: once ANY score is in, the
  -- par/index the round is being played on is fixed, so re-applying/removing a
  -- course (or swapping a tee, which rewrites the snapshot) would silently rescore
  -- it. Refuse rather than rewrite. Gated on an ACTUAL course change so a Save that
  -- leaves the course alone still works on a game that KEPT its scores through a
  -- disable (the same reason the match clean-replace gates on v_matches_dirty).
  -- Course identity AND the snapshot both count: a tee swap moves only the schema.
  -- jsonb IS DISTINCT FROM is semantic (key order normalized), so an untouched
  -- schema round-tripping through the client compares equal.
  v_course_dirty :=
        (p_payload->>'courseId')     IS DISTINCT FROM v_cur_course_id
     OR (p_payload->>'backCourseId') IS DISTINCT FROM v_cur_back_course_id
     OR NULLIF(p_payload->'scorecardSchema', 'null'::jsonb) IS DISTINCT FROM v_cur_schema;
  IF v_course_dirty THEN
    SELECT EXISTS (SELECT 1 FROM public.score_entries WHERE game_id = p_game_id)
        OR EXISTS (SELECT 1 FROM public.match_hole_outcomes WHERE game_id = p_game_id)
      INTO v_has_scores;
    IF v_has_scores THEN
      RAISE EXCEPTION 'COURSE_LOCKED: this game already has scores. Reset scores in the game''s Danger zone before changing its course.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  -- 1 · Scalar game columns. points_total is Organizer-only (a delegate keeps the
  -- current total); everything else is requireGameEdit-writable.
  UPDATE public.games SET
      -- NULLIF(btrim(...)) so a blank/whitespace name can never erase the title
      -- (the zod floor catches it first; this is the defence in depth).
      name                = COALESCE(NULLIF(btrim(p_payload->>'name'), ''), name),
      rules_for_today     = p_payload->>'rulesForToday',
      entry_mode          = COALESCE(p_payload->>'entryMode', entry_mode),
      modifiers           = COALESCE(NULLIF(p_payload->'modifiers', 'null'::jsonb), '{}'::jsonb),
      points_total        = CASE WHEN v_is_org
                                 THEN NULLIF(p_payload->>'pointsTotal', '')::numeric
                                 ELSE points_total END,
      points_distribution = NULLIF(p_payload->'pointsDistribution', 'null'::jsonb),
      course_id           = p_payload->>'courseId',
      -- Written in LOCKSTEP with course_id/scorecard_schema (W-9HOLE-01): the row's
      -- front/back/"needs a back nine" state reads it, so persisting a composed 18
      -- without it strands the back-nine identity, and leaving a stale ref behind a
      -- cleared/re-picked course renders a phantom back nine.
      back_course_id      = p_payload->>'backCourseId',
      scorecard_schema    = NULLIF(p_payload->'scorecardSchema', 'null'::jsonb)
    WHERE id = p_game_id AND trip_id = p_trip_id;

  -- 2 · Matches / participants / play_groups — clean replace (mirrors setPairings;
  -- children reference play_groups ON DELETE SET NULL, so clear children first).
  --
  -- ONLY when the match set actually changed. Skipping an unchanged set keeps row
  -- ids stable across Saves, and it's what lets a game that KEPT ITS SCORES through
  -- a disable still be edited and re-enabled — the clean replace mints new ids, so
  -- running it over retained score rows would orphan them.
  IF v_matches_dirty THEN
    -- A rewrite once scores exist would strand them against dead ids. Refuse it the
    -- way applyCourse refuses a course change after scores, rather than silently
    -- orphaning. Scoring lives in score_entries (gross) or match_hole_outcomes
    -- (outcome mode) — either counts.
    --
    -- 082: this is now also the guard on "disable + change the matchups in one
    -- Save". A disable keeps scores, so that combination lands HERE and the whole
    -- tx (disable included) rolls back. Deliberate — see the 082 header.
    SELECT EXISTS (SELECT 1 FROM public.score_entries WHERE game_id = p_game_id)
        OR EXISTS (SELECT 1 FROM public.match_hole_outcomes WHERE game_id = p_game_id)
      INTO v_has_scores;
    IF v_has_scores THEN
      RAISE EXCEPTION 'HAS_SCORES: this game already has scores. Reset scores in the game''s Danger zone before changing its matchups.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

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
  END IF;

  -- 3 · Delegates — Organizer-only (a delegate cannot sub-delegate). A delegate's
  -- Save leaves the list untouched; only an Owner/Organizer replaces it.
  IF v_is_org THEN
    DELETE FROM public.game_delegates WHERE game_id = p_game_id;
    INSERT INTO public.game_delegates (game_id, user_id, granted_by)
    SELECT p_game_id, d, (auth.uid())::text
      FROM jsonb_array_elements_text(COALESCE(p_payload->'delegates', '[]'::jsonb)) AS d;
  END IF;

  -- 4 · The scoring_enabled transition, applied LAST so it reads the config this
  -- save just wrote.
  IF v_go_live THEN
    -- Readiness is asserted POST-write, inside this tx (spec §2.2): a not-ready
    -- go-live RAISEs and the WHOLE save rolls back — no config lands, no flip.
    -- Mirrors gameReadiness.assertGameReady (course/handicaps never gate).
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
      -- manual / side events: configured ⟺ points set.
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
    -- 082 · true→false: DISABLE. Close it to the crew, return the game to setup and
    -- revert the active match rows. Scores are NEVER touched (that's what makes
    -- disable → re-enable non-destructive). Unlike 081 this no longer returns early,
    -- so the config above has already been written in the same tx.
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
