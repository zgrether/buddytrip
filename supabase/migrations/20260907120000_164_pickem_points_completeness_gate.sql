-- 164 · The completeness gate respects points mode
--
-- `set_pickem_result` refuses a result while a match is missing a side. It
-- decided whether that applied by reading `pickem_games.roll_up` alone.
--
-- == WHY THAT IS WRONG, AND WHY IT LOOKED RIGHT ============================
--
-- A points competition has NO MATCHES. Its teams are ordered and placement
-- pays; there is no pairing to complete. But `roll_up` is a pick'em-owned
-- column that a points cup still CARRIES — it is inert there, not absent — so a
-- game created with `individual_matches` and later placed in (or created
-- under) a points cup hit the gate, and the gate refused every result with
-- "set the matches first" on a game where matches cannot exist.
--
-- Unfixable from the client, which is the shape that matters: the runner cannot
-- create the matches the message asks for, because the surface that creates
-- them does not render in a points cup — correctly. Same family as the deadlock
-- migration 162 undid, arriving through a different column.
--
-- == THE RULE, APPLIED WHERE IT WAS MISSING =================================
--
-- "Points overrides roll_up" is already the model — `gameTypes.ts` has said so
-- since Phase 2, and Phase 7 made the CLIENT read it that way. This is the
-- server half. A third `roll_up` CHECK value was rejected deliberately: it
-- would let a points cup carry `individual_matches` and mean nothing, which is
-- a state that reads as configured and is not. The competition decides.
--
-- Swept before changing: `set_pickem_result` is the ONLY function in the schema
-- whose body mentions `individual_matches`, so this is the whole server-side
-- surface of that decision rather than one of several.

CREATE OR REPLACE FUNCTION public.set_pickem_result(p_game_id text, p_slate_game_id text, p_result text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_roll_up text;
  v_points_mode boolean;
  v_stranded text;
  v_status text;
BEGIN
  -- Owner / Organizer / this game's delegate — the same gate as the settings
  -- gear and the phase strip. A delegate RUNS the game (migration 158).
  PERFORM public.assert_game_edit(p_game_id);

  IF p_result IS NOT NULL AND p_result NOT IN ('away', 'home', 'push', 'cancelled') THEN
    RAISE EXCEPTION 'BAD_RESULT: expected away, home, push or cancelled'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The competition's scoring model rides along on the read that was already
  -- happening, so points mode costs no extra round trip.
  SELECT g.status,
         COALESCE(pg.roll_up, 'team_totals'),
         COALESCE(c.scoring_model, 'match_play') = 'points'
    INTO v_status, v_roll_up, v_points_mode
    FROM public.games g
    LEFT JOIN public.pickem_games pg ON pg.game_id = g.id
    LEFT JOIN public.competitions c ON c.id = g.competition_id
   WHERE g.id = p_game_id AND g.game_type_id = 'gtt_pickem';

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND: no pick''em game with that id'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- §6.2 — editable while active, frozen at finalize. Runners mis-tap and ESPN
  -- corrects things, so a result stays changeable for the whole of Run; once
  -- `games.finish` has awarded points it is history, and reversing it means
  -- rewriting a standing. The reset path already exists for that and this must
  -- not become a second one.
  IF v_status = 'complete' THEN
    RAISE EXCEPTION 'GAME_FINAL: this game is finalized — reset it to change a result'
      USING ERRCODE = 'check_violation';
  END IF;

  -- §4 / §6.1 — the completeness gate, and only under individual_matches.
  -- Checked on SET, not on clear: undoing a mistake must never be blocked by a
  -- condition the mistake did not depend on.
  IF p_result IS NOT NULL AND v_roll_up = 'individual_matches' AND NOT v_points_mode THEN
    IF NOT EXISTS (SELECT 1 FROM public.game_matches WHERE game_id = p_game_id) THEN
      RAISE EXCEPTION 'MATCHES_INCOMPLETE: set the matches before entering results'
        USING ERRCODE = 'check_violation';
    END IF;

    v_stranded := public._pickem_incomplete_match_player(p_game_id);
    IF v_stranded IS NOT NULL THEN
      RAISE EXCEPTION 'MATCHES_INCOMPLETE: % has no opponent', v_stranded
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.pickem_slate_games
     SET result = p_result
   WHERE id = p_slate_game_id AND game_id = p_game_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLATE_GAME_NOT_FOUND: that game is not on this slate'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$function$;
