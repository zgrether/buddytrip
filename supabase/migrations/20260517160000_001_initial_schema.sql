-- ============================================================
-- 001_initial_schema.sql
--
-- Squash of migrations 001-073 (76 files total in legacy history,
-- archived to supabase/migrations/_archive/).
--
-- This file is the single source of truth for the BuddyTrip
-- production schema as of 2026-05-17. Reconstructed by
-- introspecting the live Supabase project (nezhuwyfirrbmyojpiyx).
--
-- Order:
--   1. Extensions
--   2. Tables (FK dependency order)
--   3. Indexes
--   4. Functions
--   5. Triggers (incl. auth.users → handle_new_user)
--   6. Row Level Security: enable + policies
--   7. Storage (avatars bucket + object policies)
--   8. Realtime publication membership
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY/TRIGGER IF EXISTS used throughout so this file
-- can be re-applied without error.
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================
-- 2. TABLES (in FK dependency order)
-- ============================================================

-- ---- users (self-referential FK; referenced by everything) ----
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  nickname text,
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_guest boolean NOT NULL DEFAULT false,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  avatar_url text
);

-- ---- series (referenced by trips; legacy table preserved) ----
CREATE TABLE IF NOT EXISTS series (
  id text PRIMARY KEY,
  name text NOT NULL,
  full_name text NOT NULL,
  years text NOT NULL,
  trip_count integer NOT NULL DEFAULT 0,
  owner_id text NOT NULL REFERENCES users(id)
);

-- ---- trips ----
-- NOTE: trips.series_id is nullable text. In the live DB it still has
-- a FK to series(id) ON DELETE SET NULL, which we preserve here.
-- (Task notes indicated the series table was to be dropped, but
-- introspection shows it is still present, so the FK is retained.)
CREATE TABLE IF NOT EXISTS trips (
  id text PRIMARY KEY,
  title text NOT NULL,
  series_id text REFERENCES series(id) ON DELETE SET NULL,
  location text,
  cost_tier text CHECK (cost_tier IN ('$','$$','$$$','$$$$')),
  image_url text,
  description text NOT NULL DEFAULT '',
  start_date date,
  end_date date,
  accommodation text,
  notes text,
  activities text[] NOT NULL DEFAULT '{}',
  golf_courses text[] NOT NULL DEFAULT '{}',
  comparison_mode boolean NOT NULL DEFAULT false,
  locked_destination_title text,
  locked_destination_location text,
  locked_destination_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  trip_status_override text CHECK (trip_status_override = 'saved'),
  saved_at timestamptz,
  stage text NOT NULL DEFAULT 'idea' CHECK (stage IN ('idea','planning','going')),
  stage_advanced_to_planning_at timestamptz,
  stage_advanced_to_going_at timestamptz,
  about_message text,
  poll_mode boolean NOT NULL DEFAULT false,
  last_blast_sent_at timestamptz,
  planning_skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  planning_tier text NOT NULL DEFAULT 'basic' CHECK (planning_tier IN ('basic','advanced')),
  itinerary_enabled boolean NOT NULL DEFAULT false,
  getting_there_enabled boolean NOT NULL DEFAULT false,
  quick_info_dismissed boolean NOT NULL DEFAULT false,
  travel_plans_crew_visible boolean NOT NULL DEFAULT true
);

-- ---- trip_members ----
CREATE TABLE IF NOT EXISTS trip_members (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Owner','Planner','Member')),
  status text NOT NULL DEFAULT 'maybe' CHECK (status IN ('draft','in','likely','maybe','out','invited')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  travel_mode text CHECK (travel_mode IN ('driving','flying','other')),
  travel_detail text,
  flight_airline text,
  flight_number text,
  flight_arrival_time timestamptz,
  flight_airport text,
  travel_shared boolean NOT NULL DEFAULT false,
  last_invited_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (trip_id, user_id)
);

-- ---- invites ----
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'Member' CHECK (role IN ('Planner','Member')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

-- ---- golf_courses ----
CREATE TABLE IF NOT EXISTS golf_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text UNIQUE,
  name text NOT NULL,
  address text,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- ideas ----
CREATE TABLE IF NOT EXISTS ideas (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title text NOT NULL,
  location text NOT NULL,
  description text NOT NULL DEFAULT '',
  golf_courses text[] NOT NULL DEFAULT '{}',
  activities text[] NOT NULL DEFAULT '{}',
  cost_tier text CHECK (cost_tier IN ('$','$$','$$$','$$$$')),
  pros text[] NOT NULL DEFAULT '{}',
  cons text[] NOT NULL DEFAULT '{}',
  image_url text,
  accommodation text,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  proposed_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  source_idea_id text REFERENCES ideas(id)
);

-- ---- catalog_ideas ----
CREATE TABLE IF NOT EXISTS catalog_ideas (
  id text PRIMARY KEY,
  title text NOT NULL,
  location text NOT NULL,
  description text NOT NULL,
  image_url text,
  cost_tier text CHECK (cost_tier IN ('$','$$','$$$','$$$$')),
  categories text[] NOT NULL DEFAULT '{}',
  group_types text[] NOT NULL DEFAULT '{}',
  trip_length text,
  region text,
  golf_courses text[] NOT NULL DEFAULT '{}',
  activities text[] NOT NULL DEFAULT '{}',
  accommodation text,
  tips text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, ((((title || ' '::text) || location) || ' '::text) || description))
  ) STORED
);

