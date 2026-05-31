-- 017: trip_members realtime — push role/roster changes to every client
--
-- Tab visibility and edit permissions derive from trip_members.role via the
-- useTripRole hook (tripMembers.list query). Previously trip_members was NOT
-- in the supabase_realtime publication, so when the Owner demoted an organizer
-- to member (or promoted, added, or removed someone), the *affected* client
-- kept its cached role until the query's staleTime lapsed or the page was
-- refreshed. Concretely: a demoted organizer still saw the organizer-only tabs
-- (Lodging, Schedule, Competition) as if nothing changed.
--
-- Adding trip_members to the realtime publication lets useRealtimeMembers
-- invalidate tripMembers.list the moment any membership row changes, so roles
-- and the roster re-resolve live for everyone — including the person whose own
-- role just changed.
--
-- REPLICA IDENTITY FULL: the client subscription filters on trip_id. For
-- INSERT/UPDATE the new row carries trip_id, so the default (primary-key)
-- replica identity is enough. For DELETE, Postgres only emits the columns in
-- the replica identity — with the default that's just the PK, so a
-- trip_id-filtered DELETE event would never match and member removals wouldn't
-- propagate. FULL makes the old row (including trip_id) available so removals
-- reach subscribers too.

ALTER TABLE public.trip_members REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trip_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_members;
  END IF;
END $$;
