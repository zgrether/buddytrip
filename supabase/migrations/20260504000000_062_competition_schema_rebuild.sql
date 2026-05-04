-- ════════════════════════════════════════════════════════════════════════════
-- 062 — Competition schema rebuild
-- ════════════════════════════════════════════════════════════════════════════
-- Wipes the legacy competition data model and lays down the rebuild defined
-- in CC_COMPETITION_SETUP. The new model:
--
--   competitions  ← container (1 per trip in MVP, schema allows N)
--     ├── teams                   (with team_assignments join table)
--     ├── events                  (scored activities — GOLF or GENERIC)
--     │     ├── event_point_distributions
--     │     └── play_groups       (per-event tee time groupings)
--     └── (future) leaderboard derivation
--
-- Audit findings (verified against migrations before writing):
--   • users.id and trips.id are TEXT — new tables use TEXT PKs to match.
--   • trips.event_id is dead (the new model points trip ← competition).
--   • group_results already had event_id added in 006; here we drop the
--     stale round_id column + retarget the FK.
--   • player_hole_scores has only round_id; rename → event_id + retarget.
--   • Drop hole_results, group_result_scores, players — transitively
--     orphaned by losing rounds/teams/events; Phase B rebuilds scoring.
--   • scoreboard_shares.event_id renamed to competition_id (new FK target).
--   • messages.team_id FK rebound to new teams table, existing rows nulled.
--   • activate_round() RPC dropped — rounds concept retired.
--   • supabase_realtime publication: drop side_events + group_results, add
--     events + group_results back after the FK retarget completes.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Strip realtime publication entries so DROP TABLE doesn't fail
-- ────────────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime DROP TABLE side_events;
ALTER PUBLICATION supabase_realtime DROP TABLE group_results;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Drop the activate_round RPC (rounds concept retired)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS activate_round(text, text);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Drop RLS policies on retained tables that reference the dropped
--    rounds/events tables (so they don't block the column rewrites)
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS group_results_select       ON group_results;
DROP POLICY IF EXISTS group_results_insert       ON group_results;
DROP POLICY IF EXISTS group_results_update       ON group_results;
DROP POLICY IF EXISTS group_results_delete       ON group_results;
DROP POLICY IF EXISTS player_hole_scores_select  ON player_hole_scores;
DROP POLICY IF EXISTS player_hole_scores_insert  ON player_hole_scores;

-- scoreboard_shares policies are scoped via trip_members only (not events),
-- so they survive the column rename. Drop the old "create" policy because
-- it referenced auth.uid() without ::text cast in 007 — recreate cleanly.
DROP POLICY IF EXISTS "Anyone can read scoreboard shares" ON scoreboard_shares;
DROP POLICY IF EXISTS "Trip members can create scoreboard shares" ON scoreboard_shares;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Truncate retained scoring tables (rows reference dropped IDs)
-- ────────────────────────────────────────────────────────────────────────────
TRUNCATE TABLE
  group_results,
  player_hole_scores,
  scoreboard_shares
  CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Null out / drop FKs on tables that survive but reference soon-dropped
-- ────────────────────────────────────────────────────────────────────────────
-- messages.chk_team_channel requires that channel='team' rows always carry a
-- non-null team_id. Demote any team-channel rows to trip-channel atomically
-- with the team_id null so the CHECK constraint never sees an invalid row.
UPDATE messages
   SET team_id = NULL,
       channel = 'trip'
 WHERE team_id IS NOT NULL;
UPDATE trips    SET event_id = NULL WHERE event_id IS NOT NULL;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_team_id_fkey;

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS fk_trips_event_id;
DROP INDEX IF EXISTS idx_trips_event_id;
ALTER TABLE trips DROP COLUMN IF EXISTS event_id;

-- Drop FKs on retained scoring tables before dropping target tables
ALTER TABLE group_results
  DROP CONSTRAINT IF EXISTS group_results_round_id_fkey,
  DROP CONSTRAINT IF EXISTS group_results_group_id_fkey,
  DROP CONSTRAINT IF EXISTS group_results_event_id_fkey,
  DROP CONSTRAINT IF EXISTS group_results_pkey;

ALTER TABLE player_hole_scores
  DROP CONSTRAINT IF EXISTS player_hole_scores_round_id_fkey,
  DROP CONSTRAINT IF EXISTS player_hole_scores_group_id_fkey,
  DROP CONSTRAINT IF EXISTS player_hole_scores_pkey;

ALTER TABLE scoreboard_shares
  DROP CONSTRAINT IF EXISTS scoreboard_shares_event_id_fkey,
  DROP CONSTRAINT IF EXISTS scoreboard_shares_event_id_key;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Drop legacy competition tables (children → parents).
--    CASCADE removes residual policies and indexes automatically.
-- ────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS group_result_scores CASCADE;
DROP TABLE IF EXISTS hole_results        CASCADE;
DROP TABLE IF EXISTS players             CASCADE;
DROP TABLE IF EXISTS team_assignments    CASCADE;
DROP TABLE IF EXISTS play_groups         CASCADE;
DROP TABLE IF EXISTS side_events         CASCADE;
DROP TABLE IF EXISTS rounds              CASCADE;
DROP TABLE IF EXISTS teams               CASCADE;
DROP TABLE IF EXISTS events              CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Reshape retained scoring tables to new model
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE group_results DROP COLUMN IF EXISTS round_id;
DROP INDEX IF EXISTS idx_group_results_round_id;
DROP INDEX IF EXISTS idx_group_results_event_id;

-- player_hole_scores keeps round_id as its naming → rename to event_id
ALTER TABLE player_hole_scores RENAME COLUMN round_id TO event_id;
DROP INDEX IF EXISTS idx_player_hole_scores_round_group;

ALTER TABLE scoreboard_shares RENAME COLUMN event_id TO competition_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. NEW TABLES
-- ════════════════════════════════════════════════════════════════════════════

-- competitions ────────────────────────────────────────────────────────────
CREATE TABLE competitions (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  trip_id     text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name        text NOT NULL,
  tagline     text,
  motto       text,
  status      text NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming','active','completed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX competitions_trip_id_idx ON competitions(trip_id);

-- teams ───────────────────────────────────────────────────────────────────
CREATE TABLE teams (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id  text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name            text NOT NULL,
  short_name      text NOT NULL CHECK (char_length(short_name) <= 4),
  color           text NOT NULL,
  color_dim       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_competition_id_idx ON teams(competition_id);

-- team_assignments ────────────────────────────────────────────────────────
CREATE TABLE team_assignments (
  competition_id  text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  team_id         text NOT NULL REFERENCES teams(id)        ON DELETE CASCADE,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, user_id)
);
CREATE INDEX team_assignments_team_id_idx ON team_assignments(team_id);

-- events (scored activities) ──────────────────────────────────────────────
CREATE TABLE events (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id    text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('GOLF','GENERIC')),
  title             text NOT NULL,
  description       text,
  scoring_format    text CHECK (
                      scoring_format IS NULL OR
                      scoring_format IN (
                        'scramble','stableford','skins',
                        'match_play','singles','sabotage','other'
                      )
                    ),
  course_id         uuid REFERENCES golf_courses(id) ON DELETE SET NULL,
  is_practice       boolean NOT NULL DEFAULT false,
  points_available  numeric,
  day               int,
  status            text NOT NULL DEFAULT 'upcoming'
                    CHECK (status IN ('upcoming','active','completed')),
  modifiers         jsonb,
  result            jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_competition_id_idx ON events(competition_id);

-- event_point_distributions ───────────────────────────────────────────────
CREATE TABLE event_point_distributions (
  id        text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id  text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position  int  NOT NULL CHECK (position >= 1),
  label     text NOT NULL,
  points    numeric NOT NULL CHECK (points >= 0),
  UNIQUE (event_id, position)
);
CREATE INDEX event_point_distributions_event_id_idx
  ON event_point_distributions(event_id);

-- play_groups (per-event) ─────────────────────────────────────────────────
CREATE TABLE play_groups (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id    text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text,
  tee_time    text,
  player_ids  text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX play_groups_event_id_idx ON play_groups(event_id);

-- golf_course_details (scorecard data, separate from golf_courses registry)
CREATE TABLE golf_course_details (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  golf_course_id  uuid NOT NULL UNIQUE REFERENCES golf_courses(id)
                  ON DELETE CASCADE,
  external_id     text UNIQUE,
  club_name       text,
  holes           jsonb,
  tee_boxes       jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Reattach FKs on retained tables now that targets exist
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE group_results
  ADD CONSTRAINT group_results_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  ADD CONSTRAINT group_results_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES play_groups(id) ON DELETE CASCADE,
  ADD PRIMARY KEY (event_id, group_id);

CREATE INDEX idx_group_results_event_id ON group_results(event_id);

ALTER TABLE player_hole_scores
  ADD CONSTRAINT player_hole_scores_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  ADD CONSTRAINT player_hole_scores_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES play_groups(id) ON DELETE CASCADE,
  ADD PRIMARY KEY (event_id, group_id, hole_number, player_id);

CREATE INDEX idx_player_hole_scores_event_group
  ON player_hole_scores(event_id, group_id);

ALTER TABLE scoreboard_shares
  ADD CONSTRAINT scoreboard_shares_competition_id_fkey
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
  ADD CONSTRAINT scoreboard_shares_competition_id_key UNIQUE (competition_id);

ALTER TABLE messages
  ADD CONSTRAINT messages_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Realtime publication: re-add events + group_results
-- ════════════════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE group_results;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. RLS — enable + policies
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE competitions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_point_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE golf_course_details       ENABLE ROW LEVEL SECURITY;

-- competitions ────────────────────────────────────────────────────────────
CREATE POLICY competitions_select ON competitions FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
CREATE POLICY competitions_insert ON competitions FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner','Planner']));
CREATE POLICY competitions_update ON competitions FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner','Planner']));
CREATE POLICY competitions_delete ON competitions FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner']));

-- teams (canEdit for writes; Owner only for delete) ───────────────────────
CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = teams.competition_id AND is_trip_member(c.trip_id)
  ));
CREATE POLICY teams_insert ON teams FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = teams.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY teams_update ON teams FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = teams.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY teams_delete ON teams FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = teams.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner'])
  ));

