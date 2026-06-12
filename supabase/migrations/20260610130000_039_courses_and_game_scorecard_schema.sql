-- 039 — Course library (global) + per-game scorecard_schema (Slice C part 2)
--
-- The Course Selector/Builder produces real par + stroke-index data. Per the
-- spec, course data is a GLOBAL fact (Pebble Creek's index is the same for
-- everyone) — NOT circle-scoped. `circle_courses` (migration 024) stays a
-- circle-bound stub reserved for a later Circle-Era *join* to these global
-- courses; `golf_course_details` is dead (archived migrations only). So this
-- adds a standalone global `courses` table as the library.
--
-- THE CONTRACT: applying a course to a game SNAPSHOTS its par[] + handicap_index[]
-- into games.scorecard_schema.units.metadata (the shape strokeHoles reads). The
-- column doesn't exist yet — added here as nullable jsonb; effective schema =
-- games.scorecard_schema ?? the game-type template's. Idempotent throughout.

-- ── 1. courses — the global course library ─────────────────────────────────
-- text PK per the app-wide id convention. par + handicap_index are course-level
-- facts (identical across tees); tee_sets carries the per-tee (optional) yards.
CREATE TABLE IF NOT EXISTS public.courses (
  id             text        NOT NULL DEFAULT gen_random_uuid()::text,
  name           text        NOT NULL,
  location       text,
  hole_count     int         NOT NULL DEFAULT 18 CHECK (hole_count IN (9, 18)),
  par            jsonb       NOT NULL,   -- int[] length = hole_count
  handicap_index jsonb       NOT NULL,   -- int[] permutation of 1..hole_count
  tee_sets       jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{ name, yards: (int|null)[] }]
  source         text        NOT NULL DEFAULT 'manual',    -- 'manual' | 'golfapi'
  provider_id    text,       -- external course id (provenance / future dedup)
  created_by     text        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
COMMENT ON TABLE public.courses IS
  'Global golf course library (par + stroke index + per-tee yards). Course data '
  'is a global fact, not circle-scoped; circle_courses is reserved for a later '
  'Circle-Era join to these rows. Slice C part 2.';
CREATE INDEX IF NOT EXISTS idx_courses_created_at ON public.courses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_provider_id ON public.courses (provider_id);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

-- Global library: any authenticated user can read every course and add new ones;
-- edits/deletes are limited to the creator (a snapshot already protects played
-- games from later edits — see the games.scorecard_schema contract).
DROP POLICY IF EXISTS courses_select ON public.courses;
CREATE POLICY courses_select ON public.courses
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS courses_insert ON public.courses;
CREATE POLICY courses_insert ON public.courses
  FOR INSERT TO authenticated
  WITH CHECK (created_by = (auth.uid())::text);

DROP POLICY IF EXISTS courses_update ON public.courses;
CREATE POLICY courses_update ON public.courses
  FOR UPDATE TO authenticated
  USING (created_by = (auth.uid())::text)
  WITH CHECK (created_by = (auth.uid())::text);

DROP POLICY IF EXISTS courses_delete ON public.courses;
CREATE POLICY courses_delete ON public.courses
  FOR DELETE TO authenticated
  USING (created_by = (auth.uid())::text);

-- ── 2. games.scorecard_schema — the per-game contract snapshot ──────────────
-- Nullable: when null the game falls back to its game-type template's schema.
-- Applying a course writes a COPY of the course par/index here (a snapshot, not
-- a live ref) so a later edit to the global course never rescores a past game.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS scorecard_schema jsonb;

-- ── 3. games.course_id — repoint from circle_courses to the global courses ──
-- course_id is kept as provenance ("this game used Pebble Creek"). It used to
-- reference the circle_courses stub; the real library is now `courses`.
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_course_id_fkey;
ALTER TABLE public.games
  ADD CONSTRAINT games_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;
