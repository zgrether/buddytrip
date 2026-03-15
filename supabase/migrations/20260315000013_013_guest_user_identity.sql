-- ============================================================
-- 013: Guest user identity
--
-- Collapses the separate guest_crew table into the users table.
-- Guest crew members become first-class users with is_guest=true,
-- so every FK in the system (expenses, scores, team assignments)
-- just works without special-casing guests at the app layer.
--
-- Migration steps:
--   1. Make users.email and users.nickname nullable (guests may lack these)
--   2. Add users.is_guest and users.created_by
--   3. Migrate guest_crew rows → users rows (same IDs)
--   4. Point trip_members.user_id at migrated guest user IDs
--   5. Point team_assignments.user_id at migrated guest user IDs
--   6. Drop guest_crew_id columns and restore NOT NULL on user_id
--   7. Drop guest_crew table
--   8. Update users RLS to allow inserting/updating guest rows
-- ============================================================

-- ── 1. Make email and nickname nullable ──────────────────────

ALTER TABLE users ALTER COLUMN email     DROP NOT NULL;
ALTER TABLE users ALTER COLUMN nickname  DROP NOT NULL;

-- ── 2. Add is_guest and created_by ───────────────────────────

ALTER TABLE users
  ADD COLUMN is_guest    boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by  text    REFERENCES users (id) ON DELETE SET NULL;

-- ── 3. Migrate guest_crew rows into users ─────────────────────
-- Use guest_crew.name for both name and nickname.
-- For email: carry it over only if no existing users row has that email.

INSERT INTO users (id, name, nickname, email, is_guest, created_at)
SELECT
  gc.id,
  gc.name,
  NULL,
  CASE
    WHEN gc.email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = gc.email)
    THEN gc.email
    ELSE NULL
  END,
  true,
  gc.created_at
FROM guest_crew gc
ON CONFLICT (id) DO NOTHING;

-- ── 4. Drop identity constraints BEFORE the data migration ────
-- (UPDATE sets user_id while guest_crew_id is still set,
--  which would violate the "exactly one" check otherwise)

ALTER TABLE trip_members     DROP CONSTRAINT chk_trip_member_identity;
ALTER TABLE team_assignments DROP CONSTRAINT chk_team_assignment_identity;

-- ── 5. Update trip_members: user_id ← guest_crew_id ──────────

UPDATE trip_members
SET user_id = guest_crew_id
WHERE guest_crew_id IS NOT NULL
  AND user_id IS NULL;

-- ── 6. Update team_assignments: user_id ← guest_crew_id ──────

UPDATE team_assignments
SET user_id = guest_crew_id
WHERE guest_crew_id IS NOT NULL
  AND user_id IS NULL;

-- ── 7a. Clean up trip_members ─────────────────────────────────

ALTER TABLE trip_members DROP COLUMN     guest_crew_id;
ALTER TABLE trip_members ALTER COLUMN    user_id SET NOT NULL;
DROP INDEX IF EXISTS idx_trip_members_trip_guest;

-- ── 7b. Clean up team_assignments ────────────────────────────

ALTER TABLE team_assignments DROP COLUMN     guest_crew_id;
ALTER TABLE team_assignments ALTER COLUMN    user_id SET NOT NULL;
DROP INDEX IF EXISTS idx_team_assignments_event_guest;

-- ── 7. Drop guest_crew table (RLS policies drop automatically) ─

DROP TABLE guest_crew;

-- ── 8. Update users RLS ────────────────────────────────────────
-- Allow inserting guest rows (is_guest=true) from the server.
-- tRPC enforces Planner role before reaching Supabase.

DROP POLICY users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()::text   -- real user registering their own row
    OR is_guest = true       -- guest row created by a trip planner
  );

DROP POLICY users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE TO authenticated
  USING (
    id = auth.uid()::text   -- own row
    OR is_guest = true       -- guest row (tRPC enforces Planner role)
  );