-- ---- archived_ideas ----
CREATE TABLE IF NOT EXISTS archived_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  location text NOT NULL,
  description text NOT NULL DEFAULT '',
  cost_tier text CHECK (cost_tier IN ('$','$$','$$$','$$$$')),
  image_url text,
  golf_courses text[] NOT NULL DEFAULT '{}',
  activities text[] NOT NULL DEFAULT '{}',
  accommodation text,
  notes text,
  pros text[] NOT NULL DEFAULT '{}',
  cons text[] NOT NULL DEFAULT '{}',
  source_idea_id text,
  original_trip_id text REFERENCES trips(id) ON DELETE SET NULL,
  original_trip_title text,
  archived_at timestamptz NOT NULL DEFAULT now()
);

-- ---- idea_lodging_options ----
CREATE TABLE IF NOT EXISTS idea_lodging_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id text NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text CHECK (source IN ('vrbo','airbnb','hotel','other')),
  sleeps integer,
  price_note text,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- ---- idea_votes ----
CREATE TABLE IF NOT EXISTS idea_votes (
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  idea_id text NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);

-- ---- date_windows ----
CREATE TABLE IF NOT EXISTS date_windows (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- date_polls ----
CREATE TABLE IF NOT EXISTS date_polls (
  trip_id text PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  open boolean NOT NULL DEFAULT true,
  locked_window_id text REFERENCES date_windows(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notify_sent boolean NOT NULL DEFAULT false,
  poll_note text
);

-- ---- date_poll_votes ----
CREATE TABLE IF NOT EXISTS date_poll_votes (
  window_id text NOT NULL REFERENCES date_windows(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer text NOT NULL CHECK (answer IN ('yes','no','maybe')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (window_id, user_id)
);

-- ---- competitions ----
CREATE TABLE IF NOT EXISTS competitions (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  tagline text,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scoreboard_style text NOT NULL DEFAULT 'grid' CHECK (scoreboard_style IN ('grid','leaderboard','heatmap','cards','bars','podium','stadium','minimal'))
);

-- ---- teams ----
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  competition_id text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  short_name text NOT NULL CHECK (char_length(short_name) <= 4),
  color text NOT NULL,
  color_dim text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- team_assignments ----
CREATE TABLE IF NOT EXISTS team_assignments (
  competition_id text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, user_id)
);

-- ---- schedule_items ----
-- Forward-declared without competition_event_id FK to avoid ordering
-- cycle (events references schedule_items, schedule_items references events).
-- The FK is added after events is created.
CREATE TABLE IF NOT EXISTS schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title text NOT NULL,
  detail text,
  scheduled_date date,
  scheduled_time time,
  is_confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  confirmed_by text REFERENCES users(id),
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  item_type text NOT NULL DEFAULT 'general' CHECK (item_type IN ('general','golf')),
  course_name text,
  course_location text,
  tee_times jsonb,
  course_id uuid REFERENCES golf_courses(id),
  competition_event_id text
);

-- ---- events ----
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  competition_id text NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('GOLF','GENERIC')),
  title text NOT NULL,
  description text,
  scoring_format text CHECK (scoring_format IS NULL OR scoring_format IN ('scramble','stableford','skins','match_play','singles','sabotage','other')),
  course_id uuid REFERENCES golf_courses(id) ON DELETE SET NULL,
  is_practice boolean NOT NULL DEFAULT false,
  points_available numeric,
  day integer,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','completed')),
  modifiers jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0,
  agenda_item_id uuid REFERENCES schedule_items(id) ON DELETE SET NULL
);

-- ---- schedule_items.competition_event_id FK (deferred) ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schedule_items_competition_event_id_fkey'
  ) THEN
    ALTER TABLE schedule_items
      ADD CONSTRAINT schedule_items_competition_event_id_fkey
      FOREIGN KEY (competition_event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---- event_point_distributions ----
CREATE TABLE IF NOT EXISTS event_point_distributions (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  label text NOT NULL,
  points numeric NOT NULL CHECK (points >= 0),
  UNIQUE (event_id, position)
);

-- ---- expenses ----
CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric(10,2) NOT NULL,
  paid_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  date date
);

