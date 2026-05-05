-- ════════════════════════════════════════════════════════════════════════════
-- 064 — Competition arenas
-- ════════════════════════════════════════════════════════════════════════════
-- An "arena" is the venue/time-slot a competition event takes place at.
-- It links a competition event to either:
--   • a schedule_items row (the trip's golf tee time / activity card), or
--   • a manual entry (poker night, cornhole — anything not on the schedule),
--   • or "anytime" — happens during the trip but no fixed time/place.
--
-- schedule_items.id is uuid (the trip's content_model migration kept that
-- table on uuid PKs even though everything else is text). The codebase
-- doesn't have a clean way to bridge text ↔ uuid in a FK constraint, so
-- arenas.schedule_item_id is text WITHOUT a FK; the routers validate the
-- referenced row exists and belongs to the same trip on insert.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE arenas (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id    text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  -- Schedule linkage — uuid stored as text. App-level integrity check.
  schedule_item_id  text,
  -- Event linkage — when set, this arena IS where the event takes place.
  event_id          text REFERENCES events(id) ON DELETE SET NULL,
  -- Manual arena fields (null when arena was created from a schedule item).
  name              text,
  location          text,
  arena_date        date,
  arena_time        text,
  is_anytime        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arenas_has_source CHECK (
    schedule_item_id IS NOT NULL OR name IS NOT NULL
  )
);

-- One arena row per (competition, event) and (competition, schedule_item)
-- so we never end up with duplicates. event_id is nullable; the partial
-- unique guard only enforces uniqueness when the column is set.
CREATE UNIQUE INDEX arenas_event_unique
  ON arenas(competition_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX arenas_schedule_unique
  ON arenas(competition_id, schedule_item_id)
  WHERE schedule_item_id IS NOT NULL;

CREATE INDEX arenas_competition_id_idx ON arenas(competition_id);

ALTER TABLE arenas ENABLE ROW LEVEL SECURITY;

-- Trip members can read; Owner / Planner can write. Routes through
-- competitions → trip_members the same way the rest of the comp tables do.
CREATE POLICY arenas_select ON arenas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = arenas.competition_id AND is_trip_member(c.trip_id)
  ));

CREATE POLICY arenas_insert ON arenas FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = arenas.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));

CREATE POLICY arenas_update ON arenas FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = arenas.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));

CREATE POLICY arenas_delete ON arenas FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = arenas.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));

COMMIT;
