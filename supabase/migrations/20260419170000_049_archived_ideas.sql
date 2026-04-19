-- Per-user archived destination ideas.
--
-- When an owner removes an idea from a trip, they can either delete it
-- outright or archive it for reuse in future trips. Archived ideas are a
-- user-scoped snapshot — each owner keeps their own copy, so the original
-- idea can be freely edited or deleted on the source trip without
-- affecting the archive. Duplicates (same title/location) are allowed
-- on purpose: the same destination may be planned multiple times across
-- seasons, and the `archived_at` timestamp plus `original_trip_title`
-- give the user a differentiator in the UI.

CREATE TABLE IF NOT EXISTS archived_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Snapshot of the idea at archive time.
  title text NOT NULL,
  location text NOT NULL,
  description text NOT NULL DEFAULT '',
  cost_tier text CHECK (cost_tier IN ('$', '$$', '$$$', '$$$$')),
  image_url text,
  golf_courses text[] NOT NULL DEFAULT '{}',
  activities text[] NOT NULL DEFAULT '{}',
  accommodation text,
  notes text,
  pros text[] NOT NULL DEFAULT '{}',
  cons text[] NOT NULL DEFAULT '{}',

  -- Provenance (all optional, survive if the source trip/idea is deleted).
  source_idea_id text,
  original_trip_id text REFERENCES trips (id) ON DELETE SET NULL,
  original_trip_title text,

  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archived_ideas_user_id ON archived_ideas (user_id);
CREATE INDEX IF NOT EXISTS idx_archived_ideas_archived_at ON archived_ideas (archived_at DESC);

ALTER TABLE archived_ideas ENABLE ROW LEVEL SECURITY;

-- Users only see, create, and delete their own archived ideas.
CREATE POLICY archived_ideas_select ON archived_ideas FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY archived_ideas_insert ON archived_ideas FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY archived_ideas_delete ON archived_ideas FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);