-- ---- expense_splits ----
CREATE TABLE IF NOT EXISTS expense_splits (
  expense_id text NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount numeric(10,2),
  opted_out boolean NOT NULL DEFAULT false,
  PRIMARY KEY (expense_id, user_id)
);

-- ---- logistics_items ----
CREATE TABLE IF NOT EXISTS logistics_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('lodging','transport','general')),
  label text NOT NULL,
  detail text,
  property_name text,
  address text,
  check_in_time text,
  check_out_time text,
  transport_type text,
  pickup_location text,
  pickup_time text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_confirmed boolean NOT NULL DEFAULT false,
  total_price text,
  notes text,
  check_in_time_of_day text,
  check_out_time_of_day text
);

-- ---- messages ----
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('trip','team')),
  team_id text REFERENCES teams(id) ON DELETE SET NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_team_channel CHECK (channel = 'trip' OR (channel = 'team' AND team_id IS NOT NULL))
);

-- ---- notification_events ----
CREATE TABLE IF NOT EXISTS notification_events (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN (
    'destination_locked','destination_changed','dates_locked','crew_added',
    'chat_message','score_submitted','rsvp_response','about_update',
    'date_poll_started','stage_advanced','idea_voted','date_poll_voted'
  )),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  recipient_id text REFERENCES users(id) ON DELETE CASCADE
);

-- ---- notification_reads ----
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id text NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

-- ---- quick_info_tiles ----
CREATE TABLE IF NOT EXISTS quick_info_tiles (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  label text NOT NULL,
  value text NOT NULL,
  created_by text NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0,
  is_alert boolean NOT NULL DEFAULT false
);

