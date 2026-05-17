-- Catalog of curated destination ideas (not trip-specific)
CREATE TABLE catalog_ideas (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  location      text NOT NULL,
  description   text NOT NULL,
  image_url     text,
  cost_tier     text CHECK (cost_tier IN ('$', '$$', '$$$', '$$$$')),

  -- Filtering dimensions
  categories    text[] NOT NULL DEFAULT '{}',
  -- values: 'golf' | 'beach' | 'ski' | 'city' | 'adventure' | 'international'
  group_types   text[] NOT NULL DEFAULT '{}',
  -- values: 'guys_trip' | 'couples' | 'family' | 'corporate' | 'any'
  trip_length   text,
  -- values: 'weekend' | '4_days' | 'week_plus'
  region        text,
  -- values: 'southeast' | 'southwest' | 'northeast' | 'midwest' |
  --         'northwest' | 'mountain' | 'international'

  -- Rich content
  golf_courses  text[] NOT NULL DEFAULT '{}',
  activities    text[] NOT NULL DEFAULT '{}',
  accommodation text,
  tips          text,

  -- Admin
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for filtering
CREATE INDEX ON catalog_ideas USING GIN(categories);
CREATE INDEX ON catalog_ideas USING GIN(group_types);
CREATE INDEX ON catalog_ideas(cost_tier);
CREATE INDEX ON catalog_ideas(region);
CREATE INDEX ON catalog_ideas(is_active, sort_order);

-- Full-text search
ALTER TABLE catalog_ideas
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || location || ' ' || description)
  ) STORED;
CREATE INDEX ON catalog_ideas USING GIN(search_vector);

-- RLS: authenticated users can read active catalog ideas; no user writes
ALTER TABLE catalog_ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog_ideas_read" ON catalog_ideas
  FOR SELECT TO authenticated
  USING (is_active = true);

-- Future-proofing: source_idea_id for forking ideas across trips
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS source_idea_id text REFERENCES ideas(id);
-- Update source column comment to include 'catalog' and 'forked' as allowed values
COMMENT ON COLUMN ideas.source IS 'Origin of the idea: manual | ai | catalog | forked';
