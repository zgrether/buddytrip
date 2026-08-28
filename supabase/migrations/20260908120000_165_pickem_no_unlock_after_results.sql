-- 165 · Picks cannot reopen once results are in
--
-- `set_pickem_phase('unlock')` had no results guard. It cleared
-- `picks_locked_at` on any game whose picks had ever opened, whatever had
-- happened since.
--
-- == WHAT THAT ALLOWED =====================================================
--
-- Proven against the live local stack before writing this, in a rolled-back
-- transaction: a game with one slate result recorded and a hand lock.
--
--     set_pickem_phase(game, 'unlock')   -> ACCEPTED
--     _pickem_picks_open_state(game)     -> true
--
-- So picks were writable again on a game whose outcomes were partly known.
-- Someone could re-pick a contest they had already watched, and score it as a
-- prediction. Nothing in the schema or the client stopped it: the phase strip
-- offers "Unlock picks" whenever the phase is locked, with the consequence text
-- "Nothing is lost" — which was true of the sheets and false of the game.
--
-- Not reachable by a participant: `assert_game_edit` gates the RPC, so this
-- needs the Owner, an Organizer or the game's delegate. That is what makes it a
-- correctness bug rather than an escalation — but the runner is exactly the
-- person who might unlock to "fix one thing" after a Sunday result lands, and
-- the strip invited it.
--
-- == THE OTHER HALF IS IN THE CLIENT =======================================
--
-- The strip stops offering the move once results exist, in the same change. A
-- server guard alone would turn a working button into an error message, which
-- is the shape this project keeps rejecting: a control that is offered and then
-- refused. Both layers, together.
--
-- == WHAT STILL WORKS ======================================================
--
-- Unlock is untouched on a game with no results — the ordinary "I locked early,
-- let me reopen" case, which is what the action is for. And a runner who really
-- must reopen a game that HAS results still can: clear them with Reset scores
-- first, which is what the refusal says and what migration 162 made true.

CREATE OR REPLACE FUNCTION public.set_pickem_phase(p_game_id text, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  INSERT INTO public.pickem_games (game_id) VALUES (p_game_id)
  ON CONFLICT (game_id) DO NOTHING;

  IF p_action = 'open' THEN
    -- Refuse an empty slate. "Picks open soon" with nothing to pick is a dead
    -- end for sixteen people, and the runner cannot see that from his own
    -- screen because HE can read the slate whether or not it has rows.
    IF NOT EXISTS (SELECT 1 FROM public.pickem_slate_games WHERE game_id = p_game_id) THEN
      RAISE EXCEPTION 'EMPTY_SLATE: add at least one game before opening picks'
        USING ERRCODE = 'check_violation';
    END IF;
    -- ONE clock column. The deadline belongs to `set_pickem_deadline` and the
    -- lock to `unlock`; migration 156's header has what writing all three cost.
    UPDATE public.pickem_games
       SET picks_opened_at = COALESCE(picks_opened_at, now())
     WHERE game_id = p_game_id;

    UPDATE public.games
       SET status = 'active'
     WHERE id = p_game_id AND status <> 'complete';

  ELSIF p_action = 'lock' THEN
    UPDATE public.pickem_games SET picks_locked_at = COALESCE(picks_locked_at, now())
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSIF p_action = 'unlock' THEN
    -- RESULTS CLOSE THE DOOR. Reopening picks on a game whose outcomes are
    -- partly known is not picking — the person already knows how those games
    -- went, so a re-pick is a free correction rather than a prediction.
    --
    -- This arm had NO results guard at all. Verified before the fix: with one
    -- slate result recorded, `unlock` was accepted and
    -- `_pickem_picks_open_state` then returned true, so `pickem_picks_write`
    -- would admit edits to a game that had already produced outcomes.
    --
    -- `_pickem_has_results` is the right predicate here, unlike in migration
    -- 162 where it was the wrong one. The difference is what the question is
    -- about: 162's guard asked whether re-PAIRING would move a recorded outcome
    -- onto someone who did not earn it, and nothing is stored per pairing. This
    -- asks whether the game has produced outcomes AT ALL, which is exactly what
    -- that predicate answers — every one of its arms means "this game has
    -- started producing results", and reopening picks is wrong under all four.
    IF public._pickem_has_results(p_game_id) THEN
      -- Names an action the reader can take, and one that WORKS: migration 162
      -- taught `_reset_game_scoring` about `pickem_slate_games.result`, so
      -- "Reset scores" genuinely clears these. Before 162 this sentence would
      -- have been the exact lie that rule exists to prevent.
      RAISE EXCEPTION 'RESULTS_RECORDED: results are already in — clear them with Reset scores before reopening picks'
        USING ERRCODE = 'check_violation';
    END IF;

    -- The whole of the "let me change something" path now that `reopen` is
    -- gone (156), and it destroys nothing: the slate becomes editable because
    -- `save_pickem_config` gates on picks being OPEN, which a hand-locked game
    -- is not. Rankings survive unless the slate actually changes.
    --
    -- A game past its DEADLINE is not reopened by this — unlocking clears only
    -- the hand lock. Move the deadline with `set_pickem_deadline` to reopen
    -- that one, which is the same tool doing the same job.
    UPDATE public.pickem_games SET picks_locked_at = NULL
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSE
    RAISE EXCEPTION 'BAD_ACTION: expected open, lock or unlock' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
