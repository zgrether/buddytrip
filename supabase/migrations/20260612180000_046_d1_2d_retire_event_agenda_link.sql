-- 046 · Slice D1 (2d) — retire the legacy event→agenda reverse link column.
--
-- The agenda link flipped to games.schedule_item_id (migration 043 + the
-- commit-2 app flip). The old reverse pointer schedule_items.competition_event_id
-- (→ events.id) is now dead — no app code reads or writes it, and the events
-- table itself is dropped next (047). Retiring this FK column first keeps the
-- table drop in 047 free of inbound references.
--
-- NOTE: game_results.competition_points_earned is deliberately KEPT — despite
-- being flagged "dead", it is still written (always null) by every scoring
-- engine (strokePlay/matchPlay/rackNStack). Placement points stay derived, so
-- the column is inert, but dropping it would break those inserts. A separate
-- cleanup can remove it once the engines stop emitting it.
--
-- Reversible: schedule_items.competition_event_id + its FK were created in the
-- 001 initial schema — re-add from there to restore. Greenfield at write time
-- (0 rows linked), so no data migration. Idempotent (IF EXISTS).

ALTER TABLE public.schedule_items DROP CONSTRAINT IF EXISTS schedule_items_competition_event_id_fkey;
ALTER TABLE public.schedule_items DROP COLUMN IF EXISTS competition_event_id;