-- team_assignments (canEdit assign; Owner remove) ─────────────────────────
CREATE POLICY team_assignments_select ON team_assignments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = team_assignments.competition_id
      AND is_trip_member(c.trip_id)
  ));
CREATE POLICY team_assignments_insert ON team_assignments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = team_assignments.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY team_assignments_update ON team_assignments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = team_assignments.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY team_assignments_delete ON team_assignments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = team_assignments.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner'])
  ));

-- events (canEdit for writes) ─────────────────────────────────────────────
CREATE POLICY events_select ON events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = events.competition_id AND is_trip_member(c.trip_id)
  ));
CREATE POLICY events_insert ON events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = events.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY events_update ON events FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = events.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY events_delete ON events FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = events.competition_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));

-- event_point_distributions ───────────────────────────────────────────────
CREATE POLICY epd_select ON event_point_distributions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id
      AND is_trip_member(c.trip_id)
  ));
CREATE POLICY epd_insert ON event_point_distributions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY epd_update ON event_point_distributions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY epd_delete ON event_point_distributions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));

-- play_groups ─────────────────────────────────────────────────────────────
CREATE POLICY play_groups_select ON play_groups FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = play_groups.event_id AND is_trip_member(c.trip_id)
  ));
CREATE POLICY play_groups_insert ON play_groups FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = play_groups.event_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY play_groups_update ON play_groups FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = play_groups.event_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));
CREATE POLICY play_groups_delete ON play_groups FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = play_groups.event_id
      AND has_trip_role(c.trip_id, ARRAY['Owner','Planner'])
  ));

