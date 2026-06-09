-- 033 — Competition engine, Slice A: stroke-play spine tables
--
-- The four spine tables from COMPETITION_ENGINE.md's v1 data model: games,
-- game_participants, score_entries, game_results. Hardened on the simplest case
-- (individual gross stroke play) before sides/teams/matches/modifiers exist.
--
-- Context FK columns (competition_id, team_id, play_group_id) are nullable text
-- with NO REFERENCES — their parent tables don't exist until later slices; the
-- FK constraints get added in the slice that creates each parent (per spec).
-- All PKs/FKs are text (project convention). config/modifiers/annotations jsonb
-- exist but are unused in A.
--
-- RLS: SELECT for any trip member; writes gated as a backstop to the tRPC gates
-- (games/participants = Owner+Organizer, score_entries = any member), per the
-- existing RLS-parity policy (equal-or-looser than tRPC). Idempotent.

-- ── games ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.games (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  competition_id text,                       -- FK added in the competition slice
  game_type_id text REFERENCES public.game_type_templates(id),
  name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'complete')),
  course_id text REFERENCES public.circle_courses(id),  -- golf only; unused in A
  config jsonb NOT NULL DEFAULT '{}',
  modifiers jsonb NOT NULL DEFAULT '{}',
  rules_for_today text,
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_trip_id ON public.games (trip_id);

-- ── game_participants ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_participants (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  play_group_id text,                        -- FK added in the sides slice
  team_id text,                              -- FK added in the competition slice
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_participants_game_id ON public.game_participants (game_id);

-- ── score_entries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.score_entries (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  participant_id text NOT NULL,              -- WHOSE score: user_id (A) or play_group_id (later)
  participant_type text NOT NULL CHECK (participant_type IN ('user', 'play_group')),
  unit_label text NOT NULL,                  -- "1".."18"
  value integer,
  annotations jsonb NOT NULL DEFAULT '{}',   -- display/metadata only — not a scoring input
  submitted_by text REFERENCES public.users(id),  -- WHO typed it — audit only, never a gate
  submitted_at timestamptz,
  UNIQUE (game_id, participant_id, unit_label)
);
CREATE INDEX IF NOT EXISTS idx_score_entries_game_id ON public.score_entries (game_id);

-- ── game_results ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_results (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  entity_id text NOT NULL,                   -- user_id | team_id | play_group_id
  entity_type text NOT NULL CHECK (entity_type IN ('user', 'team', 'play_group')),
  raw_score integer,                         -- nullable (match play has none)
  position integer,
  competition_points_earned numeric,         -- null for standalone games
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_results_game_id ON public.game_results (game_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

-- games: members read; Owner/Organizer write.
DROP POLICY IF EXISTS games_select ON public.games;
CREATE POLICY games_select ON public.games FOR SELECT TO authenticated
  USING (is_trip_member(trip_id));
DROP POLICY IF EXISTS games_write ON public.games;
CREATE POLICY games_write ON public.games FOR ALL TO authenticated
  USING (has_trip_role(trip_id, ARRAY['Owner'::text, 'Organizer'::text]))
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text, 'Organizer'::text]));

-- game_participants: scoped through the parent game's trip.
DROP POLICY IF EXISTS game_participants_select ON public.game_participants;
CREATE POLICY game_participants_select ON public.game_participants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_participants.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS game_participants_write ON public.game_participants;
CREATE POLICY game_participants_write ON public.game_participants FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_participants.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_participants.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));

-- score_entries: ANY trip member may read AND write (anyone in the group can
-- enter scores for anyone — engine decision #7; submitted_by is audit only).
DROP POLICY IF EXISTS score_entries_select ON public.score_entries;
CREATE POLICY score_entries_select ON public.score_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = score_entries.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS score_entries_write ON public.score_entries;
CREATE POLICY score_entries_write ON public.score_entries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = score_entries.game_id AND is_trip_member(g.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = score_entries.game_id AND is_trip_member(g.trip_id)));

-- game_results: members read; Owner/Organizer write (computed on Finish).
DROP POLICY IF EXISTS game_results_select ON public.game_results;
CREATE POLICY game_results_select ON public.game_results FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_results.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS game_results_write ON public.game_results;
CREATE POLICY game_results_write ON public.game_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_results.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_results.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));
