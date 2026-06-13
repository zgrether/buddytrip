-- 047 · Slice D1 (2e) — drop the events tables (unified into games).
--
-- Competition contests are now `games` (migration 043 + the commit-2 agenda-link
-- flip + the §7 CompetitionGamesPanel). Every events consumer has been migrated
-- or removed in this PR:
--   - events tRPC router deleted + unwired from appRouter
--   - ScheduleTab, itinerary, CompetitionHeader read games (not events)
--   - events detail page + useRealtimeEvents hook deleted; scoreboard de-linked
--   - the reverse link column schedule_items.competition_event_id retired (046)
--
-- DROP TABLE auto-removes `events` from the supabase_realtime publication and
-- drops its RLS policies (events_select/insert/update/delete) and its remaining
-- FKs (competition_id, course_id, agenda_item_id). event_point_distributions
-- (child via event_id, policies epd_*) is dropped first.
--
-- Reversible: both table definitions (columns, RLS, publication membership) live
-- in the 001 initial schema — re-run those to restore. Greenfield at write time
-- (1 stray test event + 2 distribution rows, no real user data). Idempotent
-- (IF EXISTS; CASCADE guards against any dependency added after this was written).

DROP TABLE IF EXISTS public.event_point_distributions CASCADE;
DROP TABLE IF EXISTS public.events CASCADE;
