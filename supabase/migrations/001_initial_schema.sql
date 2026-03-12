-- BuddyTrip — Initial Schema Migration
-- 26 tables created in FK dependency order per SCHEMA.md
-- Circular FK (trips ↔ events) resolved with deferrable constraints

-- 1. users
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  nickname text NOT NULL,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users (email);

-- 2. series
CREATE TABLE series (
  id text PRIMARY KEY,
  name text NOT NULL,
  full_name text NOT NULL,
  years text NOT NULL,
  trip_count integer NOT NULL DEFAULT 0,
  owner_id text NOT NULL REFERENCES users (id)
);

-- 3. trips (event_id FK added later via ALTER TABLE — circular with events)
CREATE TABLE trips (
  id text PRIMARY KEY,
  title text NOT NULL,
  series_id text REFERENCES series (id),
  location text,
  cost_tier text CHECK (cost_tier IN ('$', '$$', '$$$', '$$$$')),
  image_url text,
  description text NOT NULL DEFAULT '',
  start_date date,
  end_date date,
  accommodation text,
  notes text,
  activities text[] NOT NULL DEFAULT '{}',
  golf_courses text[] NOT NULL DEFAULT '{}',
  comparison_mode boolean NOT NULL DEFAULT false,
  event_id text, -- FK added after events table
  locked_destination_title text,
  locked_destination_location text,
  locked_destination_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trips_series_id ON trips (series_id);
CREATE INDEX idx_trips_start_date ON trips (start_date);

-- 4. events (trip_id FK is deferrable to resolve circular dependency)
CREATE TABLE events (
  id text PRIMARY KEY,
  trip_id text NOT NULL,
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  motto text NOT NULL DEFAULT '',
  location text NOT NULL,
  dates text NOT NULL,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
  competition_type text NOT NULL DEFAULT 'RYDER_CUP' CHECK (competition_type IN ('RYDER_CUP', 'NORMAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_events_trip_id FOREIGN KEY (trip_id) REFERENCES trips (id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX idx_events_trip_id ON events (trip_id);

-- Now add the circular FK from trips.event_id → events.id
ALTER TABLE trips
  ADD CONSTRAINT fk_trips_event_id
  FOREIGN KEY (event_id) REFERENCES events (id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX idx_trips_event_id ON trips (event_id);

-- 5. teams
CREATE TABLE teams (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id),
  name text NOT NULL,
  short_name text NOT NULL,
  color text NOT NULL,
  color_dim text NOT NULL
);
CREATE INDEX idx_teams_event_id ON teams (event_id);

-- 6. players
CREATE TABLE players (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id),
  user_id text NOT NULL REFERENCES users (id),
  name text NOT NULL,
  nickname text NOT NULL,
  handicap numeric(4,1) NOT NULL,
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_players_event_id ON players (event_id);
CREATE INDEX idx_players_user_id ON players (user_id);

-- 7. team_assignments
CREATE TABLE team_assignments (
  event_id text NOT NULL REFERENCES events (id),
  team_id text NOT NULL REFERENCES teams (id),
  user_id text NOT NULL REFERENCES users (id),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_team_assignments_event_id ON team_assignments (event_id);
CREATE INDEX idx_team_assignments_event_team ON team_assignments (event_id, team_id);

-- 8. play_groups
CREATE TABLE play_groups (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id),
  name text NOT NULL,
  tee_time text NOT NULL,
  player_ids text[] NOT NULL
);
CREATE INDEX idx_play_groups_event_id ON play_groups (event_id);

-- 9. rounds
CREATE TABLE rounds (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id),
  day integer NOT NULL,
  title text NOT NULL,
  course text NOT NULL,
  format text NOT NULL CHECK (format IN ('scramble', 'stableford', 'sabotage', 'skins', 'match_play', 'singles')),
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'submitted', 'closed')),
  points_available numeric(5,1) NOT NULL,
  closed_at timestamptz,
  closed_by text REFERENCES users (id),
  modifiers jsonb
);
CREATE INDEX idx_rounds_event_id ON rounds (event_id);
CREATE INDEX idx_rounds_event_day ON rounds (event_id, day);

-- 10. side_events
CREATE TABLE side_events (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id),
  name text NOT NULL,
  icon text NOT NULL,
  points_available numeric(5,1) NOT NULL,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'complete')),
  result jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_side_events_event_id ON side_events (event_id);

-- 11. group_results
CREATE TABLE group_results (
  round_id text NOT NULL REFERENCES rounds (id),
  group_id text NOT NULL REFERENCES play_groups (id),
  submitted_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, group_id)
);
CREATE INDEX idx_group_results_round_id ON group_results (round_id);

-- 12. group_result_scores
CREATE TABLE group_result_scores (
  round_id text NOT NULL,
  group_id text NOT NULL,
  team_id text NOT NULL REFERENCES teams (id),
  points numeric(3,1) NOT NULL CHECK (points IN (0, 0.5, 1)),
  PRIMARY KEY (round_id, group_id, team_id),
  FOREIGN KEY (round_id, group_id) REFERENCES group_results (round_id, group_id)
);

-- 12a. hole_results
CREATE TABLE hole_results (
  round_id text NOT NULL REFERENCES rounds (id),
  group_id text NOT NULL REFERENCES play_groups (id),
  hole_number integer NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  carry_value integer NOT NULL DEFAULT 1,
  winner_team_id text REFERENCES teams (id),
  PRIMARY KEY (round_id, group_id, hole_number)
);
CREATE INDEX idx_hole_results_round_group ON hole_results (round_id, group_id);

