-- 167 — RESULTS STOP DEPENDING ON PAIRINGS, AND FINALIZE STOPS BEING A DEAD END.
--
-- Three changes across two functions. Together in one migration because two of
-- them edit the same body, and a second `CREATE OR REPLACE` of
-- `set_pickem_result` a week later would be two chances to lose one of them.
--
-- ══ 1. THE MATCHES-COMPLETENESS GATE GOES (reverses migrations 159 / 164) ══
--
-- `set_pickem_result` refused a result under `individual_matches` until every
-- match had both sides filled. The stated reason was that "the arithmetic has
-- nowhere to go — a result with an incomplete match has no one to award X/N to".
--
-- That reasoning is wrong twice over.
--
-- A slate game's result is a fact about the WORLD. Whether Alabama covered does
-- not depend on who has been paired against whom, and a gate that says
-- otherwise is asserting a dependency the domain does not have.
--
-- And the arithmetic never needed it. Entering a result scores every SHEET,
-- which works with no matches at all; only the match totals need matches, and
-- those derive at read time. An unpaired match simply has no total yet — which
-- is a display state, not an error, and the board has always rendered it.
--
-- `_pickem_incomplete_match_player` loses its only caller here. It is left in
-- place rather than dropped: it is a pure read, dropping it is a separate act
-- with its own risk, and the pairing surfaces may still want the question.
--
-- ══ 2. FINALIZE IS NOT A DEAD END — corrections_open decides ═══════════════
--
-- The freeze read `status = 'complete'` alone, and its message said "reset it to
-- change a result". Reset clears every result, or every pick — the nuclear
-- option behind a confirm. Sending somebody there to fix a typo is the refusal
-- rule's exact failure: an instruction that is followed, and costs far more than
-- the problem.
--
-- Golf has answered this since it had a finalize: `isLocked` is
-- `complete AND NOT corrections_open`, and "Correct scores" flips one column.
-- One tap, reversible, nothing destroyed. `set_pickem_result` now reads the same
-- pair, so pick'em joins that model instead of growing a fifth private one —
-- which is CLAUDE.md #24's whole point, and the argument that decided it.
--
-- The message names the affordance rather than the sledgehammer.
--
-- ══ 3. pickem_sheet_status RETURNS A COUNT, NOT A BOOLEAN ═════════════════
--
-- It answered `submitted boolean`, which cannot distinguish the three states the
-- proxy list has to show: nothing submitted, part of a sheet, and a finished
-- one. Under partial saves (166) the middle one is now the common case, and a
-- boolean renders it identically to a complete sheet — so a captain chasing
-- somebody could not tell who was halfway.
--
-- No new exposure. The function is already SECURITY DEFINER and already scoped
-- by `_pickem_can_proxy_for` to exactly the people the caller may WRITE for; a
-- count of rows they may edit tells them nothing they could not obtain by
-- opening the sheet.
--
-- DROP + CREATE rather than CREATE OR REPLACE: the return type changes, and
-- Postgres refuses to replace a function's `RETURNS TABLE` shape in place.
--
-- Idempotent, and replays cleanly from zero. No schema change, no data change.

-- ── 1 + 2 ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_pickem_result(p_game_id text, p_slate_game_id text, p_result text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_corrections_open boolean;
BEGIN
  -- Owner / Organizer / this game's delegate — the same gate as the settings
  -- gear and the phase strip. A delegate RUNS the game (migration 158).
  PERFORM public.assert_game_edit(p_game_id);

  IF p_result IS NOT NULL AND p_result NOT IN ('away', 'home', 'push', 'cancelled') THEN
    RAISE EXCEPTION 'BAD_RESULT: expected away, home, push or cancelled'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The roll-up and the competition's scoring model are no longer read: they
  -- existed only for the completeness gate, which is gone. A result is a fact
  -- about the world and does not consult the shape of the competition.
  SELECT g.status, COALESCE(g.corrections_open, false)
    INTO v_status, v_corrections_open
    FROM public.games g
   WHERE g.id = p_game_id AND g.game_type_id = 'gtt_pickem';

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND: no pick''em game with that id'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- LOCKED, not merely complete. `complete AND NOT corrections_open` is golf's
  -- `gameLockState.isLocked`, read the same way here so the two cannot drift.
  --
  -- A finalized game whose results moved silently underneath it would be worse
  -- than one that asks first — so the gate stays, and what changes is that
  -- there is now a one-tap way through it that destroys nothing. The message
  -- names that affordance. It used to name Reset, which clears every result in
  -- the game: an instruction that works, and costs everything.
  IF v_status = 'complete' AND NOT v_corrections_open THEN
    RAISE EXCEPTION 'GAME_LOCKED: this game is finalized — use Correct scores to change a result'
      USING ERRCODE = 'check_violation';
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

COMMENT ON FUNCTION public.set_pickem_result(text, text, text) IS
  'Records one slate game''s outcome. A result is a fact about the world, so it '
  'is NOT gated on pairings (migration 167 reversed that). Refused only while '
  'the game is LOCKED — complete with corrections closed — which Correct scores '
  'reopens without destroying anything.';

-- ── 3 ──────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.pickem_sheet_status(text);

CREATE FUNCTION public.pickem_sheet_status(p_game_id text)
 RETURNS TABLE(user_id text, picked integer, total integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT tm.user_id,
         (SELECT count(*)::integer FROM public.pickem_picks p
           WHERE p.game_id = p_game_id AND p.user_id = tm.user_id) AS picked,
         (SELECT count(*)::integer FROM public.pickem_slate_games s
           WHERE s.game_id = p_game_id) AS total
    FROM public.games g
    JOIN public.trip_members tm ON tm.trip_id = g.trip_id
   WHERE g.id = p_game_id
     AND public._pickem_can_proxy_for(p_game_id, tm.user_id);
$function$;

COMMENT ON FUNCTION public.pickem_sheet_status(text) IS
  'Everyone the caller may enter picks FOR, with how far along each of them is. '
  'Returns a COUNT rather than the boolean it used to (migration 167): under '
  'partial sheets, "started" and "finished" are different states and a boolean '
  'renders them identically. Scoped by _pickem_can_proxy_for, so the count is '
  'only ever of rows the caller may already edit.';

REVOKE ALL ON FUNCTION public.pickem_sheet_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickem_sheet_status(text) TO authenticated;
