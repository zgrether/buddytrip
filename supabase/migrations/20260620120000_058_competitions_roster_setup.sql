-- Competition-face redesign: land on the bones board, retire the setup guide.
--
-- The roster-build → save → signpost-dismiss progression is ONE narrowly-defined
-- competition flag (not two booleans — that would permit the invalid
-- `dismissed` without `saved`). One-way:
--   building   → the "Team Rosters" button shows on the board (setup phase)
--   saved      → button gone; a dismissable "moved to Settings" signpost shows
--   dismissed  → clean board (the all-teams page lives in Settings now)

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS roster_setup text NOT NULL DEFAULT 'building';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'competitions_roster_setup_chk'
  ) THEN
    ALTER TABLE public.competitions
      ADD CONSTRAINT competitions_roster_setup_chk
      CHECK (roster_setup IN ('building', 'saved', 'dismissed'));
  END IF;
END $$;

-- Backfill: an existing competition that already has roster assignments is past
-- the roster-setup phase — it should NOT show the Team Rosters button or the
-- "moved" signpost. Idempotent (only advances 'building' rows that have rosters).
UPDATE public.competitions c
SET roster_setup = 'dismissed'
WHERE c.roster_setup = 'building'
  AND EXISTS (SELECT 1 FROM public.team_assignments a WHERE a.competition_id = c.id);
