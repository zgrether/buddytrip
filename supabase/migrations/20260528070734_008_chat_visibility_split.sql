-- Migration 008 — crew / organizer chat split + member visibility floors
--
-- Splits the trip message channel into two sub-channels via
-- messages.visibility:
--   'crew'     — visible to every trip member (the existing chat)
--   'planning' — visible to Owner + Planner only (Organizers chat)
--
-- Adds messages.message_type so the server can post 'system' lifecycle
-- lines (member added / promoted) alongside 'user' chat — system rows
-- have no author, so user_id becomes nullable.
--
-- trip_members.chat_visible_from / planning_visible_from are per-member
-- history floors: NULL = sees all history; a timestamp = the member was
-- added (chat) or promoted (planning) at that point and only sees
-- messages from there forward. Enforced in the messages.list query
-- (RLS can't trivially reach the requester's trip_members row).
--
-- NOTE: these columns + policies already exist on the live database —
-- they were applied directly during an earlier spike whose migration
-- history rows were later pruned, so this file never got committed.
-- Everything here is idempotent (ADD COLUMN IF NOT EXISTS, DROP POLICY
-- IF EXISTS + CREATE) so it's a no-op against prod and a full create on
-- a fresh database, finally reconciling the committed history with the
-- schema that's actually deployed.

-- ── messages: new columns ──────────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'crew',
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'user';

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_visibility_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_visibility_check CHECK (visibility IN ('crew', 'planning'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_message_type_check CHECK (message_type IN ('user', 'system'));

-- System messages have no author.
ALTER TABLE messages ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN messages.visibility IS
  'Sub-channel within channel=trip. crew = visible to all members; planning = visible only to owners + planners (Organizers chat).';
COMMENT ON COLUMN messages.message_type IS
  'user = posted by a person via the chat composer; system = server-emitted lifecycle event (member added, promoted, etc.).';

-- ── trip_members: visibility floor columns ─────────────────────────────────

ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS chat_visible_from timestamptz,
  ADD COLUMN IF NOT EXISTS planning_visible_from timestamptz;

COMMENT ON COLUMN trip_members.chat_visible_from IS
  'NULL = sees all Crew chat history. Set to NOW() when a new member is added so they do not see prior banter. Enforced in messages.list.';
COMMENT ON COLUMN trip_members.planning_visible_from IS
  'NULL = sees all Organizers chat history. Set to NOW() when a member is promoted so they do not see prior owner/planner chatter. Enforced in messages.list.';

-- ── messages RLS — visibility=planning role gate ───────────────────────────

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (auth.uid())::text)
    AND is_trip_member(trip_id)
    AND message_type = 'user'
    AND (
      (channel = 'trip'::text)
      OR (
        (channel = 'team'::text)
        AND EXISTS (
          SELECT 1 FROM team_assignments ta
          JOIN competitions c ON c.id = ta.competition_id
          WHERE c.trip_id = messages.trip_id
            AND ta.team_id = messages.team_id
            AND ta.user_id = (auth.uid())::text
        )
      )
    )
    AND (
      (visibility = 'crew'::text)
      OR ((visibility = 'planning'::text) AND is_trip_planner(trip_id))
    )
  );

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    is_trip_member(trip_id)
    AND (
      (channel = 'trip'::text)
      OR (
        (channel = 'team'::text)
        AND EXISTS (
          SELECT 1 FROM team_assignments ta
          JOIN competitions c ON c.id = ta.competition_id
          WHERE c.trip_id = messages.trip_id
            AND ta.team_id = messages.team_id
            AND ta.user_id = (auth.uid())::text
        )
      )
    )
    AND (
      (visibility = 'crew'::text)
      OR ((visibility = 'planning'::text) AND is_trip_planner(trip_id))
    )
  );
