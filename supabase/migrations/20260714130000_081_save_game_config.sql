-- ─────────────────────────────────────────────────────────────────────────────
-- 081 · save_game_config — the atomic Game-Settings Save RPC (Draft-Then-Save P1)
-- ─────────────────────────────────────────────────────────────────────────────
-- The settings page becomes draft-then-save: nothing commits until one explicit
-- Save. This RPC is that Save — an all-or-nothing multi-table write so a partial
-- config (3 of 8 pairings, half a points model) can never land. It replaces the
-- per-row commit sprawl (setPairings + N×setHandicap + setPointsTotal +
-- setPointsDistribution + games.update + enableScoring) with ONE transaction.
--
-- Design A — "dumb transactional writer" (spec §2.2): the client PRE-COMPUTES
-- everything derived (filled-match filter, handicap distribution per side, the
-- even-share points_distribution.value, the course par/index snapshot) in the
-- shared pure JS helpers (src/lib/configDraft.ts) and hands ready-to-write rows.
-- No scoring/ranking derivation lives in SQL — the plpgsql only writes.
--
-- Guard model:
--  · assert_game_edit — the requireGameEdit equivalent (Owner/Organizer trip role
--    OR this game's delegate), NOT assert_game_owner (settings editing is broader
--    than the owner-only reset RPCs).
--  · scoring_enabled is a state machine keyed off the DB's CURRENT value
--    (v_was_live), never the draft's (spec §2.2):
--       was=false, draft=false → write config
--       was=false, draft=true  → write config, in-RPC readiness assert, GO LIVE
--       was=true,  draft=false → DISABLE only (do NOT rewrite config)
--       was=true,  draft=true  → RAISE (no legal settings-Save on a live game —
--                                the page is client-locked; a stale/malicious
--                                client trying to write config to a live game is
--                                rejected, whole tx rolls back). This closes the
--                                "match-config freeze is client-only today" gap
--                                WITHOUT touching the correction late-edit path
--                                (matches.setHandicap/setPointValue are separate
--                                unchanged mutations — they never route here).
--  · Field-level sub-guards preserve the existing permission granularity: the
--    owner-set points_total and the delegate list are Organizer-only (a delegate
--    distributes WITHIN a total and can't sub-delegate), so a delegate's Save
--    leaves those untouched even though the bulk config is theirs to edit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── assert_game_edit — throwing guard, the requireGameEdit equivalent ─────────
CREATE OR REPLACE FUNCTION public.assert_game_edit(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id text;
BEGIN
  SELECT trip_id INTO v_trip_id FROM public.games WHERE id = p_game_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  -- Same predicate as the game_matches/games delegate RLS (migrations 075/076):
  -- trip Owner/Organizer OR a delegate of this specific game.
  IF NOT (public.has_trip_role(v_trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(p_game_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: you cannot edit this game' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- ── _write_game_side — private core: materialize ONE match side ───────────────
-- Given the side's member user-ids and its strokes, writes the participant(s) /
-- play_group and returns the side jsonb ref the way setPairings' mkSide does
-- (1 member → {type:user,id}; 2 → a minted play_group of both, handicap on the
-- group; 0 → null slot). NULLIF(strokes,0) keeps "no handicap" as NULL (read as 0
-- downstream), matching the fresh-setup state. Private — REVOKEd below.
CREATE OR REPLACE FUNCTION public._write_game_side(p_game_id text, p_members jsonb, p_strokes int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_len int := jsonb_array_length(COALESCE(p_members, '[]'::jsonb));
  v_uid text;
  v_pg_id text;
BEGIN
  IF v_len = 0 THEN
    RETURN NULL; -- empty slot
  END IF;
  IF v_len = 1 THEN
    v_uid := p_members->>0;
    INSERT INTO public.game_participants (id, game_id, user_id, play_group_id, team_id, handicap_strokes)
    VALUES (gen_random_uuid()::text, p_game_id, v_uid, NULL, NULL, NULLIF(p_strokes, 0));
    RETURN jsonb_build_object('type', 'user', 'id', v_uid);
  END IF;
  -- 2v2: mint a play_group (handicap lives on the group), tag both participants.
  v_pg_id := gen_random_uuid()::text;
  INSERT INTO public.play_groups (id, game_id, display_name, handicap_strokes)
  VALUES (v_pg_id, p_game_id, NULL, NULLIF(p_strokes, 0));
  FOR v_uid IN SELECT jsonb_array_elements_text(p_members)
  LOOP
    INSERT INTO public.game_participants (id, game_id, user_id, play_group_id, team_id, handicap_strokes)
    VALUES (gen_random_uuid()::text, p_game_id, v_uid, v_pg_id, NULL, NULL);
  END LOOP;
  RETURN jsonb_build_object('type', 'play_group', 'id', v_pg_id);
END;
$$;

-- ── save_game_config — the atomic Save ───────────────────────────────────────
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
  v_match jsonb;
  v_ord int;
  v_paired int := 0;
  v_total int := 0;
  v_part_count int := 0;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  SELECT trip_id, scoring_enabled, status, game_type_id
    INTO v_trip_id, v_was_live, v_status, v_type
    FROM public.games WHERE id = p_game_id AND trip_id = p_trip_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── The scoring_enabled state machine (keyed off the SERVER's current value) ─
  IF v_was_live THEN
    IF v_go_live THEN
      -- true→true: no legal settings-Save (the page is client-locked when live).
      RAISE EXCEPTION 'GAME_LIVE: this game is live — reload before editing its settings'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    -- true→false: DISABLE. Flip scoring off, return the game to setup, revert the
    -- active match rows — but do NOT rewrite config (mirrors games.disableScoring;
    -- scores are never touched).
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
    RETURN;
  END IF;

  -- ── NOT live: write the whole config atomically ─────────────────────────────
  v_is_org := public.has_trip_role(v_trip_id, ARRAY['Owner'::text, 'Organizer'::text]);

  -- 1 · Scalar game columns. points_total is Organizer-only (a delegate keeps the
  -- current total); everything else is requireGameEdit-writable.
  UPDATE public.games SET
      name                = COALESCE(p_payload->>'name', name),
      rules_for_today     = p_payload->>'rulesForToday',
      entry_mode          = COALESCE(p_payload->>'entryMode', entry_mode),
      modifiers           = COALESCE(NULLIF(p_payload->'modifiers', 'null'::jsonb), '{}'::jsonb),
      points_total        = CASE WHEN v_is_org
                                 THEN NULLIF(p_payload->>'pointsTotal', '')::numeric
                                 ELSE points_total END,
      points_distribution = NULLIF(p_payload->'pointsDistribution', 'null'::jsonb),
      course_id           = p_payload->>'courseId',
      scorecard_schema    = NULLIF(p_payload->'scorecardSchema', 'null'::jsonb)
    WHERE id = p_game_id AND trip_id = p_trip_id;

  -- 2 · Matches / participants / play_groups — clean replace (mirrors setPairings;
  -- children reference play_groups ON DELETE SET NULL, so clear children first).
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

  -- 3 · Delegates — Organizer-only (a delegate cannot sub-delegate). A delegate's
  -- Save leaves the list untouched; only an Owner/Organizer replaces it.
  IF v_is_org THEN
    DELETE FROM public.game_delegates WHERE game_id = p_game_id;
    INSERT INTO public.game_delegates (game_id, user_id, granted_by)
    SELECT p_game_id, d, (auth.uid())::text
      FROM jsonb_array_elements_text(COALESCE(p_payload->'delegates', '[]'::jsonb)) AS d;
  END IF;

  -- 4 · Go live? Readiness is asserted POST-write, inside this tx (spec §2.2): a
  -- not-ready go-live RAISEs and the WHOLE save rolls back — no config lands, no
  -- flip. Mirrors gameReadiness.assertGameReady (course/handicaps never gate).
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
  END IF;
END;
$$;

-- ── Grants / revokes (mirror migration 066's PUBLIC/anon/authenticated revoke) ─
-- The wrappers are self-guarded (assert_game_edit inside), so authenticated may
-- call them (defence in depth with the tRPC requireGameEdit). The private side
-- writer must never be reachable directly — Supabase auto-grants EXECUTE to
-- PUBLIC + anon + authenticated, so revoke from all three (service_role kept).
GRANT EXECUTE ON FUNCTION public.assert_game_edit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_game_config(text, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._write_game_side(text, jsonb, int) FROM PUBLIC, anon, authenticated;
