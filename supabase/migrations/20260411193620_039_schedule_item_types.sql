-- Add item type and golf-specific fields to schedule_items
ALTER TABLE schedule_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'general'
    CHECK (item_type IN ('general', 'golf')),
  ADD COLUMN IF NOT EXISTS course_name text,
  ADD COLUMN IF NOT EXISTS course_location text,
  ADD COLUMN IF NOT EXISTS tee_times jsonb;