-- ============================================================
-- 3. INDEXES (non-PK)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_archived_ideas_archived_at ON public.archived_ideas USING btree (archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_ideas_user_id ON public.archived_ideas USING btree (user_id);
CREATE INDEX IF NOT EXISTS catalog_ideas_categories_idx ON public.catalog_ideas USING gin (categories);
CREATE INDEX IF NOT EXISTS catalog_ideas_cost_tier_idx ON public.catalog_ideas USING btree (cost_tier);
CREATE INDEX IF NOT EXISTS catalog_ideas_group_types_idx ON public.catalog_ideas USING gin (group_types);
CREATE INDEX IF NOT EXISTS catalog_ideas_is_active_sort_order_idx ON public.catalog_ideas USING btree (is_active, sort_order);
CREATE INDEX IF NOT EXISTS catalog_ideas_region_idx ON public.catalog_ideas USING btree (region);
CREATE INDEX IF NOT EXISTS catalog_ideas_search_vector_idx ON public.catalog_ideas USING gin (search_vector);
CREATE INDEX IF NOT EXISTS competitions_trip_id_idx ON public.competitions USING btree (trip_id);
CREATE INDEX IF NOT EXISTS idx_date_windows_trip_id ON public.date_windows USING btree (trip_id);
CREATE INDEX IF NOT EXISTS event_point_distributions_event_id_idx ON public.event_point_distributions USING btree (event_id);
CREATE INDEX IF NOT EXISTS events_competition_id_idx ON public.events USING btree (competition_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id ON public.expense_splits USING btree (expense_id);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON public.expenses USING btree (paid_by_user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON public.expenses USING btree (trip_id);
CREATE INDEX IF NOT EXISTS idx_golf_courses_place_id ON public.golf_courses USING btree (place_id);
CREATE INDEX IF NOT EXISTS idea_lodging_options_idea_idx ON public.idea_lodging_options USING btree (idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_votes_idea_id ON public.idea_votes USING btree (idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_votes_trip_id ON public.idea_votes USING btree (trip_id);
CREATE INDEX IF NOT EXISTS idx_ideas_trip_id ON public.ideas USING btree (trip_id);
CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites USING btree (email);
CREATE INDEX IF NOT EXISTS invites_token_idx ON public.invites USING btree (token);
CREATE INDEX IF NOT EXISTS idx_logistics_items_trip ON public.logistics_items USING btree (trip_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_trip_channel ON public.messages USING btree (trip_id, channel);
CREATE INDEX IF NOT EXISTS idx_messages_trip_team ON public.messages USING btree (trip_id, team_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_created_at ON public.notification_events USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_trip_id ON public.notification_events USING btree (trip_id);
CREATE INDEX IF NOT EXISTS notification_events_recipient_idx ON public.notification_events USING btree (recipient_id);
CREATE INDEX IF NOT EXISTS idx_quick_info_tiles_trip_alert ON public.quick_info_tiles USING btree (trip_id, is_alert) WHERE (is_alert = true);
CREATE INDEX IF NOT EXISTS idx_quick_info_tiles_trip_id ON public.quick_info_tiles USING btree (trip_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_course_id ON public.schedule_items USING btree (course_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_trip ON public.schedule_items USING btree (trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS schedule_items_competition_event_unique ON public.schedule_items USING btree (competition_event_id) WHERE (competition_event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS team_assignments_team_id_idx ON public.team_assignments USING btree (team_id);
CREATE INDEX IF NOT EXISTS teams_competition_id_idx ON public.teams USING btree (competition_id);
CREATE INDEX IF NOT EXISTS idx_trip_members_trip_id ON public.trip_members USING btree (trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_members_trip_user ON public.trip_members USING btree (trip_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_trip_members_user_id ON public.trip_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_trips_series_id ON public.trips USING btree (series_id);
CREATE INDEX IF NOT EXISTS idx_trips_start_date ON public.trips USING btree (start_date);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email);

-- ============================================================
-- 4. FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_trip_member(p_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id AND user_id = auth.uid()::text
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_trip_planner(p_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id AND user_id = auth.uid()::text
    AND role IN ('Owner', 'Planner')
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_trip_role(p_trip_id text, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id
      AND user_id = auth.uid()::text
      AND role = ANY(p_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.trip_status(t trips)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN t.trip_status_override = 'saved' THEN 'saved'
    WHEN t.end_date IS NOT NULL AND t.end_date + interval '3 days' < CURRENT_DATE THEN 'past'
    WHEN t.stage = 'going' AND t.start_date IS NOT NULL AND t.start_date - interval '3 days' <= CURRENT_DATE THEN 'now'
    WHEN t.stage = 'going' THEN 'going'
    WHEN t.stage = 'planning' THEN 'planning'
    ELSE 'idea'
  END;
$function$;

-- NOTE: merge_guest_to_real_user() preserved verbatim from the live DB.
-- It references tables that were dropped in earlier migrations
-- (players, player_hole_scores, idea_comments, rounds,
--  scoreboard_shares, group_results) and a trips.owner_id column
-- that no longer exists. plpgsql does not validate these references
-- until runtime; if a ghost-merge code path hits a missing table the
-- UPDATE will error. The function is kept as-is to match the live
-- DB exactly. Clean-up is tracked separately.
CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.trip_members       SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.team_assignments   SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.players            SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.player_hole_scores SET player_id       = p_real_id WHERE player_id       = p_ghost_id;
  UPDATE public.idea_votes         SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.idea_comments      SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.date_poll_votes    SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expense_splits     SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.notification_reads SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.messages           SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses           SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.rounds             SET closed_by       = p_real_id WHERE closed_by       = p_ghost_id;
  UPDATE public.notification_events SET actor_id       = p_real_id WHERE actor_id        = p_ghost_id;
  UPDATE public.scoreboard_shares  SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.quick_info_tiles   SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.group_results      SET submitted_by    = p_real_id WHERE submitted_by    = p_ghost_id;
  UPDATE public.series             SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;
  UPDATE public.trips              SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;
  UPDATE public.users              SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.invites            SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _ghost_id text;
BEGIN
  SELECT id INTO _ghost_id
  FROM public.users
  WHERE email = NEW.email
    AND is_guest = true;

  IF _ghost_id IS NOT NULL THEN
    UPDATE public.users SET email = NULL WHERE id = _ghost_id;
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );
    PERFORM public.merge_guest_to_real_user(_ghost_id, NEW.id::text);
  ELSE
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );
  END IF;

  UPDATE public.invites
  SET accepted_at = now()
  WHERE email = NEW.email
    AND accepted_at IS NULL;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- 5. TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at ON public.expenses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.trips;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.archived_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_point_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golf_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_lodging_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_info_tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ---- archived_ideas ----
DROP POLICY IF EXISTS archived_ideas_delete ON public.archived_ideas;
CREATE POLICY archived_ideas_delete ON public.archived_ideas FOR DELETE TO authenticated
  USING (user_id = (auth.uid())::text);
DROP POLICY IF EXISTS archived_ideas_insert ON public.archived_ideas;
CREATE POLICY archived_ideas_insert ON public.archived_ideas FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text);
DROP POLICY IF EXISTS archived_ideas_select ON public.archived_ideas;
CREATE POLICY archived_ideas_select ON public.archived_ideas FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text);

-- ---- catalog_ideas ----
DROP POLICY IF EXISTS catalog_ideas_read ON public.catalog_ideas;
CREATE POLICY catalog_ideas_read ON public.catalog_ideas FOR SELECT TO authenticated
  USING (is_active = true);

-- ---- competitions ----
DROP POLICY IF EXISTS competitions_delete ON public.competitions;
CREATE POLICY competitions_delete ON public.competitions FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text]));
DROP POLICY IF EXISTS competitions_insert ON public.competitions;
CREATE POLICY competitions_insert ON public.competitions FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS competitions_select ON public.competitions;
CREATE POLICY competitions_select ON public.competitions FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS competitions_update ON public.competitions;
CREATE POLICY competitions_update ON public.competitions FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- ---- date_poll_votes ----
DROP POLICY IF EXISTS date_poll_votes_delete ON public.date_poll_votes;
CREATE POLICY date_poll_votes_delete ON public.date_poll_votes FOR DELETE TO authenticated
  USING (user_id = (auth.uid())::text);
DROP POLICY IF EXISTS date_poll_votes_insert ON public.date_poll_votes;
CREATE POLICY date_poll_votes_insert ON public.date_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (auth.uid())::text)
    AND (EXISTS (SELECT 1 FROM date_windows dw WHERE dw.id = date_poll_votes.window_id AND is_trip_member(dw.trip_id)))
  );
DROP POLICY IF EXISTS date_poll_votes_insert_ghost ON public.date_poll_votes;
CREATE POLICY date_poll_votes_insert_ghost ON public.date_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = date_poll_votes.user_id AND u.is_guest = true))
    AND (EXISTS (SELECT 1 FROM date_windows dw WHERE dw.id = date_poll_votes.window_id AND has_trip_role(dw.trip_id, ARRAY['Owner'::text, 'Planner'::text])))
  );
DROP POLICY IF EXISTS date_poll_votes_insert_owner_any ON public.date_poll_votes;
CREATE POLICY date_poll_votes_insert_owner_any ON public.date_poll_votes FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM date_windows dw WHERE dw.id = date_poll_votes.window_id AND has_trip_role(dw.trip_id, ARRAY['Owner'::text])))
    AND (EXISTS (SELECT 1 FROM trip_members tm JOIN date_windows dw2 ON dw2.id = date_poll_votes.window_id WHERE tm.trip_id = dw2.trip_id AND tm.user_id = date_poll_votes.user_id))
  );
DROP POLICY IF EXISTS date_poll_votes_select ON public.date_poll_votes;
CREATE POLICY date_poll_votes_select ON public.date_poll_votes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM date_windows dw WHERE dw.id = date_poll_votes.window_id AND is_trip_member(dw.trip_id)));
DROP POLICY IF EXISTS date_poll_votes_update ON public.date_poll_votes;
CREATE POLICY date_poll_votes_update ON public.date_poll_votes FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text);
DROP POLICY IF EXISTS date_poll_votes_update_ghost ON public.date_poll_votes;
CREATE POLICY date_poll_votes_update_ghost ON public.date_poll_votes FOR UPDATE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM users u WHERE u.id = date_poll_votes.user_id AND u.is_guest = true))
    AND (EXISTS (SELECT 1 FROM date_windows dw WHERE dw.id = date_poll_votes.window_id AND has_trip_role(dw.trip_id, ARRAY['Owner'::text, 'Planner'::text])))
  );