-- golf_course_details — anyone reads, authenticated writes (course registry)
CREATE POLICY golf_course_details_select ON golf_course_details FOR SELECT
  USING (true);
CREATE POLICY golf_course_details_insert ON golf_course_details FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY golf_course_details_update ON golf_course_details FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Restore RLS on retained scoring tables (group_results, player_hole_scores)
-- now scoped via event → competition → trip
CREATE POLICY group_results_select ON group_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = group_results.event_id AND is_trip_member(c.trip_id)
  ));
CREATE POLICY group_results_insert ON group_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = group_results.event_id AND is_trip_member(c.trip_id)
  ));
CREATE POLICY group_results_update ON group_results FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = group_results.event_id AND is_trip_member(c.trip_id)
  ));

CREATE POLICY player_hole_scores_select ON player_hole_scores FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = player_hole_scores.event_id AND is_trip_member(c.trip_id)
  ));
CREATE POLICY player_hole_scores_insert ON player_hole_scores FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = player_hole_scores.event_id AND is_trip_member(c.trip_id)
  ));

-- scoreboard_shares — public read by id, trip members can create
CREATE POLICY scoreboard_shares_anon_select ON scoreboard_shares FOR SELECT
  USING (true);
CREATE POLICY scoreboard_shares_insert ON scoreboard_shares FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trip_members
      WHERE trip_members.trip_id = scoreboard_shares.trip_id
        AND trip_members.user_id = auth.uid()::text
    )
  );

COMMIT;
