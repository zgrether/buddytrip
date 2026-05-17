-- ════════════════════════════════════════════════════════════════════════════
-- 065 — Rebrand arenas → venues
-- ════════════════════════════════════════════════════════════════════════════
-- "Arena" was the working name during the spec; "Venue" is the canonical
-- term going forward. Migration 064 has already been applied to the remote
-- DB, so this is a destructive-free rename of:
--   • the table itself
--   • the implicit PK constraint
--   • the partial unique indexes + the supporting btree index
--   • the CHECK constraint
--   • the four RLS policies
--   • the two arena_*  prefixed columns
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Table + PK
ALTER TABLE arenas RENAME TO venues;
ALTER TABLE venues RENAME CONSTRAINT arenas_pkey TO venues_pkey;

-- Indexes
ALTER INDEX arenas_event_unique         RENAME TO venues_event_unique;
ALTER INDEX arenas_schedule_unique      RENAME TO venues_schedule_unique;
ALTER INDEX arenas_competition_id_idx   RENAME TO venues_competition_id_idx;

-- CHECK constraint
ALTER TABLE venues RENAME CONSTRAINT arenas_has_source TO venues_has_source;

-- Columns: arena_date / arena_time → venue_date / venue_time. is_anytime
-- has no prefix, leave as-is.
ALTER TABLE venues RENAME COLUMN arena_date TO venue_date;
ALTER TABLE venues RENAME COLUMN arena_time TO venue_time;

-- RLS policies (CREATE/DROP rather than ALTER POLICY RENAME — Postgres
-- supports both but RENAME is fewer keystrokes and less to read).
ALTER POLICY arenas_select ON venues RENAME TO venues_select;
ALTER POLICY arenas_insert ON venues RENAME TO venues_insert;
ALTER POLICY arenas_update ON venues RENAME TO venues_update;
ALTER POLICY arenas_delete ON venues RENAME TO venues_delete;

COMMIT;
