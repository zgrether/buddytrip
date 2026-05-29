-- Migration 009 — composite chat index for the messages.list query
--
-- The trip chat query (src/server/routers/messages.ts) always filters by a
-- single trip + channel + visibility and returns the newest N rows:
--
--   SELECT ... FROM messages
--   WHERE trip_id = $1 AND channel = $2 AND visibility = $3
--   ORDER BY created_at DESC
--   LIMIT 50
--
-- The existing idx_messages_trip_channel (trip_id, channel) gets Postgres to
-- the right trip, but it must then filter by visibility and sort by created_at
-- in memory on every read. This composite index matches the WHERE + ORDER BY
-- exactly, so the planner can satisfy the query with a single backwards index
-- range scan (no in-memory sort, no visibility filter step) — keeping chat
-- loads O(log n) on trip size no matter how large the table grows overall.
--
-- DESC on created_at matches the ORDER BY direction so the newest rows sit at
-- the start of the scan. Idempotent (IF NOT EXISTS) so it's safe on prod and
-- on a fresh database.

CREATE INDEX IF NOT EXISTS idx_messages_trip_chat
  ON public.messages USING btree (trip_id, channel, visibility, created_at DESC);

-- The standalone created_at index is now redundant: no query filters or sorts
-- by created_at alone (every chat query is scoped to a trip first), and the new
-- composite index covers the only ordered access pattern. Dropping it removes
-- per-insert index-maintenance cost. Idempotent.
DROP INDEX IF EXISTS public.idx_messages_created_at;
