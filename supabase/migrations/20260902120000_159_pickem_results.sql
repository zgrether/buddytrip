-- 159 — pick'em Run: each slate game's outcome, and the freeze that follows it.
--
-- ══ Four-valued, not binary ════════════════════════════════════════════════
--
-- The mockup models a result as "who won". It is four:
--
--   away / home   someone covered — pickers of that side score
--                 confidence × multiplier
--   push          it happened and nobody won. Picks are against the SPREAD, so
--                 Alabama −3 covering exactly 3 is a push, and an NFL game can
--                 tie outright.
--   cancelled     it never happened.
--
-- Push and cancelled are the SAME ARITHMETIC and DIFFERENT FACTS: both score
-- zero for everyone, both stop counting as remaining, both count as resolved.
-- Stored apart because the screen has to say which — collapsing them would make
-- the column unable to express a distinction the surface is required to show.
--
-- Both bringing a clinch FORWARD is a consequence, not a bug: there is less on
-- the table, so less can change.
--
-- ══ On the slate game, not a new table ═════════════════════════════════════
--
-- A result is a property of the contest, one per slate game, and
-- `pickem_slate_games` already has exactly that cardinality. A side table would
-- add a join, a second place for the id to go missing, and a second thing for
-- `_pickem_has_results` to read.
--
-- It does NOT belong in `game_matches.result`: that column says who won a
-- PAIRING between two people, which pick'em derives from the sheets rather than
-- records. Writing a slate outcome there would make the two meanings collide in
-- one column.
--
-- ══ The freeze predicate LEARNS about it (§6.3) ════════════════════════════
--
-- `_pickem_has_results` already gates picks-reopening and the scoring settings.
-- Migration 157 wrote it before pick'em could record anything, so it read
-- `game_results` / decided `game_matches` / a finished game — none of which a
-- pick'em game has while Run is in progress. Left alone it would answer FALSE
-- through the whole of Run, and the two freezes it exists for would never fire.
--
-- Extended here rather than duplicated, which is the §6.3 instruction and the
-- rule this project keeps relearning: one question, one spelling.

ALTER TABLE public.pickem_slate_games
  ADD COLUMN IF NOT EXISTS result text;

