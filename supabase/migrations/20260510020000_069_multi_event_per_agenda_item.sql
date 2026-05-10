-- ════════════════════════════════════════════════════════════════════════════
-- 069 — Allow multiple competition events per agenda item
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 067 added a UNIQUE index on events.agenda_item_id, enforcing a
-- 1:1 relationship between competition events and agenda items. We're
-- relaxing this to many:1 — multiple competition events (e.g. a golf round
-- AND a skins game) can now link to the same agenda item.
--
-- The schedule_items.competition_event_id back-reference becomes a legacy
-- column; display is now driven by querying events.agenda_item_id from the
-- other direction (array of events per schedule item). The column stays so
-- existing data and constraints are not broken.
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS events_agenda_item_unique;
