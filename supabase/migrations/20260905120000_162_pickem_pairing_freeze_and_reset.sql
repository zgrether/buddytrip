-- 162 · The pairing freeze asks about PAIRINGS again; reset learns pick'em
--
-- Two defects, one report, one root each. Both were found by RUNNING the game,
-- not by any test: the slate could not be re-paired, and the refusal named a
-- condition the screen contradicted.
--
-- == 1 . THE DEADLOCK =======================================================
--
-- Migration 157 pointed `save_pickem_matches` at `_pickem_has_results`,
-- unifying it with the settings freeze. They answer different questions (see
-- the guard's own comment below), and the unification made a resolved SLATE
-- GAME freeze the PAIRINGS. On a game whose pairing was still incomplete that
-- is a deadlock with no exit: pairings frozen, `open` refusing because a
-- pairing is incomplete, and no route to either.
--
-- == 2 . THE MESSAGE POINTED AT THE WRONG OBJECT ============================
--
-- Worth its own note, because it is what cost the time. 157 widened the
-- CONDITION and kept 154's MESSAGE: "a match already has a result — clear it
-- before re-pairing". No match had a result; a slate game did. So the error
-- named an object the reader could go and check, every match he checked read
-- 0-0, and the app looked wrong rather than the message looking misaimed.
-- Narrowing the guard makes the message true of its condition again.
--
-- The two results holding the freeze were a PUSH and a CANCELLATION, which
-- score zero for everyone. Results were cleared until the board read 0-0 —
-- which it did, correctly. A resolved-to-zero game is indistinguishable from an
-- unresolved one anywhere only totals are shown: the empty-versus-unknown
-- pattern, arriving in the surface that introduced the four-valued result
-- (159). The Run panel does say "2 of 16 in" and labels those rows; the BOARD
-- is where the two collapse, and that is a client fix, not this migration's.
--
-- == 3 . RESET DID NOT SWEEP PICK'EM ========================================
--
-- `_reset_game_scoring` clears "everything PLAYED, in every shape it is stored
-- in (125)" — five tables. Migration 159 added a SIXTH shape,
-- `pickem_slate_games.result`, and did not add it here. So "Reset scores" on a
-- pick'em game cleared nothing at all, while its own copy promised "every
-- recorded result".
--
-- Same failure direction as the guest-merge rule in CLAUDE.md — ADD a storage
-- shape, add it to the function that sweeps every shape, in the same migration
-- — and silent in exactly the same way. The "every shape" comment was true when
-- it was written; 159 made it false and nothing said so. It is also #27's
-- lesson one table further on: a score had two storage shapes, and now three.
--
-- Independent of the deadlock, and the escape hatch that should have existed
-- while the deadlock was live.

CREATE OR REPLACE FUNCTION public.save_pickem_matches(p_game_id text, p_pairs jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- A DECIDED MATCH cannot be re-paired: moving a recorded result onto
  -- different people is invisible after the fact.
  --
  -- REVERTS migration 157, which replaced this inline check with
  -- `_pickem_has_results` on the reasoning that it "is the same question the
  -- settings freeze asks". It is not — and the comment asserting it was is
  -- what made the widening read as a tidy-up rather than a behaviour change:
  --
  --   SETTINGS freeze  "has anything been scored yet" — because confidence
  --                    and the roll-up change what every banked point MEANT.
  --   PAIRING freeze   "would re-pairing move a RECORDED OUTCOME onto someone
  --                    who did not earn it".
  --
  -- A slate result is the first and not the second. NOTHING is stored per
  -- pairing in this format — a match standing is derived from sheets plus
  -- results on every read — so re-pairing moves no result anywhere; it
  -- re-points a lens. What IS stored per pairing is `game_matches.result`,
  -- and that is what this asks about again.
  --
  -- Left as it was, the widening DEADLOCKS a game that has not started. A
  -- slate game resolving froze the pairings, including a pairing that was
  -- never valid — so an incomplete pairing could not be completed, `open`
  -- kept refusing on that incompleteness, and the game could never run. The
  -- freeze protected nothing there: no player had seen a pick yet.
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
$function$;

-- == `_reset_game_scoring` learns the sixth shape ===========================
CREATE OR REPLACE FUNCTION public._reset_game_scoring(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $reset$
BEGIN
  -- Everything PLAYED, in every shape it is stored in (125, 162).
  DELETE FROM public.game_results        WHERE game_id = p_game_id;
  DELETE FROM public.score_entries       WHERE game_id = p_game_id;
  DELETE FROM public.match_hole_outcomes WHERE game_id = p_game_id;

  -- The sixth shape (159). A pick'em game stores its outcomes HERE and nowhere
  -- above — no score_entries, no match_hole_outcomes — so omitting it made this
  -- sweep a no-op on the entire format.
  UPDATE public.pickem_slate_games
     SET result = NULL
   WHERE game_id = p_game_id;

  UPDATE public.game_matches
     SET result = NULL, margin = NULL, status = 'pending'
   WHERE game_id = p_game_id;

  UPDATE public.bracket_matches
     SET winner_entrant_id = NULL
   WHERE game_id = p_game_id;

  -- The go-live triple, kept consistent (#895 / #25). `status` follows the
  -- switch rather than being forced to 'pending' beside an enabled game.
  UPDATE public.games
     SET corrections_open = false,
         status = CASE WHEN scoring_enabled THEN 'active' ELSE 'pending' END
   WHERE id = p_game_id;
END;
$reset$;
