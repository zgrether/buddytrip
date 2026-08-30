-- Migration 010 — per-user chat read state (cross-device)
--
-- Read state used to live only in each browser's localStorage, so it never
-- followed the account: chat all week on a laptop, then open the trip on a
-- phone, and every message looked unread because the phone had no local
-- marker. This table moves the last-read timestamp server-side so the unread
-- badge and the "new messages" divider are correct on every device.
--
-- CORRECTED BY MIGRATION 172 (comment only — no schema claim in this file
-- changed, and nothing here was re-applied). This header used to say
-- "per-channel ... keyed by (trip, user, channel)". It was neither: the column
-- is `visibility`, and the key had no team dimension at all. That mattered —
-- `messages.send` stamps team messages visibility='crew', so a team read row
-- would have collided with the Crew row and reading Team would have marked Crew
-- read. A file describing a key it did not have is how that stayed invisible.
-- 172 adds the dimension and re-keys.
--
-- Modeled on notification_reads (the existing per-user read-tracking table):
-- RLS lets a member read/write only their OWN rows. last_read_at is set to
-- now() each time the viewer opens a channel; unread = messages from others
-- newer than it. Composite PK gives one row per (trip, user, visibility) and
-- makes the markRead upsert a single conflict-target write. (172 extends that
-- PK with `team_key` so team rooms key separately; the upsert stays a single
-- conflict-target write.)
--
-- Idempotent (IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE) so it's safe on a
-- fresh database and a no-op if re-applied. The trips/users FKs cascade, so a
-- deleted trip or merged-away ghost user cleans up its read rows automatically.

CREATE TABLE IF NOT EXISTS chat_reads (
  trip_id      text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility   text NOT NULL DEFAULT 'crew',
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id, visibility)
);

ALTER TABLE chat_reads DROP CONSTRAINT IF EXISTS chat_reads_visibility_check;
ALTER TABLE chat_reads
  ADD CONSTRAINT chat_reads_visibility_check CHECK (visibility IN ('crew', 'planning'));

COMMENT ON TABLE chat_reads IS
  'Per-user, per-channel last-read timestamp for trip chat. Source of truth for unread counts + the new-messages divider, so read state follows the account across devices.';

-- ── RLS — a member reads/writes only their own rows ────────────────────────

ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_reads_select ON public.chat_reads;
CREATE POLICY chat_reads_select ON public.chat_reads FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text AND is_trip_member(trip_id));

DROP POLICY IF EXISTS chat_reads_insert ON public.chat_reads;
CREATE POLICY chat_reads_insert ON public.chat_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text AND is_trip_member(trip_id));

DROP POLICY IF EXISTS chat_reads_update ON public.chat_reads;
CREATE POLICY chat_reads_update ON public.chat_reads FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text AND is_trip_member(trip_id))
  WITH CHECK (user_id = (auth.uid())::text AND is_trip_member(trip_id));