DROP POLICY IF EXISTS date_poll_votes_update_owner_any ON public.date_poll_votes;
CREATE POLICY date_poll_votes_update_owner_any ON public.date_poll_votes FOR UPDATE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM date_windows dw WHERE dw.id = date_poll_votes.window_id AND has_trip_role(dw.trip_id, ARRAY['Owner'::text])))
    AND (EXISTS (SELECT 1 FROM trip_members tm JOIN date_windows dw2 ON dw2.id = date_poll_votes.window_id WHERE tm.trip_id = dw2.trip_id AND tm.user_id = date_poll_votes.user_id))
  );
DROP POLICY IF EXISTS trip_owner_can_delete_poll_votes ON public.date_poll_votes;
CREATE POLICY trip_owner_can_delete_poll_votes ON public.date_poll_votes FOR DELETE TO public
  USING (
    EXISTS (
      SELECT 1 FROM date_windows dw
      JOIN trip_members tm ON tm.trip_id = dw.trip_id
      WHERE dw.id = date_poll_votes.window_id
        AND tm.user_id = (auth.uid())::text
        AND tm.role = 'Owner'::text
    )
  );

-- ---- date_polls ----
DROP POLICY IF EXISTS date_polls_insert ON public.date_polls;
CREATE POLICY date_polls_insert ON public.date_polls FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS date_polls_select ON public.date_polls;
CREATE POLICY date_polls_select ON public.date_polls FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS date_polls_update ON public.date_polls;
CREATE POLICY date_polls_update ON public.date_polls FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- ---- date_windows ----
DROP POLICY IF EXISTS date_windows_delete ON public.date_windows;
CREATE POLICY date_windows_delete ON public.date_windows FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS date_windows_insert ON public.date_windows;
CREATE POLICY date_windows_insert ON public.date_windows FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS date_windows_select ON public.date_windows;
CREATE POLICY date_windows_select ON public.date_windows FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

