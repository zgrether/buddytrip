-- 153 — the deadline gets its own action, instead of riding `open`.
--
-- Phase 4. `set_pickem_phase('open')` writes THREE columns:
--
--     picks_opened_at = COALESCE(picks_opened_at, now())
--     picks_deadline  = p_deadline
--     picks_locked_at = NULL
--
-- which is fine as an OPEN, and wrong as the only way to set a deadline. Using
-- it for that means:
--
--   * setting a deadline while still BUILDING would publish the game — sixteen
--     people get a slate the runner was not finished with
--   * setting one while LOCKED would silently UNLOCK it, reopening every sheet
--     and un-revealing the matches, because clearing `picks_locked_at` is part
--     of what `open` means
--
-- Phase 4's first cut defended that by only offering the control while picks
-- were open. It worked, and it was a restriction standing in for a fix: the
-- editability question only existed because one action did three things that
-- happened to arrive together.
--
-- ══ Splitting it makes the question disappear ═══════════════════════════════
--
-- `set_deadline` writes ONE column. It can be called in any phase, because
-- there is no longer anything else it could disturb:
--
--   * building  → schedules the deadline the game will open with
--   * open      → moves it, extends it, or clears it
--   * locked    → changes it without touching the hand lock
--
-- `open` keeps its `p_deadline` parameter, because opening WITH a deadline in
-- one action is a real thing a runner does and splitting that would trade one
-- awkwardness for another. The two are consistent: `open` sets the deadline it
-- is given; `set_deadline` sets only the deadline.
--
-- ══ What it deliberately does NOT do ════════════════════════════════════════
--
-- It does not refuse a deadline in the past. That reads like a guard and is
-- not one: `pickem_picks_open` evaluates `now() <= deadline` lazily on every
-- read and write, so a past deadline simply means "closed" — which is a
-- legitimate way to end picks, indistinguishable in effect from
-- `lock`. Refusing it would forbid a runner from typing the time picks
-- actually closed.
--
-- It does not require the game to be open. A deadline set while building is
-- inert until `open` runs, and `open` overwrites it with whatever it is given
-- — including NULL. That is the one sharp edge of keeping both, and it is
-- stated here rather than discovered: **open's deadline argument wins.** The
-- client passes the current deadline through when opening so the two agree.

CREATE OR REPLACE FUNCTION public.set_pickem_deadline(p_game_id text, p_deadline timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  INSERT INTO public.pickem_games (game_id) VALUES (p_game_id)
  ON CONFLICT (game_id) DO NOTHING;

  -- ONE column. That is the entire point of this function existing.
  UPDATE public.pickem_games
     SET picks_deadline = p_deadline
   WHERE game_id = p_game_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_pickem_deadline(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pickem_deadline(text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_pickem_deadline(text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pickem_deadline(text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.set_pickem_deadline(text, timestamptz) IS
  'Sets ONLY pickem_games.picks_deadline, in any phase. Split out of set_pickem_phase(''open'') — which also coalesces picks_opened_at and clears picks_locked_at, so using it to edit a deadline would publish a building game or silently unlock a locked one (migration 153). A past deadline is allowed: the lazy predicate reads it as closed, which is a legitimate way to end picks.';
