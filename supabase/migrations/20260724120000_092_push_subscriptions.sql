-- 092 — Web Push subscriptions + per-user notification preferences (Push Phase 2)
--
-- Greenfield: the old notification_events/notification_reads model was dropped
-- in 018 and is NOT resurrected. Push fans out from domain write points (Phase
-- 3), not a persisted event log. This migration only adds the subscription
-- storage + a preferences column; no events, no triggers.
--
-- Additive + idempotent + replayable from zero (Step 0 CI gate).

-- ── push_subscriptions ──────────────────────────────────────────────────────
-- PER-DEVICE, not per-user: a Web Push subscription is scoped to one browser
-- install (one SW registration), so one person with a phone + an iPad has two
-- rows. `endpoint` is the push service's opaque URL and is globally UNIQUE — it
-- IS the device identity, so subscribe upserts on it. text id per the app-wide
-- text-PK convention (uuid FK → text PK would mismatch).
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,       -- client public key (encryption)
  auth          text NOT NULL,       -- client auth secret (encryption)
  user_agent    text,                -- best-effort device label for the prefs UI
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions USING btree (user_id);

-- ── users.notification_prefs ────────────────────────────────────────────────
-- Per-user, per-type on/off as a jsonb map keyed by the registry key
-- (src/lib/notificationTypes.ts): e.g. {"chat": true}. DEFAULTS COME FROM THE
-- REGISTRY at read time, NOT from backfilled rows — an unset key falls back to
-- its registry default, so adding a notification type later needs no migration
-- and no backfill. Empty object = "everything at its registry default".
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── RLS: a user may only see/insert/update/delete their OWN subscriptions ────
-- The subscribe upsert runs server-side via the service-role client (it must
-- reassign an endpoint when a shared device switches accounts, which own-row
-- RLS can't express), so these policies are the defense-in-depth backstop for
-- any direct client access — never the sole gate. Mirrors the codebase norm
-- (has_trip_role-style own-row checks) using auth.uid()::text (ids are text).
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text);

DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text);

DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text);

DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = (auth.uid())::text);