-- ---- event_point_distributions ----
DROP POLICY IF EXISTS epd_delete ON public.event_point_distributions;
CREATE POLICY epd_delete ON public.event_point_distributions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS epd_insert ON public.event_point_distributions;
CREATE POLICY epd_insert ON public.event_point_distributions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS epd_select ON public.event_point_distributions;
CREATE POLICY epd_select ON public.event_point_distributions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id AND is_trip_member(c.trip_id)));
DROP POLICY IF EXISTS epd_update ON public.event_point_distributions;
CREATE POLICY epd_update ON public.event_point_distributions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e JOIN competitions c ON c.id = e.competition_id
    WHERE e.id = event_point_distributions.event_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));

-- ---- events ----
DROP POLICY IF EXISTS events_delete ON public.events;
CREATE POLICY events_delete ON public.events FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = events.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS events_insert ON public.events;
CREATE POLICY events_insert ON public.events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM competitions c WHERE c.id = events.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select ON public.events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = events.competition_id AND is_trip_member(c.trip_id)));
DROP POLICY IF EXISTS events_update ON public.events;
CREATE POLICY events_update ON public.events FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = events.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));

-- ---- expense_splits ----
DROP POLICY IF EXISTS expense_splits_delete ON public.expense_splits;
CREATE POLICY expense_splits_delete ON public.expense_splits FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM expenses ex WHERE ex.id = expense_splits.expense_id AND has_trip_role(ex.trip_id, ARRAY['Owner'::text])));
DROP POLICY IF EXISTS expense_splits_insert ON public.expense_splits;
CREATE POLICY expense_splits_insert ON public.expense_splits FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM expenses ex WHERE ex.id = expense_splits.expense_id AND is_trip_member(ex.trip_id)));
DROP POLICY IF EXISTS expense_splits_select ON public.expense_splits;
CREATE POLICY expense_splits_select ON public.expense_splits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM expenses ex WHERE ex.id = expense_splits.expense_id AND is_trip_member(ex.trip_id)));
DROP POLICY IF EXISTS expense_splits_self_update ON public.expense_splits;
CREATE POLICY expense_splits_self_update ON public.expense_splits FOR UPDATE TO authenticated
  USING ((user_id = (auth.uid())::text) AND EXISTS (SELECT 1 FROM expenses ex WHERE ex.id = expense_splits.expense_id AND is_trip_member(ex.trip_id)));
DROP POLICY IF EXISTS expense_splits_update ON public.expense_splits;
CREATE POLICY expense_splits_update ON public.expense_splits FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM expenses ex WHERE ex.id = expense_splits.expense_id AND has_trip_role(ex.trip_id, ARRAY['Owner'::text])));

-- ---- expenses ----
DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id));
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text]));

-- ---- golf_courses ----
DROP POLICY IF EXISTS "anyone can view golf courses" ON public.golf_courses;
CREATE POLICY "anyone can view golf courses" ON public.golf_courses FOR SELECT TO public
  USING (true);
DROP POLICY IF EXISTS "authenticated can insert golf courses" ON public.golf_courses;
CREATE POLICY "authenticated can insert golf courses" ON public.golf_courses FOR INSERT TO public
  WITH CHECK (auth.uid() IS NOT NULL);

-- ---- idea_lodging_options ----
DROP POLICY IF EXISTS "trip members can manage idea lodging" ON public.idea_lodging_options;
CREATE POLICY "trip members can manage idea lodging" ON public.idea_lodging_options FOR ALL TO public
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS "trip members can view idea lodging" ON public.idea_lodging_options;
CREATE POLICY "trip members can view idea lodging" ON public.idea_lodging_options FOR SELECT TO public
  USING (is_trip_member(trip_id));

-- ---- idea_votes ----
DROP POLICY IF EXISTS idea_votes_delete ON public.idea_votes;
CREATE POLICY idea_votes_delete ON public.idea_votes FOR DELETE TO authenticated
  USING (user_id = (auth.uid())::text);
DROP POLICY IF EXISTS idea_votes_insert ON public.idea_votes;
CREATE POLICY idea_votes_insert ON public.idea_votes FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id) AND user_id = (auth.uid())::text);
DROP POLICY IF EXISTS idea_votes_select ON public.idea_votes;
CREATE POLICY idea_votes_select ON public.idea_votes FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));