-- 12b. player_hole_scores
CREATE TABLE player_hole_scores (
  round_id text NOT NULL REFERENCES rounds (id),
  group_id text NOT NULL REFERENCES play_groups (id),
  hole_number integer NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  player_id text NOT NULL REFERENCES users (id),
  strokes integer NOT NULL,
  tee_box text CHECK (tee_box IN ('black', 'blue', 'white', 'gold', 'red')),
  PRIMARY KEY (round_id, group_id, hole_number, player_id)
);
CREATE INDEX idx_player_hole_scores_round_group ON player_hole_scores (round_id, group_id);

-- 13. trip_members
CREATE TABLE trip_members (
  trip_id text NOT NULL REFERENCES trips (id),
  user_id text NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('Owner', 'Planner', 'Member')),
  status text NOT NULL DEFAULT 'maybe' CHECK (status IN ('in', 'likely', 'maybe', 'out')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX idx_trip_members_trip_id ON trip_members (trip_id);
CREATE INDEX idx_trip_members_user_id ON trip_members (user_id);

-- 14. ideas
CREATE TABLE ideas (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  title text NOT NULL,
  location text NOT NULL,
  description text NOT NULL DEFAULT '',
  golf_courses text[] NOT NULL DEFAULT '{}',
  activities text[] NOT NULL DEFAULT '{}',
  cost_tier text CHECK (cost_tier IN ('$', '$$', '$$$', '$$$$')),
  pros text[] NOT NULL DEFAULT '{}',
  cons text[] NOT NULL DEFAULT '{}',
  image_url text,
  accommodation text,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  proposed_dates jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ideas_trip_id ON ideas (trip_id);

-- 15. idea_votes
CREATE TABLE idea_votes (
  trip_id text NOT NULL REFERENCES trips (id),
  idea_id text NOT NULL REFERENCES ideas (id),
  user_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);
CREATE INDEX idx_idea_votes_trip_id ON idea_votes (trip_id);
CREATE INDEX idx_idea_votes_idea_id ON idea_votes (idea_id);

-- 16. idea_comments
CREATE TABLE idea_comments (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  idea_id text NOT NULL REFERENCES ideas (id),
  user_id text NOT NULL REFERENCES users (id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_idea_comments_idea_id ON idea_comments (idea_id);
CREATE INDEX idx_idea_comments_created_at ON idea_comments (created_at);

-- 17. date_polls
CREATE TABLE date_polls (
  trip_id text PRIMARY KEY REFERENCES trips (id),
  open boolean NOT NULL DEFAULT true,
  locked_window_id text, -- FK added after date_windows
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 18. date_windows
CREATE TABLE date_windows (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_date_windows_trip_id ON date_windows (trip_id);

-- Now add the forward FK from date_polls.locked_window_id → date_windows.id
ALTER TABLE date_polls
  ADD CONSTRAINT fk_date_polls_locked_window
  FOREIGN KEY (locked_window_id) REFERENCES date_windows (id)
  DEFERRABLE INITIALLY DEFERRED;

-- 19. date_poll_votes
CREATE TABLE date_poll_votes (
  window_id text NOT NULL REFERENCES date_windows (id),
  user_id text NOT NULL REFERENCES users (id),
  answer text NOT NULL CHECK (answer IN ('yes', 'no')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (window_id, user_id)
);

-- 20. reservations
CREATE TABLE reservations (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  type text NOT NULL CHECK (type IN ('accommodation', 'tee-time', 'restaurant', 'transport')),
  title text NOT NULL,
  date date NOT NULL,
  start_time text NOT NULL DEFAULT '',
  confirmation_number text NOT NULL DEFAULT '',
  cost numeric(10,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reservations_trip_id ON reservations (trip_id);
CREATE INDEX idx_reservations_trip_date ON reservations (trip_id, date);

-- 21. expenses
CREATE TABLE expenses (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  title text NOT NULL,
  amount numeric(10,2) NOT NULL,
  paid_by_user_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_trip_id ON expenses (trip_id);
CREATE INDEX idx_expenses_paid_by ON expenses (paid_by_user_id);

-- 22. expense_splits
CREATE TABLE expense_splits (
  expense_id text NOT NULL REFERENCES expenses (id),
  user_id text NOT NULL REFERENCES users (id),
  amount numeric(10,2),
  PRIMARY KEY (expense_id, user_id)
);
CREATE INDEX idx_expense_splits_expense_id ON expense_splits (expense_id);

-- 23. messages
CREATE TABLE messages (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  user_id text NOT NULL REFERENCES users (id),
  channel text NOT NULL CHECK (channel IN ('trip', 'team')),
  team_id text REFERENCES teams (id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_team_channel CHECK (channel = 'trip' OR (channel = 'team' AND team_id IS NOT NULL))
);
CREATE INDEX idx_messages_trip_channel ON messages (trip_id, channel);
CREATE INDEX idx_messages_trip_team ON messages (trip_id, team_id);
CREATE INDEX idx_messages_created_at ON messages (created_at);

-- 24. notification_events
CREATE TABLE notification_events (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('destination_locked', 'dates_locked', 'crew_added', 'chat_message', 'score_submitted')),
  trip_id text NOT NULL REFERENCES trips (id),
  actor_id text NOT NULL REFERENCES users (id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_events_trip_id ON notification_events (trip_id);
CREATE INDEX idx_notification_events_created_at ON notification_events (created_at);

-- 25. notification_reads
CREATE TABLE notification_reads (
  notification_id text NOT NULL REFERENCES notification_events (id),
  user_id text NOT NULL REFERENCES users (id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

-- 26. quick_info_tiles
CREATE TABLE quick_info_tiles (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  label text NOT NULL,
  value text NOT NULL,
  created_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_quick_info_tiles_trip_id ON quick_info_tiles (trip_id);
