-- ════════════════════════════════════════════════════════════════════════════
-- 067 — Competition ↔ Agenda link; drop venues table
-- ════════════════════════════════════════════════════════════════════════════
-- Replaces the venues/arenas bridge table with direct FK columns on both
-- sides. The link is 1:1 (partial unique indexes). Both sides are nullable
-- so no existing rows are affected.
--
-- Type note:
--   events.id          is TEXT  → schedule_items.competition_event_id is TEXT
--   schedule_items.id  is uuid  → events.agenda_item_id is uuid
-- Both FKs are real constraints (types match their targets).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Drop venues table (was arenas, renamed in 065) ────────────────────────
-- Cascades drop the RLS policies and indexes automatically.
DROP TABLE IF EXISTS venues CASCADE;

-- ── 2. Add sort_order to events ──────────────────────────────────────────────
-- Replaces the old `day` integer as the manual ordering field.
-- day column stays (it was used for trip-day assignment, now unused but
-- harmless — dropping would risk breaking any external references).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- ── 3. Add agenda_item_id to events ─────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS agenda_item_id uuid
    REFERENCES schedule_items(id) ON DELETE SET NULL;

-- Partial unique: one event per agenda item (enforced only when set).
CREATE UNIQUE INDEX IF NOT EXISTS events_agenda_item_unique
  ON events(agenda_item_id)
  WHERE agenda_item_id IS NOT NULL;

-- ── 4. Add competition_event_id to schedule_items ────────────────────────────
ALTER TABLE schedule_items
  ADD COLUMN IF NOT EXISTS competition_event_id text
    REFERENCES events(id) ON DELETE SET NULL;

-- Partial unique: one competition event per agenda item.
CREATE UNIQUE INDEX IF NOT EXISTS schedule_items_competition_event_unique
  ON schedule_items(competition_event_id)
  WHERE competition_event_id IS NOT NULL;

COMMIT;
