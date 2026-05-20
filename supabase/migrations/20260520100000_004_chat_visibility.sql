-- Migration 004 — chat visibility split + visibility gates on trip_members
-- Spec: CC_CREW_OVERHAUL.md Parts 2.1, 2.2, 2.5
--
-- Adds a second logical chat channel ("Organizers") that lives alongside the
-- existing Crew chat. Both share the messages.channel = 'trip' row family;
-- the new `visibility` column distinguishes who can read/write each.
--
-- Two new columns on messages:
--   visibility    — 'crew' (default) | 'planning' (organizers-only)
--   message_type  — 'user' (default) | 'system' (server-posted lifecycle events)
--
-- Two new columns on trip_members. Both are NULL by default → no backfill
-- restriction. Setting them to a timestamp creates a one-way history floor:
-- the member sees messages created at-or-after that timestamp only.
--   chat_visible_from      — gates Crew chat. Set to NOW() when a member is
--                            newly added so they don't see prior banter.
--   planning_visible_from  — gates Organizers chat. Set to NOW() on promotion
--                            so a newly-minted organizer doesn't see prior
--                            owner/planner-only chatter.
--
-- The visibility-gate (role check) is enforced in RLS via the existing
-- is_trip_planner() helper. The visible-from gate is enforced at the query
-- layer in src/server/routers/messages.ts — RLS cannot trivially reach the
-- requester's trip_members row.

-- ── messages: new columns ──────────────────────────────────────────────────

-- System messages (member added, promoted, etc.) have no author. The original
-- schema declared user_id NOT NULL with ON DELETE SET NULL, which is self-
-- contradictory and blocks system inserts. Relax to nullable here so the
-- ON DELETE SET NULL cascade can fire AND system messages can omit user_id.
ALTER TABLE messages
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'crew',
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'user';

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_visibility_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_visibility_check
    CHECK (visibility IN ('crew', 'planning'));

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_message_type_check
    CHECK (message_type IN ('user', 'system'));

COMMENT ON COLUMN messages.visibility IS
  'Sub-channel within messages.channel=trip. crew = visible to all members; planning = visible only to owners + planners.';
COMMENT ON COLUMN messages.message_type IS
  'user = posted by a person via the chat composer; system = server-emitted lifecycle event (member added, promoted, etc.).';

-- ── trip_members: visibility floor columns ─────────────────────────────────

ALTER TABLE trip_members
  ADD COLUMN IF NOT EXISTS chat_visible_from timestamptz,
  ADD COLUMN IF NOT EXISTS planning_visible_from timestamptz;

COMMENT ON COLUMN trip_members.chat_visible_from IS
  'NULL = sees all Crew chat history. Set to NOW() when a new member is added so they do not see prior banter. Enforced in messages.list query.';
COMMENT ON COLUMN trip_members.planning_visible_from IS
  'NULL = sees all Organizers chat history. Set to NOW() when a member is promoted so they do not see prior owner/planner chatter. Enforced in messages.list query.';

-- ── messages RLS — add visibility=planning role gate ───────────────────────
-- Existing channel/team checks stay. We layer on:
--   - SELECT: visibility='planning' implies is_trip_planner(trip_id)
--   - INSERT: same role gate, plus system messages are bypass-only via the
--             service role client (RLS doesn't apply there) — no client-side
--             path to message_type='system'.

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (auth.uid())::text)
    AND is_trip_member(trip_id)
    -- System messages are server-only (service role bypasses RLS).
    AND message_type = 'user'
    -- Channel/team scope (unchanged from migration 001).
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
    -- Visibility scope: anyone can post to Crew chat; only owner/planner
    -- can post to the Organizers chat.
    AND (
      (visibility = 'crew'::text)
      OR (
        (visibility = 'planning'::text)
        AND is_trip_planner(trip_id)
      )
    )
  );

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    is_trip_member(trip_id)
    -- Channel/team scope (unchanged from migration 001).
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
    -- Visibility scope.
    AND (
      (visibility = 'crew'::text)
      OR (
        (visibility = 'planning'::text)
        AND is_trip_planner(trip_id)
      )
    )
  );
