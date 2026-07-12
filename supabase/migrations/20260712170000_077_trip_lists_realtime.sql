-- 077: trip-list realtime — push quick-info / lodging / schedule changes to
-- every client (Wave 1: cross-device freshness).
--
-- quickInfoTiles.list, logistics.list, and schedule.list are read by the
-- always-mounted trip page (and the never-remounting header dock / itinerary),
-- but their tables were NOT in the supabase_realtime publication — unlike
-- trip_members (mig 017), competitions (mig 071), and messages. So the ACTING
-- device updated instantly (its mutation invalidates the read key), but ANOTHER
-- member's screen served cached data up to the global 60s staleTime
-- (refetchOnWindowFocus is off) — the "doesn't show until refresh" symptom.
--
-- Adding these three tables to the realtime publication lets useRealtimeTripData
-- invalidate the matching list query the moment any row changes, so tiles /
-- check-in-out / schedule edits re-resolve live for everyone. (Wave 1 Phase 0
-- confirmed the staleness is cross-device, not a missing invalidation — the
-- mutations are already correctly wired.)
--
-- REPLICA IDENTITY FULL: the client subscriptions filter on trip_id. For
-- INSERT/UPDATE the new row carries trip_id, so the default (primary-key)
-- replica identity is enough. For DELETE, Postgres emits only the replica-
-- identity columns — with the default that's just the PK, so a trip_id-filtered
-- DELETE event would never match and removals (deleting a tile / lodging item /
-- schedule item) wouldn't propagate. FULL exposes the old row (including
-- trip_id) so deletes reach subscribers too. (Same rationale as mig 017 for
-- trip_members.)

ALTER TABLE public.quick_info_tiles REPLICA IDENTITY FULL;
ALTER TABLE public.logistics_items REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'quick_info_tiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quick_info_tiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'logistics_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.logistics_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'schedule_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_items;
  END IF;
END $$;
