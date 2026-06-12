-- 042 — play_groups.tee_time (Slice C part 3, rack-n-stack groups)
--
-- Foursomes go off in waves; each group has its own tee time shown in the Groups
-- entry meta ("7:40 tee · thru N"). Stored as "HH:MM" 24h text (formatted
-- client-side), nullable. Idempotent.

ALTER TABLE public.play_groups ADD COLUMN IF NOT EXISTS tee_time text;
