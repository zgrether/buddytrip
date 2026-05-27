-- BuddyTrip — Local dev seed
--
-- Rewritten 2026-05-17 during pre-launch cleanup. The previous seed
-- referenced 30+ CC-generated test users and was tied to the old
-- pre-reset database. After the post-cleanup reset, the only real auth
-- users are Zach's account + one manual test account.
--
-- Before running this file:
--   1. Sign up Zach's account via the live app (real Google OAuth flow)
--   2. Sign up one secondary test account (e.g. an alias)
--   3. Pull the two auth user UUIDs from auth.users:
--        SELECT id, email FROM auth.users;
--   4. Replace OWNER_ID and CREW_ID below with the actual UUIDs
--   5. Run: psql $DATABASE_URL -f supabase/seed.sql
--
-- This seed creates ONE trip in PLANNING stage with:
--   - destination locked to a real place
--   - a date window
--   - 2 confirmed + 1 unconfirmed schedule items (to test the
--     TripSummaryModal Schedule CountRow fix from Phase 2 Task 1)
--   - 2 lodging items
--   - 1 competition with 2 teams + 1 round
--
-- ~30 rows total. NO test-* users, NO CC-generated UUIDs.
--
-- The catalog_ideas table is seeded independently via
-- supabase/seed_catalog.sql (run manually).

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- ═══════════════════════════════════════════════════════════════
-- REPLACE THESE TWO IDs with real auth.users.id values before running
-- ═══════════════════════════════════════════════════════════════
\set owner_id    '''REPLACE_WITH_ZACH_AUTH_UUID'''
\set crew_id     '''REPLACE_WITH_TEST_AUTH_UUID'''

-- ═══════════════════════════════════════════════════════════════
-- 1. USERS — public.users mirror of the two auth users
--    (handle_new_user trigger normally does this on signup, but
--     re-asserting it here makes the seed self-contained.)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO users (id, name, email, created_at) VALUES
  (:owner_id, 'Zach Grether', 'zgrether@gmail.com',  now()),
  (:crew_id,  'Test Crew',    'test@buddytrip.app',  now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 2. ONE TRIP in PLANNING stage with a locked destination
-- ═══════════════════════════════════════════════════════════════

INSERT INTO trips (
  id, title, description, stage, planning_tier,
  locked_destination_title, locked_destination_location, locked_destination_at,
  start_date, end_date,
  activities, golf_courses,
  comparison_mode, poll_mode, itinerary_enabled, getting_there_enabled,
  quick_info_dismissed, travel_plans_crew_visible, planning_skipped,
  created_at, updated_at
) VALUES (
  'seed-trip-bbmi-2027',
  'BBMI 2027',
  'Annual Brad-and-Brothers Mostly Invitational. Bandon Dunes edition.',
  'planning',
  'standard',
  'Bandon Dunes',
  'Bandon, OR',
  now(),
  '2027-09-15', '2027-09-19',
  ARRAY['Golf', 'Hiking']::text[],
  ARRAY['Bandon Dunes', 'Pacific Dunes']::text[],
  false, false, true, true,
  false, true, '{}'::jsonb,
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 3. TRIP MEMBERS — owner + 1 crew member
-- ═══════════════════════════════════════════════════════════════

INSERT INTO trip_members (id, trip_id, user_id, role, status, joined_at, travel_shared) VALUES
  ('seed-tm-owner', 'seed-trip-bbmi-2027', :owner_id, 'owner',  'in',    now(), true),
  ('seed-tm-crew',  'seed-trip-bbmi-2027', :crew_id,  'member', 'going', now(), true)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 4. DATE POLL with one window (locked)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO date_polls (trip_id, open, notify_sent, locked_window_id, created_at)
  VALUES ('seed-trip-bbmi-2027', false, true, 'seed-dw-bbmi', now())
  ON CONFLICT (trip_id) DO NOTHING;

INSERT INTO date_windows (id, trip_id, start_date, end_date, created_at) VALUES
  ('seed-dw-bbmi', 'seed-trip-bbmi-2027', '2027-09-15', '2027-09-19', now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 5. SCHEDULE ITEMS — 2 confirmed + 1 unconfirmed
--    (Used to validate the TripSummaryModal Schedule CountRow fix.)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO schedule_items (
  id, trip_id, title, item_type, scheduled_date, scheduled_time,
  is_confirmed, sort_order, created_by, created_at
) VALUES
  (gen_random_uuid(), 'seed-trip-bbmi-2027', 'Pacific Dunes Round 1', 'golf', '2027-09-16', '08:30:00', true,  0, :owner_id, now()),
  (gen_random_uuid(), 'seed-trip-bbmi-2027', 'Old Macdonald Round 2', 'golf', '2027-09-17', '09:00:00', true,  1, :owner_id, now()),
  (gen_random_uuid(), 'seed-trip-bbmi-2027', 'Sheep Ranch (TBD)',     'golf', '2027-09-18', NULL,       false, 2, :owner_id, now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 6. LODGING — 2 items
-- ═══════════════════════════════════════════════════════════════

INSERT INTO logistics_items (
  id, trip_id, type, label, detail, property_name, address,
  check_in_time, check_out_time, sort_order, is_confirmed,
  created_by, created_at
) VALUES
  (gen_random_uuid(), 'seed-trip-bbmi-2027', 'lodging', 'Lily Pond Cottage', 'Cozy 4-bedroom on-property',
    'Bandon Dunes Resort — Lily Pond', '57744 Round Lake Dr, Bandon, OR 97411',
    '15:00', '11:00', 0, true,  :owner_id, now()),
  (gen_random_uuid(), 'seed-trip-bbmi-2027', 'lodging', 'Inn at Bandon Dunes', 'Backup if Lily Pond falls through',
    'Bandon Dunes Inn',               '57744 Round Lake Dr, Bandon, OR 97411',
    '15:00', '11:00', 1, false, :owner_id, now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 7. COMPETITION — 2 teams + 1 event (one round)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO competitions (id, trip_id, name, tagline, status, scoreboard_style, created_at, updated_at)
  VALUES ('seed-comp-bbmi', 'seed-trip-bbmi-2027', 'BBMI Cup', 'Bring the trophy home', 'upcoming', 'leaderboard', now(), now())
  ON CONFLICT (id) DO NOTHING;

INSERT INTO teams (id, competition_id, name, short_name, color, color_dim, created_at) VALUES
  ('seed-team-blue', 'seed-comp-bbmi', 'Team Blue', 'BLU', '#3b82f6', '#1e3a8a', now()),
  ('seed-team-red',  'seed-comp-bbmi', 'Team Red',  'RED', '#ef4444', '#7f1d1d', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_assignments (competition_id, user_id, team_id, assigned_at) VALUES
  ('seed-comp-bbmi', :owner_id, 'seed-team-blue', now()),
  ('seed-comp-bbmi', :crew_id,  'seed-team-red',  now())
ON CONFLICT DO NOTHING;

INSERT INTO events (
  id, competition_id, type, title, scoring_format,
  is_practice, points_available, day, status, sort_order, created_at, updated_at
) VALUES
  ('seed-event-r1', 'seed-comp-bbmi', 'GOLF', 'Day 1 Scramble', 'scramble',
    false, 10, 1, 'upcoming', 0, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_point_distributions (id, event_id, position, label, points) VALUES
  (gen_random_uuid()::text, 'seed-event-r1', 1, '1st Place', 6),
  (gen_random_uuid()::text, 'seed-event-r1', 2, '2nd Place', 4)
ON CONFLICT DO NOTHING;

COMMIT;
