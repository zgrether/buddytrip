-- 037 — games.tee_time (Slice B)
--
-- First tee time set on the match-play new-game screen; drives the
-- "Matchups are set · tees off {time}" banner on the activated matchup page.
-- Stored as "HH:MM" 24h text (formatted client-side); nullable. Idempotent.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS tee_time text;