DO $$ BEGIN
  ALTER TABLE public.pickem_slate_games
    ADD CONSTRAINT pickem_slate_games_result_check
    CHECK (result IS NULL OR result IN ('away', 'home', 'push', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.pickem_slate_games.result IS
  'How this contest finished: away / home (someone covered), push (it happened, nobody won — picks are against the spread, so an exact cover is a push), cancelled (it never happened), or NULL for not yet played. Push and cancelled score zero for everyone and are stored apart because they are different FACTS the screen must distinguish (migration 159).';

-- ── The one results-exist predicate, taught the new source ──────────────────

CREATE OR REPLACE FUNCTION public._pickem_has_results(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  -- SCOPED TO PICK'EM, in the body, so the name is true of the answer. Without
  -- this the freeze in `save_game_config` applied to EVERY format, and a
  -- finalized match-play game could no longer have its points edited
  -- (`games.saveConfig.finalized.test.ts` caught it during 157).
  SELECT EXISTS (SELECT 1 FROM public.games WHERE id = p_game_id AND game_type_id = 'gtt_pickem')
     AND (
       -- THE PRIMARY SOURCE during Run (migration 159). Everything below it was
       -- written before pick'em could record an outcome, so on its own the
       -- predicate answered false for the whole of Run and neither freeze fired.
       EXISTS (
         SELECT 1 FROM public.pickem_slate_games
          WHERE game_id = p_game_id AND result IS NOT NULL
       )
       OR EXISTS (SELECT 1 FROM public.game_results WHERE game_id = p_game_id)
       OR EXISTS (
            SELECT 1 FROM public.game_matches
             WHERE game_id = p_game_id
               AND (result IS NOT NULL OR status = 'complete')
          )
       OR EXISTS (
            SELECT 1 FROM public.games
             WHERE id = p_game_id AND status = 'complete'
          )
     );
$$;

-- ── Are the matches complete enough to award against? ──────────────────────
--
-- Phase 4 defined this as a PREDICATE rather than an action — no finalize
-- button, no `matches_published_at`. Phase 5 enforces it, and enforcing a
-- predicate means asking it, not adding a step.
--
-- The reason is arithmetic, not fairness: under `individual_matches` a result
-- is awarded X/N across the matches, and a half-filled match has nobody to
-- award its share to. Team totals has no such gate — every sheet sums into its
-- side whatever the pairings look like.
--
-- Returns the NAME of the first person left without an opponent, or NULL when
-- the matches are fine. A name rather than a boolean because "finalize your
-- matches" sends someone hunting through a grid, and "Bill has no opponent"
-- does not.

CREATE OR REPLACE FUNCTION public._pickem_incomplete_match_player(p_game_id text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT COALESCE(u.name, u.email, 'Someone')
    FROM public.game_matches gm
    LEFT JOIN public.users u
      ON u.id = COALESCE(gm.side_a ->> 'id', gm.side_b ->> 'id')
   WHERE gm.game_id = p_game_id
     AND (gm.side_a IS NULL) <> (gm.side_b IS NULL)
   ORDER BY gm.display_order
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._pickem_incomplete_match_player(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pickem_incomplete_match_player(text) FROM anon;
REVOKE ALL ON FUNCTION public._pickem_incomplete_match_player(text) FROM authenticated;

COMMENT ON FUNCTION public._pickem_incomplete_match_player(text) IS
  'The name of the first person in a half-filled match, or NULL when every match has both sides. Used to REFUSE a result entry under individual_matches with something actionable — "Bill has no opponent" rather than "finalize your matches" (migration 159). Container fact, so REVOKEd per CLAUDE.md #28.';

-- ── Record one outcome ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_pickem_result(
  p_game_id text,
  p_slate_game_id text,
  p_result text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_roll_up text;
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

  SELECT g.status, COALESCE(pg.roll_up, 'team_totals')
    INTO v_status, v_roll_up
    FROM public.games g
    LEFT JOIN public.pickem_games pg ON pg.game_id = g.id
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
  IF p_result IS NOT NULL AND v_roll_up = 'individual_matches' THEN
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
$$;

REVOKE ALL ON FUNCTION public.set_pickem_result(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pickem_result(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_pickem_result(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pickem_result(text, text, text) TO service_role;

COMMENT ON FUNCTION public.set_pickem_result(text, text, text) IS
  'Records one slate game''s outcome (away / home / push / cancelled, or NULL to clear). Refuses under individual_matches while any match is half-filled, naming the stranded player, because a result awarded X/N has nobody to give one share to; team totals has no such gate. Refuses entirely once the game is finalized — §6.2, results are history at that point and the reset path is the way back. Any order: nothing here reads display_order (migration 159).';

-- ── The clock also moves `games.status` now ────────────────────────────────
--
-- §5. Pick'em never touched `status`, so every pick'em game sat at `pending`
-- from creation until `games.finish`, and the board's five-way partition
-- (status × started × isNewGame) could only ever read it as New or Configuring
-- — however far along it actually was.
--
-- The mapping, and it is one function's job so the three transitions cannot
-- each grow their own idea:
--
--   open   → active   picks are open; the board's "Ready for Play" is
--                     `active & !started`, and Ready means what it means
--                     everywhere else — a participant has something to do and
--                     has not done it yet.
--   lock   → active   unchanged. The Ready→underway split is `started`, which
--                     is a LEADERBOARD-side derivation, not a column: pick'em
--                     gets its own started source (revealed sheets), the way
--                     outcome mode needed one because it has no score_entries.
--   unlock → active   also unchanged, for the same reason — unlock moves the
--                     game back across the `started` line, not the status one.
--
-- A `complete` game is left alone by all three: `games.finish` owns that end,
-- and a lifecycle action must not quietly un-finalize a game.

CREATE OR REPLACE FUNCTION public.set_pickem_phase(p_game_id text, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

COMMENT ON FUNCTION public.set_pickem_phase(text, text) IS
  'The pick''em lifecycle transitions, one clock column each: open stamps picks_opened_at (refusing an empty slate) AND moves games.status to active so the board can read the game as Ready rather than Configuring (migration 159); lock stamps picks_locked_at; unlock clears it. Neither lock nor unlock touches status — the Ready/underway split is the leaderboard''s `started` derivation, not a column. A finalized game''s status is never moved: games.finish owns that end. It does NOT write the deadline — set_pickem_deadline owns that column (migration 156).';
