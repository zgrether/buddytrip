-- Seed step 3: volume. LOCAL STACK ONLY - never run this against production.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v trips=49 -v games_per_trip=408 < scripts/load/seed-bulk.sql
--
-- Makes <trips> more trips of 40 members each (one cup, two teams), and fills
-- each with <games_per_trip> finished stroke-play games. With the focus trip
-- that is 50 trips, 2,000 users and ~20,000 games.
--
-- Every bulk game is a CLONE of one of the focus trip's finished games, which
-- the app itself wrote (seed-games.mjs): same columns, same config, same
-- scores, with the 16 players mapped onto the bulk trip's members. So the
-- shapes are the app's; only the ids differ.
--
-- What this is NOT: a realistic single trip. A bulk trip has ~400 games in one
-- cup, which no real trip has. The bulk rows exist so tables, indexes and RLS
-- helpers are measured at size; the focus trip is the one to measure paths on.
-- Only stroke play is cloned, so game_matches / match_hole_outcomes stay small.
--
-- Triggers are off for this session (session_replication_role = replica): the
-- score broadcast trigger would otherwise fire ~6 million times. That also
-- skips foreign-key checks, so the inserts below keep the references whole by
-- construction. Nothing about the schema is changed.

\set ON_ERROR_STOP 1
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'unexpected server';
  END IF;
  IF inet_server_addr() IS NOT NULL AND NOT (inet_server_addr() << inet '172.16.0.0/12' OR inet_server_addr() << inet '127.0.0.0/8' OR inet_server_addr() << inet '192.168.0.0/16' OR inet_server_addr() << inet '10.0.0.0/8') THEN
    RAISE EXCEPTION 'REFUSING: % is not a local/container address', inet_server_addr();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trips WHERE id = 'load-focus-trip') THEN
    RAISE EXCEPTION 'run seed-scaffold.mjs and seed-games.mjs first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trips WHERE id LIKE 'bulk-trip-%') THEN
    RAISE EXCEPTION 'bulk rows already present';
  END IF;
END $$;

SET LOCAL session_replication_role = replica;

-- Template: the focus trip's finished games, numbered, and its 16 players as slots.
CREATE TEMP TABLE tpl_game ON COMMIT DROP AS
  SELECT g.*, (row_number() OVER (ORDER BY g.created_at)) - 1 AS tpl_no
  FROM public.games g
  WHERE g.trip_id = 'load-focus-trip' AND g.status = 'complete';

CREATE TEMP TABLE tpl_slot ON COMMIT DROP AS
  SELECT m.user_id, split_part(m.nickname, ' ', 2)::int AS slot
  FROM public.trip_members m
  WHERE m.trip_id = 'load-focus-trip';

CREATE TEMP TABLE tpl_team ON COMMIT DROP AS
  SELECT t.id AS team_id, (row_number() OVER (ORDER BY t.created_at)) AS team_no
  FROM public.teams t WHERE t.competition_id = 'load-focus-comp';

-- Trips, users, members, cups, teams.
CREATE TEMP TABLE bt ON COMMIT DROP AS SELECT t FROM generate_series(1, :trips) t;

INSERT INTO public.trips (id, title, locked_destination_title, locked_destination_at, created_at)
  SELECT 'bulk-trip-' || t, 'Bulk Trip ' || t, 'Bulk Trip ' || t, now(), now() - (t || ' days')::interval FROM bt;

INSERT INTO public.users (id, name, email, is_guest)
  SELECT 'bulk-u-' || t || '-' || s, 'Bulk ' || t || '.' || s, 'bulk-' || t || '-' || s || '@load.test', false
  FROM bt, generate_series(1, 40) s;

INSERT INTO public.trip_members (trip_id, user_id, role, nickname)
  SELECT 'bulk-trip-' || t, 'bulk-u-' || t || '-' || s, CASE WHEN s = 1 THEN 'Owner' ELSE 'Member' END, 'Bulk ' || s
  FROM bt, generate_series(1, 40) s;

INSERT INTO public.competitions (id, trip_id, name, scoring_model, status)
  SELECT 'bulk-comp-' || t, 'bulk-trip-' || t, 'Bulk Cup ' || t, 'points', 'active' FROM bt;

INSERT INTO public.teams (id, competition_id, name, short_name, color, color_dim)
  SELECT 'bulk-team-' || t || '-' || n, 'bulk-comp-' || t, 'Team ' || n, n::text,
         CASE n WHEN 1 THEN '#3b82f6' ELSE '#ef4444' END, CASE n WHEN 1 THEN '#0a1a2a' ELSE '#2a0a0a' END
  FROM bt, generate_series(1, 2) n;

-- Same split the scaffold uses: odd slots team 1, even slots team 2.
INSERT INTO public.team_assignments (competition_id, user_id, team_id, sort_order)
  SELECT 'bulk-comp-' || t, 'bulk-u-' || t || '-' || s, 'bulk-team-' || t || '-' || (CASE WHEN s % 2 = 1 THEN 1 ELSE 2 END), (s - 1) / 2
  FROM bt, generate_series(1, 40) s;

-- One row per bulk game: which template it copies, and how far its players rotate.
CREATE TEMP TABLE bg ON COMMIT DROP AS
  SELECT t, n,
         'bulk-g-' || t || '-' || n AS game_id,
         n % (SELECT count(*) FROM tpl_game) AS tpl_no,
         (n * 2) % 40 AS rot            -- even, so a player keeps their team
  FROM bt, generate_series(1, :games_per_trip) n;
