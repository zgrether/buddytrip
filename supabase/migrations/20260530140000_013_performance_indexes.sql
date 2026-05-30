-- 013: performance indexes
--
-- Composite + covering indexes for the hottest read paths surfaced by the
-- data-loading audit. All are additive and idempotent (IF NOT EXISTS) so CI
-- can re-apply safely.

-- notifications.list filters trip_id + recipient_id and orders by created_at
-- DESC. The pre-existing single-column indexes (trip_id, recipient_id,
-- created_at) each only covered part of the predicate; this composite serves
-- the whole query in one index scan.
CREATE INDEX IF NOT EXISTS idx_notification_events_recipient
  ON public.notification_events (trip_id, recipient_id, created_at DESC);

-- trip_members role filtering within a trip (owner/planner lookups,
-- permission UI). The existing index is on trip_id alone.
CREATE INDEX IF NOT EXISTS idx_trip_members_trip_role
  ON public.trip_members (trip_id, role);

-- schedule.list reads all items for a trip ordered by sort_order.
CREATE INDEX IF NOT EXISTS idx_schedule_items_trip_order
  ON public.schedule_items (trip_id, sort_order);

-- logistics.list — same access pattern.
CREATE INDEX IF NOT EXISTS idx_logistics_items_trip_order
  ON public.logistics_items (trip_id, sort_order);

-- Email lookups (checkEmail / inviteByEmail / ghostCrew) match on the
-- normalized lowercased email via `.eq("email", ...)`. PostgREST/supabase-js
-- can only emit a plain-column predicate (`email = $1`), so a functional
-- lower(email) index would never be chosen and ILIKE could not use a btree at
-- all. We normalize the column to lowercase instead and add a plain btree —
-- the equality lookup now hits the index rather than sequential-scanning.
UPDATE public.users
  SET email = lower(email)
  WHERE email IS NOT NULL AND email <> lower(email);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON public.users (email);
