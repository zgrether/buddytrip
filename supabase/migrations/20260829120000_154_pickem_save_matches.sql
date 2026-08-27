-- 154 — pick'em writes its matches into `game_matches`, like every other format.
--
-- Phase 4 §4. The sharing is the point, not a cost: `liveMatchPointsPerMatch`,
-- `MatchSides`, `merge_guest_to_real_user`'s JSONB arm and the realtime
-- publication all already speak this table. A parallel `pickem_matches` would
-- mean a second guest-merge arm, a second publication entry and a second
-- divisor — the failure this project has found repeatedly.
--
-- ══ Why an RPC and not a PostgREST upsert ═══════════════════════════════════
--
-- The write is THREE statements that have to land together: clear the old
-- matches, insert the new ones, and reconcile `game_participants` so every
-- paired person has a row. Half of that is a game whose matches disagree with
-- its participants — which the divisor, the guest merge and Phase 5's results
-- gate all read.
--
-- ══ CLEAN-REPLACE here, and why that is safe when 148 forbade it ═══════════
--
-- Migration 148 goes to some length to UPSERT the slate rather than replace it,
-- because `pickem_picks` cascades off `pickem_slate_games` and a replace would
-- destroy every sheet.
--
-- Nothing cascades off `game_matches` for pick'em. Picks reference SLATE games,
-- not matches; a match is only ever a statement about who plays whom. So a
-- clean replace is the honest model for "here is the new pairing", and it
-- avoids the id-stability dance that upserting would need for rows the runner
-- reshuffles freely.
--
-- The one thing it must not destroy is a match that already has a RESULT — see
-- the guard below.
--
-- ══ The guard: never re-pair a match that has been decided ═════════════════
--
-- Once Phase 5 records outcomes, `game_matches.result` is set. Re-pairing then
-- would move a result onto a different pair of people — silently, since nothing
-- about the row would look wrong afterwards. Refused outright rather than
-- merged, because there is no correct automatic answer to "you already scored
-- this, and now the people are different".
--
-- Phase 5 owns the un-decide path if one is wanted. This function simply will
-- not overwrite a decided match.

CREATE OR REPLACE FUNCTION public.save_pickem_matches(p_game_id text, p_pairs jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_item jsonb;
  v_idx integer := 0;
  v_a text;
  v_b text;
  v_users text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.games WHERE id = p_game_id AND game_type_id = 'gtt_pickem'
  ) THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND: no pick''em game with that id'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- A decided match cannot be re-paired. See the header: moving a recorded
  -- result onto different people is invisible after the fact.
  IF EXISTS (
    SELECT 1 FROM public.game_matches
     WHERE game_id = p_game_id
       AND (result IS NOT NULL OR status = 'complete')
  ) THEN
    RAISE EXCEPTION 'MATCH_DECIDED: a match already has a result — clear it before re-pairing'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Refuse a person appearing twice. The client evicts on assign, so this is
  -- the backstop for a direct caller — and it matters because a duplicate makes
  -- one sheet decide two matches.
  SELECT array_agg(u) INTO v_users FROM (
    SELECT elem ->> 'a' AS u FROM jsonb_array_elements(p_pairs) elem WHERE elem ->> 'a' IS NOT NULL
    UNION ALL
    SELECT elem ->> 'b' FROM jsonb_array_elements(p_pairs) elem WHERE elem ->> 'b' IS NOT NULL
  ) s;
  IF v_users IS NOT NULL
     AND array_length(v_users, 1) <> (SELECT count(DISTINCT u) FROM unnest(v_users) u) THEN
    RAISE EXCEPTION 'DUPLICATE_PLAYER: someone is in more than one match'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.game_matches WHERE game_id = p_game_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_pairs)
  LOOP
    v_a := NULLIF(v_item ->> 'a', '');
    v_b := NULLIF(v_item ->> 'b', '');

    INSERT INTO public.game_matches
      (id, game_id, play_group_id, match_number, display_order, side_a, side_b, status)
    VALUES (
      (gen_random_uuid())::text,
      p_game_id,
      NULL,
      v_idx + 1,
      v_idx,
      -- The shape `matches.setPairings` writes for a 1-member side, so
      -- `MatchSides` and the divisor read pick'em rows without knowing they are
      -- pick'em. A pick'em side is ALWAYS a user: sheets belong to people.
      CASE WHEN v_a IS NULL THEN NULL ELSE jsonb_build_object('type', 'user', 'id', v_a) END,
      CASE WHEN v_b IS NULL THEN NULL ELSE jsonb_build_object('type', 'user', 'id', v_b) END,
      'pending'
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- Participants follow the pairing. Every paired person gets a row; anyone
  -- dropped from the field loses theirs.
  --
  -- Their SHEET is untouched — `pickem_picks` keys off the slate and the user,
  -- never off participation, so being unpaired does not erase what someone
  -- submitted. That is deliberate: a person left out of this round's matches
  -- may be paired in the next save, and losing their picks in between would be
  -- unrecoverable.
  DELETE FROM public.game_participants
   WHERE game_id = p_game_id
     AND (v_users IS NULL OR NOT (user_id = ANY (v_users)));

  IF v_users IS NOT NULL THEN
    INSERT INTO public.game_participants (id, game_id, user_id, play_group_id, team_id)
    SELECT (gen_random_uuid())::text, p_game_id, u, NULL, NULL
      FROM unnest(v_users) u
     WHERE NOT EXISTS (
       SELECT 1 FROM public.game_participants gp
        WHERE gp.game_id = p_game_id AND gp.user_id = u
     );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_pickem_matches(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_pickem_matches(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_pickem_matches(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pickem_matches(text, jsonb) TO service_role;

COMMENT ON FUNCTION public.save_pickem_matches(text, jsonb) IS
  'Writes a pick''em game''s matches into game_matches (side_a/side_b as {type:user,id}, the same shape matches.setPairings writes) and reconciles game_participants in one transaction. Clean-replace is safe here — unlike the slate, nothing cascades off game_matches, since picks reference slate games — but a DECIDED match is refused outright, because re-pairing would move a recorded result onto different people invisibly (migration 154).';