-- ---- ideas ----
DROP POLICY IF EXISTS ideas_delete ON public.ideas;
CREATE POLICY ideas_delete ON public.ideas FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text]));
DROP POLICY IF EXISTS ideas_insert ON public.ideas;
CREATE POLICY ideas_insert ON public.ideas FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text]));
DROP POLICY IF EXISTS ideas_select ON public.ideas;
CREATE POLICY ideas_select ON public.ideas FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS ideas_update ON public.ideas;
CREATE POLICY ideas_update ON public.ideas FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- ---- invites ----
DROP POLICY IF EXISTS "planners and owners can create invites" ON public.invites;
CREATE POLICY "planners and owners can create invites" ON public.invites FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM trip_members
    WHERE trip_members.trip_id = invites.trip_id
      AND trip_members.user_id = (auth.uid())::text
      AND trip_members.role = ANY (ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS "system can update invites" ON public.invites;
CREATE POLICY "system can update invites" ON public.invites FOR UPDATE TO public
  USING (true);
DROP POLICY IF EXISTS "trip members can view invites for their trip" ON public.invites;
CREATE POLICY "trip members can view invites for their trip" ON public.invites FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM trip_members
    WHERE trip_members.trip_id = invites.trip_id
      AND trip_members.user_id = (auth.uid())::text));

-- ---- logistics_items ----
DROP POLICY IF EXISTS "planners can manage logistics" ON public.logistics_items;
CREATE POLICY "planners can manage logistics" ON public.logistics_items FOR ALL TO public
  USING (is_trip_planner(trip_id));
DROP POLICY IF EXISTS "trip members can view logistics" ON public.logistics_items;
CREATE POLICY "trip members can view logistics" ON public.logistics_items FOR SELECT TO public
  USING (is_trip_member(trip_id));

-- ---- messages ----
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (auth.uid())::text)
    AND is_trip_member(trip_id)
    AND (
      (channel = 'trip'::text)
      OR (
        (channel = 'team'::text)
        AND EXISTS (
          SELECT 1 FROM team_assignments ta
          JOIN competitions c ON c.id = ta.competition_id
          WHERE c.trip_id = messages.trip_id
            AND ta.team_id = messages.team_id
            AND ta.user_id = (auth.uid())::text
        )
      )
    )
  );
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    is_trip_member(trip_id)
    AND (
      (channel = 'trip'::text)
      OR (
        (channel = 'team'::text)
        AND EXISTS (
          SELECT 1 FROM team_assignments ta
          JOIN competitions c ON c.id = ta.competition_id
          WHERE c.trip_id = messages.trip_id
            AND ta.team_id = messages.team_id
            AND ta.user_id = (auth.uid())::text
        )
      )
    )
  );

-- ---- notification_events ----
DROP POLICY IF EXISTS notification_events_insert ON public.notification_events;
CREATE POLICY notification_events_insert ON public.notification_events FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id) AND actor_id = (auth.uid())::text);
DROP POLICY IF EXISTS notification_events_select ON public.notification_events;
CREATE POLICY notification_events_select ON public.notification_events FOR SELECT TO authenticated
  USING (recipient_id = (auth.uid())::text);

-- ---- notification_reads ----
DROP POLICY IF EXISTS notification_reads_insert ON public.notification_reads;
CREATE POLICY notification_reads_insert ON public.notification_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text);
DROP POLICY IF EXISTS notification_reads_select ON public.notification_reads;
CREATE POLICY notification_reads_select ON public.notification_reads FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text);

-- ---- quick_info_tiles ----
DROP POLICY IF EXISTS quick_info_tiles_delete ON public.quick_info_tiles;
CREATE POLICY quick_info_tiles_delete ON public.quick_info_tiles FOR DELETE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS quick_info_tiles_insert ON public.quick_info_tiles;
CREATE POLICY quick_info_tiles_insert ON public.quick_info_tiles FOR INSERT TO authenticated
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS quick_info_tiles_select ON public.quick_info_tiles;
CREATE POLICY quick_info_tiles_select ON public.quick_info_tiles FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS quick_info_tiles_update ON public.quick_info_tiles;
CREATE POLICY quick_info_tiles_update ON public.quick_info_tiles FOR UPDATE TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- ---- schedule_items ----
DROP POLICY IF EXISTS "planners can manage schedule" ON public.schedule_items;
CREATE POLICY "planners can manage schedule" ON public.schedule_items FOR ALL TO public
  USING (is_trip_planner(trip_id));
