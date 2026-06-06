-- ────────────────────────────────────────────────────────────────────────
-- Migration 026 — Default trips.thread_type to 'trip'
-- ────────────────────────────────────────────────────────────────────────
--
-- thread_type was added (migration 024) as a plain nullable text anchor for the
-- unified messaging model. Every existing row is a trip thread, so give the
-- column a sensible default and backfill the nulls. Additive, zero-risk.
-- (The closed set of thread_type values lands with the messaging refactor.)

ALTER TABLE public.trips ALTER COLUMN thread_type SET DEFAULT 'trip';
UPDATE public.trips SET thread_type = 'trip' WHERE thread_type IS NULL;
