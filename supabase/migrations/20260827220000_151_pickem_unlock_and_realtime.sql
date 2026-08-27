-- 151 — pick'em picks can be UNLOCKED, and its clock reaches other devices.
--
-- Two fixes from a run-through where the runner could lock, unlock and reopen
-- and **the player's sheet never changed**.
--
-- ════════════════════════════════════════════════════════════════════════════
--  1. `unlock` — the missing half of `lock`
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 148 gave `lock` no inverse. Getting picks open again meant
-- `reopen`, which is a much bigger hammer: it clears `picks_opened_at` AND (as
-- of 150) every ranking, because it exists for the case where the SLATE is
-- about to change.
--
-- So "I locked too early" and "I need to change the games" had one answer
-- between them, and it was the destructive one. A runner who locked a minute
-- early had to throw away sixteen people's rankings to give them five more
-- minutes.
--
-- `unlock` is the narrow inverse: clear `picks_locked_at`, touch nothing else.
-- Picks reopen exactly as they were — same slate, same rankings, same sheets.
--
-- ── Why it is safe to expose at any time ───────────────────────────────────
--
-- Unlocking makes sheets writable again, and briefly makes them unreadable to
-- others: `pickem_picks_revealed` goes false, so the board hides what it just
-- showed. That is the correct behaviour and not a leak — nobody can un-see a
-- sheet, but nobody gains anything either, because `pickem_picks_select` still
-- refuses every row but your own while picks are open.
--
-- It is deliberately NOT guarded on "no results entered yet". A runner
-- unlocking after results exist is doing something questionable, but it is
-- recoverable and visible, and the alternative — a lock that cannot be undone
-- once anything downstream happens — is the trap this migration exists to
-- remove. Phase 5 owns the results-entered guard if one is wanted.
--
-- ── The deadline interaction, which is the subtle part ─────────────────────
--
-- `picks_open` is `opened AND NOT hand-locked AND (no deadline OR now <=
-- deadline)`. So unlocking a game whose DEADLINE has passed does nothing
-- visible: the lazy deadline re-locks it immediately. That is correct — the
-- deadline is the promise made to sixteen people — and it means `unlock` is
-- only meaningful for a HAND lock, which is exactly what it is the inverse of.
-- A runner wanting to extend a passed deadline needs to move the deadline,
-- which `open` already does.
--
-- ════════════════════════════════════════════════════════════════════════════
--  2. `pickem_games` joins the realtime publication
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reported: the runner locks, and the player's sheet does not change at all.
--
-- Cause: pick'em is the FIFTH format and the only one wired to neither of the
-- two sync mechanisms CLAUDE.md #19 says all the others have. Match, rack,
-- stroke and non-golf all mount `useRealtimeGame`; pick'em mounts nothing, so
-- its clock changes reached other devices only on a manual reload.
--
-- Migration 084 published the five tables `games.configHash` fingerprints so
-- config edits propagate live. Pick'em's lifecycle lives in `pickem_games`,
-- which was not among them — it did not exist yet. Adding it lets the same
-- `game:{gameId}` channel carry open / lock / unlock / reopen.
--
-- ── Why the CLOCK table and not the picks ──────────────────────────────────
--
-- `pickem_picks` is deliberately NOT published, and must not be. It is the one
-- table in this feature whose whole design is that nobody reads anyone else's
-- rows before the reveal (migration 146, no staff branch). Publishing it would
-- ship pick rows over WAL to a channel whose subscribers are not filtered by
-- that policy — the exact mistake CLAUDE.md #20 warns about when it says the
-- broadcast payload must be a SIGNAL, never data.
--
-- `pickem_games` carries no picks. It carries three timestamps and two
-- settings — the lifecycle, which every member is already entitled to read
-- (`pickem_games_select` is plain trip membership). Nothing secret crosses.
--
-- REPLICA IDENTITY FULL matches what 084 set on its tables, so an UPDATE
-- carries the whole row rather than just the key — the client invalidates
-- rather than reading the payload, but a partial row makes debugging a
-- subscription miserable.

-- ── set_pickem_phase gains `unlock` ────────────────────────────────────────
--
-- Re-declared in full (plpgsql has no append). Everything but the new arm is
-- migration 150's body unchanged.
CREATE OR REPLACE FUNCTION public.set_pickem_phase(p_game_id text, p_action text, p_deadline timestamptz DEFAULT NULL)
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
    UPDATE public.pickem_games
       SET picks_opened_at = COALESCE(picks_opened_at, now()),
           picks_deadline = p_deadline,
           picks_locked_at = NULL
     WHERE game_id = p_game_id;

  ELSIF p_action = 'lock' THEN
    UPDATE public.pickem_games SET picks_locked_at = COALESCE(picks_locked_at, now())
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSIF p_action = 'unlock' THEN
    -- The narrow inverse of `lock`. Clears the HAND lock and nothing else —
    -- slate, rankings and sheets are untouched, which is the whole point of it
    -- existing separately from `reopen`.
    --
    -- Guarded on `picks_opened_at IS NOT NULL` for the same reason `lock` is:
    -- unlocking a game that was never opened would leave a game in `building`
    -- with a cleared lock, which is a state nothing reads and nobody asked for.
    UPDATE public.pickem_games SET picks_locked_at = NULL
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSIF p_action = 'reopen' THEN
    -- Back to `building`. Picks SURVIVE — that is what 148's upsert protects.
    -- The RANKING does not: see migration 150 for why clearing entirely beats
    -- renumbering. Use `unlock` if the slate is not changing.
    UPDATE public.pickem_picks SET confidence = NULL, updated_at = now()
     WHERE game_id = p_game_id AND confidence IS NOT NULL;

    UPDATE public.pickem_games
       SET picks_opened_at = NULL, picks_locked_at = NULL
     WHERE game_id = p_game_id;

  ELSE
    RAISE EXCEPTION 'BAD_ACTION: expected open, lock, unlock or reopen' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_pickem_phase(text, text, timestamptz) IS
  'The pick''em lifecycle transitions. open refuses an empty slate; lock stamps picks_locked_at; unlock clears ONLY that stamp, leaving slate and rankings intact (migration 151); reopen returns to building, keeps every pick and clears every ranking (migration 150). The deadline is evaluated lazily by pickem_picks_open/_revealed because no scheduler exists — so unlocking past a deadline is a no-op by design.';

-- ── pickem_games joins the realtime publication ────────────────────────────
ALTER TABLE public.pickem_games REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pickem_games'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pickem_games;
  END IF;
END $$;

COMMENT ON TABLE public.pickem_games IS
  'One pick''em game''s lifecycle clock and its two scoring settings. Published for realtime (migration 151) so open/lock/unlock/reopen reach every participant''s sheet live — pick''em was the one format wired to neither realtime nor a poll, so a runner locking picks changed nothing on anyone else''s device until they reloaded. pickem_picks is deliberately NOT published: nobody may read another sheet before the reveal, and WAL does not respect that policy.';