DROP POLICY IF EXISTS "trip members can view schedule" ON public.schedule_items;
CREATE POLICY "trip members can view schedule" ON public.schedule_items FOR SELECT TO public
  USING (is_trip_member(trip_id));

-- ---- series ----
DROP POLICY IF EXISTS series_insert ON public.series;
CREATE POLICY series_insert ON public.series FOR INSERT TO authenticated
  WITH CHECK (owner_id = (auth.uid())::text);
DROP POLICY IF EXISTS series_select ON public.series;
CREATE POLICY series_select ON public.series FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS series_update ON public.series;
CREATE POLICY series_update ON public.series FOR UPDATE TO authenticated
  USING (owner_id = (auth.uid())::text)
  WITH CHECK (true);

-- ---- team_assignments ----
DROP POLICY IF EXISTS team_assignments_delete ON public.team_assignments;
CREATE POLICY team_assignments_delete ON public.team_assignments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = team_assignments.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text])));
DROP POLICY IF EXISTS team_assignments_insert ON public.team_assignments;
CREATE POLICY team_assignments_insert ON public.team_assignments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM competitions c WHERE c.id = team_assignments.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS team_assignments_select ON public.team_assignments;
CREATE POLICY team_assignments_select ON public.team_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = team_assignments.competition_id AND is_trip_member(c.trip_id)));
DROP POLICY IF EXISTS team_assignments_update ON public.team_assignments;
CREATE POLICY team_assignments_update ON public.team_assignments FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = team_assignments.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));

-- ---- teams ----
DROP POLICY IF EXISTS teams_delete ON public.teams;
CREATE POLICY teams_delete ON public.teams FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = teams.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text])));
DROP POLICY IF EXISTS teams_insert ON public.teams;
CREATE POLICY teams_insert ON public.teams FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM competitions c WHERE c.id = teams.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = teams.competition_id AND is_trip_member(c.trip_id)));
DROP POLICY IF EXISTS teams_update ON public.teams;
CREATE POLICY teams_update ON public.teams FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM competitions c WHERE c.id = teams.competition_id AND has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Planner'::text])));

-- ---- trip_members ----
DROP POLICY IF EXISTS trip_members_delete ON public.trip_members;
CREATE POLICY trip_members_delete ON public.trip_members FOR DELETE TO authenticated
  USING ((user_id = (auth.uid())::text) OR has_trip_role(trip_id, ARRAY['Owner'::text]));
DROP POLICY IF EXISTS trip_members_insert ON public.trip_members;
CREATE POLICY trip_members_insert ON public.trip_members FOR INSERT TO authenticated
  WITH CHECK ((user_id = (auth.uid())::text) OR has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));
DROP POLICY IF EXISTS trip_members_select ON public.trip_members;
CREATE POLICY trip_members_select ON public.trip_members FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS trip_members_update ON public.trip_members;
CREATE POLICY trip_members_update ON public.trip_members FOR UPDATE TO authenticated
  USING ((user_id = (auth.uid())::text) OR has_trip_role(trip_id, ARRAY['Owner'::text, 'Planner'::text]));

-- ---- trips ----
DROP POLICY IF EXISTS trips_delete ON public.trips;
CREATE POLICY trips_delete ON public.trips FOR DELETE TO authenticated
  USING (has_trip_role(id, ARRAY['Owner'::text]));
DROP POLICY IF EXISTS trips_insert ON public.trips;
CREATE POLICY trips_insert ON public.trips FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS trips_select ON public.trips;
CREATE POLICY trips_select ON public.trips FOR SELECT TO authenticated
  USING (CASE
    WHEN stage = ANY (ARRAY['idea'::text, 'planning'::text]) THEN is_trip_planner(id)
    ELSE is_trip_member(id)
  END);
DROP POLICY IF EXISTS trips_update ON public.trips;
CREATE POLICY trips_update ON public.trips FOR UPDATE TO authenticated
  USING (has_trip_role(id, ARRAY['Owner'::text, 'Planner'::text]));

-- ---- users ----
DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users FOR INSERT TO authenticated
  WITH CHECK ((id = (auth.uid())::text) OR (is_guest = true));
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
  USING ((id = (auth.uid())::text) OR (is_guest = true));

-- ============================================================
-- 7. STORAGE (avatars bucket + object policies)
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars are publicly readable" ON storage.objects;
CREATE POLICY "avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "users can upload their own avatar" ON storage.objects;
CREATE POLICY "users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "users can update their own avatar" ON storage.objects;
CREATE POLICY "users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- 8. REALTIME PUBLICATION
-- ============================================================
-- Add the four realtime-replicated tables. Wrapped in a DO block
-- because ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='competitions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notification_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_events;
  END IF;
END $$;
