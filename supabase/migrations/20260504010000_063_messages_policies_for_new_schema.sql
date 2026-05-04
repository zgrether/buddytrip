-- ════════════════════════════════════════════════════════════════════════════
-- 063 — Repoint messages RLS at the new competition schema
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 062 retired events.trip_id (events now hang off competition_id)
-- and renamed team_assignments.event_id → competition_id. The legacy
-- messages_select / messages_insert policies still reference the old column
-- names in their team-channel branch, which makes Postgres fail to plan ANY
-- insert/select on messages — even trip-channel rows that don't take that
-- branch at runtime — because the policy expression is invalid.
--
-- Drop and recreate both policies pointing at the new shape:
--   team_assignments.competition_id → competitions.trip_id == messages.trip_id
--   team_assignments.team_id        ==  messages.team_id
--   team_assignments.user_id        ==  auth.uid()
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_insert ON messages;

CREATE POLICY messages_select ON messages FOR SELECT TO authenticated
  USING (
    is_trip_member(trip_id)
    AND (
      channel = 'trip'
      OR (channel = 'team' AND EXISTS (
        SELECT 1
          FROM team_assignments ta
          JOIN competitions     c  ON c.id = ta.competition_id
         WHERE c.trip_id = messages.trip_id
           AND ta.team_id = messages.team_id
           AND ta.user_id = auth.uid()::text
      ))
    )
  );

CREATE POLICY messages_insert ON messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()::text
    AND is_trip_member(trip_id)
    AND (
      channel = 'trip'
      OR (channel = 'team' AND EXISTS (
        SELECT 1
          FROM team_assignments ta
          JOIN competitions     c  ON c.id = ta.competition_id
         WHERE c.trip_id = messages.trip_id
           AND ta.team_id = messages.team_id
           AND ta.user_id = auth.uid()::text
      ))
    )
  );

COMMIT;
