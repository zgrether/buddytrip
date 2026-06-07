-- 028 — logistics_items column refactor
--
-- The lodging columns were historically misnamed. Live data confirmed the
-- real semantics before this migration:
--   label                 → the property TITLE      ("Killer Beach House")
--   detail                → the booking LINK         (VRBO/Airbnb URL)
--   property_name         → the SLEEPS capacity      ("30")
--   check_in_time         → the check-in DATE        ("2026-09-09")
--   check_out_time        → the check-out DATE       ("2026-09-13")
--   check_in_time_of_day  → the check-in clock TIME  ("16:00")
--   check_out_time_of_day → the check-out clock TIME ("09:00")
--
-- This renames them to honest names and repurposes check_in_time/check_out_time
-- to hold the real clock time (the date moves to new *_date columns):
--   title         (was label)
--   link          (was detail)
--   sleeps        (was property_name)
--   check_in_date / check_out_date   (new — hold the dates)
--   check_in_time / check_out_time   (now hold the clock time, was *_of_day)
--
-- All columns stay `text` — this is a pure rename/repurpose, no retyping.
-- Done pre-launch while the table holds only test data, but written to be
-- safe on real rows too: new columns are added + backfilled before any drop,
-- and the date/time shuffle is a single UPDATE so every SET expression reads
-- the pre-update row values (Postgres semantics) — no ordering hazard.

-- 1. New / renamed columns (additive first).
ALTER TABLE public.logistics_items ADD COLUMN IF NOT EXISTS title          text;
ALTER TABLE public.logistics_items ADD COLUMN IF NOT EXISTS link           text;
ALTER TABLE public.logistics_items ADD COLUMN IF NOT EXISTS sleeps         text;
ALTER TABLE public.logistics_items ADD COLUMN IF NOT EXISTS check_in_date  text;
ALTER TABLE public.logistics_items ADD COLUMN IF NOT EXISTS check_out_date text;

-- 2. Backfill the straight renames.
UPDATE public.logistics_items
SET title  = COALESCE(title, label),
    link   = COALESCE(link, detail),
    sleeps = COALESCE(sleeps, property_name);

-- 3. Move the dates to the new *_date columns AND repurpose check_in_time /
--    check_out_time to hold the clock time. Single statement: every RHS reads
--    the OLD row, so reading check_in_time (old=date) into check_in_date and
--    writing check_in_time = check_in_time_of_day (old=clock) is race-free.
UPDATE public.logistics_items
SET check_in_date  = check_in_time,
    check_out_date = check_out_time,
    check_in_time  = check_in_time_of_day,
    check_out_time = check_out_time_of_day;

-- 4. title carries the old NOT NULL guarantee from label.
ALTER TABLE public.logistics_items ALTER COLUMN title SET NOT NULL;

-- 5. Drop the now-migrated legacy columns.
ALTER TABLE public.logistics_items DROP COLUMN IF EXISTS label;
ALTER TABLE public.logistics_items DROP COLUMN IF EXISTS detail;
ALTER TABLE public.logistics_items DROP COLUMN IF EXISTS property_name;
ALTER TABLE public.logistics_items DROP COLUMN IF EXISTS check_in_time_of_day;
ALTER TABLE public.logistics_items DROP COLUMN IF EXISTS check_out_time_of_day;

-- 6. Document the honest semantics for the next reader.
COMMENT ON COLUMN public.logistics_items.title          IS 'Display title (lodging property name / transport label).';
COMMENT ON COLUMN public.logistics_items.link           IS 'Booking / reference URL (e.g. VRBO, Airbnb).';
COMMENT ON COLUMN public.logistics_items.sleeps         IS 'Lodging sleeps capacity, free text (e.g. "8").';
COMMENT ON COLUMN public.logistics_items.check_in_date  IS 'Lodging check-in date, YYYY-MM-DD.';
COMMENT ON COLUMN public.logistics_items.check_out_date IS 'Lodging check-out date, YYYY-MM-DD.';
COMMENT ON COLUMN public.logistics_items.check_in_time  IS 'Lodging check-in clock time, HH:MM (24h).';
COMMENT ON COLUMN public.logistics_items.check_out_time IS 'Lodging check-out clock time, HH:MM (24h).';