CREATE INDEX ON bg (tpl_no);

-- template user -> bulk user for one bulk game
CREATE FUNCTION pg_temp.bulk_user(t int, rot int, slot int) RETURNS text
  LANGUAGE sql IMMUTABLE AS $f$ SELECT 'bulk-u-' || t || '-' || (((slot - 1 + rot) % 40) + 1) $f$;

INSERT INTO public.games (id, trip_id, competition_id, game_type_id, name, status, course_id, config, modifiers,
    rules_for_today, scheduled_at, created_at, pairings_published_at, tee_time, scorecard_schema, points_distribution,
    schedule_item_id, points_total, competition_format, corrections_open, scoring_enabled, back_course_id, entry_mode,
    display_order, bracket_config, credited_roster)
  SELECT bg.game_id, 'bulk-trip-' || bg.t, 'bulk-comp-' || bg.t, g.game_type_id, 'Bulk Round ' || bg.n, g.status, NULL, g.config, g.modifiers,
    g.rules_for_today, NULL, now() - ((bg.n * 40) || ' hours')::interval, now() - ((bg.n * 40) || ' hours')::interval, g.tee_time,
    g.scorecard_schema, g.points_distribution, NULL, g.points_total, g.competition_format, false, g.scoring_enabled, NULL, g.entry_mode,
    bg.n, g.bracket_config,
    (SELECT jsonb_object_agg(a.user_id, a.team_id) FROM public.team_assignments a WHERE a.competition_id = 'bulk-comp-' || bg.t)
  FROM bg JOIN tpl_game g USING (tpl_no);

INSERT INTO public.play_groups (id, game_id, display_name, created_at, tee_time, handicap_strokes)
  SELECT 'bulk-pg-' || bg.t || '-' || bg.n || '-' || right(pg.display_name, 1), bg.game_id, pg.display_name, now(), pg.tee_time, pg.handicap_strokes
  FROM bg JOIN tpl_game g USING (tpl_no) JOIN public.play_groups pg ON pg.game_id = g.id;

INSERT INTO public.game_participants (id, game_id, user_id, play_group_id, team_id, handicap_strokes)
  SELECT 'bulk-gp-' || bg.t || '-' || bg.n || '-' || s.slot, bg.game_id, pg_temp.bulk_user(bg.t, bg.rot, s.slot),
         'bulk-pg-' || bg.t || '-' || bg.n || '-' || right(pg.display_name, 1), NULL, gp.handicap_strokes
  FROM bg JOIN tpl_game g USING (tpl_no)
  JOIN public.game_participants gp ON gp.game_id = g.id
  JOIN public.play_groups pg ON pg.id = gp.play_group_id
  JOIN tpl_slot s ON s.user_id = gp.user_id;

INSERT INTO public.score_entries (id, game_id, participant_id, participant_type, unit_label, value, annotations, submitted_by, submitted_at)
  SELECT 'bulk-se-' || bg.t || '-' || bg.n || '-' || s.slot || '-' || se.unit_label, bg.game_id, pg_temp.bulk_user(bg.t, bg.rot, s.slot),
         se.participant_type, se.unit_label, se.value, se.annotations, 'bulk-u-' || bg.t || '-1', se.submitted_at
  FROM bg JOIN tpl_game g USING (tpl_no)
  JOIN public.score_entries se ON se.game_id = g.id
  JOIN tpl_slot s ON s.user_id = se.participant_id;

INSERT INTO public.game_results (id, game_id, entity_id, entity_type, raw_score, position, competition_points_earned, computed_at, points, value_kind, credited_team_id)
  SELECT 'bulk-gr-' || bg.t || '-' || bg.n || '-u' || s.slot, bg.game_id, pg_temp.bulk_user(bg.t, bg.rot, s.slot), 'user',
         gr.raw_score, gr.position, gr.competition_points_earned, gr.computed_at, gr.points, gr.value_kind, NULL
  FROM bg JOIN tpl_game g USING (tpl_no)
  JOIN public.game_results gr ON gr.game_id = g.id AND gr.entity_type = 'user'
  JOIN tpl_slot s ON s.user_id = gr.entity_id
  UNION ALL
  SELECT 'bulk-gr-' || bg.t || '-' || bg.n || '-t' || tt.team_no, bg.game_id, 'bulk-team-' || bg.t || '-' || tt.team_no, 'team',
         gr.raw_score, gr.position, gr.competition_points_earned, gr.computed_at, gr.points, gr.value_kind, 'bulk-team-' || bg.t || '-' || tt.team_no
  FROM bg JOIN tpl_game g USING (tpl_no)
  JOIN public.game_results gr ON gr.game_id = g.id AND gr.entity_type = 'team'
  JOIN tpl_team tt ON tt.team_id = gr.entity_id;

COMMIT;

ANALYZE public.users, public.trips, public.trip_members, public.competitions, public.teams, public.team_assignments,
        public.games, public.play_groups, public.game_participants, public.score_entries, public.game_results;

SELECT 'trips' AS t, count(*) FROM public.trips UNION ALL SELECT 'users', count(*) FROM public.users
UNION ALL SELECT 'games', count(*) FROM public.games UNION ALL SELECT 'game_participants', count(*) FROM public.game_participants
UNION ALL SELECT 'score_entries', count(*) FROM public.score_entries UNION ALL SELECT 'game_results', count(*) FROM public.game_results;
