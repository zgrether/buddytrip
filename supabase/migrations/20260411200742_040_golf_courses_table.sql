-- Shared golf courses registry — reusable across trips
CREATE TABLE IF NOT EXISTS golf_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text UNIQUE,                    -- Google Places place_id for dedup
  name text NOT NULL,
  address text,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Link schedule items to a golf course (nullable — only golf items use this)
ALTER TABLE schedule_items
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES golf_courses(id);

CREATE INDEX IF NOT EXISTS idx_golf_courses_place_id ON golf_courses(place_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_course_id ON schedule_items(course_id);

-- Anyone can read golf courses (shared registry)
ALTER TABLE golf_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can view golf courses" ON golf_courses FOR SELECT USING (true);
CREATE POLICY "authenticated can insert golf courses" ON golf_courses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
