-- ============================================================
-- 012: Ghost crew support
--
-- Adds guest_crew table for non-account crew members.
-- Alters trip_members and team_assignments to support both
-- real users and ghost crew.
-- ============================================================

-- ── 1. Create ghost_crew table ─────────────────────────────

CREATE TABLE guest_crew (
  id           text PRIMARY KEY,
  trip_id      text NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  name         text NOT NULL,
  email        text,
  role         text NOT NULL DEFAULT 'Member' CHECK (role IN ('Owner', 'Planner', 'Member')),
  invited_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_guest_crew_trip_id ON guest_crew (trip_id);
-- Prevent duplicate emails per trip (only where email is provided)
CREATE UNIQUE INDEX idx_guest_crew_trip_email ON guest_crew (trip_id, email) WHERE email IS NOT NULL;

-- ── 2. Alter trip_members ──────────────────────────────────

-- Add surrogate id as new PK
ALTER TABLE trip_members ADD COLUMN id text;
UPDATE trip_members SET id = gen_random_uuid()::text;
ALTER TABLE trip_members ALTER COLUMN id SET NOT NULL;
ALTER TABLE trip_members ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Add guest_crew_id column
ALTER TABLE trip_members ADD COLUMN guest_crew_id text REFERENCES guest_crew (id) ON DELETE CASCADE;

-- Make user_id nullable to allow ghost-only rows
ALTER TABLE trip_members ALTER COLUMN user_id DROP NOT NULL;

-- Drop old composite PK
ALTER TABLE trip_members DROP CONSTRAINT trip_members_pkey;

-- Add new surrogate PK
ALTER TABLE trip_members ADD PRIMARY KEY (id);

-- Exactly one identity must be set
ALTER TABLE trip_members ADD CONSTRAINT chk_trip_member_identity
  CHECK (
    (user_id IS NOT NULL AND guest_crew_id IS NULL) OR
    (user_id IS NULL AND guest_crew_id IS NOT NULL)
  );

-- Enforce uniqueness per trip (partial indexes work on nullable cols)
CREATE UNIQUE INDEX idx_trip_members_trip_user  ON trip_members (trip_id, user_id)       WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_trip_members_trip_guest ON trip_members (trip_id, guest_crew_id) WHERE guest_crew_id IS NOT NULL;

-- ── 3. Alter team_assignments ──────────────────────────────

-- Add surrogate id as new PK
ALTER TABLE team_assignments ADD COLUMN id text;
UPDATE team_assignments SET id = gen_random_uuid()::text;
ALTER TABLE team_assignments ALTER COLUMN id SET NOT NULL;
ALTER TABLE team_assignments ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Add guest_crew_id column
ALTER TABLE team_assignments ADD COLUMN guest_crew_id text REFERENCES guest_crew (id) ON DELETE CASCADE;

-- Make user_id nullable
ALTER TABLE team_assignments ALTER COLUMN user_id DROP NOT NULL;

-- Drop old composite PK
ALTER TABLE team_assignments DROP CONSTRAINT team_assignments_pkey;

-- Add new surrogate PK
ALTER TABLE team_assignments ADD PRIMARY KEY (id);

-- Exactly one identity must be set
ALTER TABLE team_assignments ADD CONSTRAINT chk_team_assignment_identity
  CHECK (
    (user_id IS NOT NULL AND guest_crew_id IS NULL) OR
    (user_id IS NULL AND guest_crew_id IS NOT NULL)
  );

-- Enforce one assignment per user/guest per event
CREATE UNIQUE INDEX idx_team_assignments_event_user  ON team_assignments (event_id, user_id)       WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_team_assignments_event_guest ON team_assignments (event_id, guest_crew_id) WHERE guest_crew_id IS NOT NULL;

-- ── 4. RLS for guest_crew ──────────────────────────────────

ALTER TABLE guest_crew ENABLE ROW LEVEL SECURITY;

-- Any trip member can view ghost crew
CREATE POLICY guest_crew_select ON guest_crew FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

-- Owner or Planner can create ghost crew
CREATE POLICY guest_crew_insert ON guest_crew FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

-- Owner or Planner can edit ghost crew
CREATE POLICY guest_crew_update ON guest_crew FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner', 'Planner']));

-- Owner only can delete ghost crew
CREATE POLICY guest_crew_delete ON guest_crew FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner']));
