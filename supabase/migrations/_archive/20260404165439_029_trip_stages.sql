-- ============================================================
-- 029: Trip stage model
--
-- Adds a three-stage lifecycle: idea → planning → going
-- with owner-controlled advancement and visibility gating.
--
-- Stages are stored explicitly. Temporal substates (now, past)
-- are derived at read time in the application layer.
-- ============================================================

-- ── 1. New columns ──────────────────────────────────────────────────────

ALTER TABLE trips ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'idea'
  CHECK (stage IN ('idea', 'planning', 'going'));

ALTER TABLE trips ADD COLUMN IF NOT EXISTS stage_advanced_to_planning_at timestamptz;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS stage_advanced_to_going_at timestamptz;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS rsvp_message text;

-- ── 2. Backfill existing trips ──────────────────────────────────────────
-- Trips with a locked destination → planning stage
-- All others stay at 'idea' (the default)

UPDATE trips
SET
  stage = 'planning',
  stage_advanced_to_planning_at = COALESCE(locked_destination_at, created_at)
WHERE locked_destination_title IS NOT NULL;

-- ── 3. State machine trigger ────────────────────────────────────────────
-- Enforces valid transitions: idea → planning → going only.
-- Prevents reverting to an earlier stage.

CREATE OR REPLACE FUNCTION enforce_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Only allow forward transitions
  IF OLD.stage = 'idea' AND NEW.stage = 'planning' THEN
    RETURN NEW;
  ELSIF OLD.stage = 'planning' AND NEW.stage = 'going' THEN
    RETURN NEW;
  ELSIF OLD.stage = NEW.stage THEN
    -- No change — allow (other columns may be updating)
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid stage transition: % → %', OLD.stage, NEW.stage;
  END IF;
END;
$$;

CREATE TRIGGER trip_stage_transition
  BEFORE UPDATE OF stage ON trips
  FOR EACH ROW
  EXECUTE FUNCTION enforce_stage_transition();

-- ── 4. RLS helper: is_trip_planner ──────────────────────────────────────
-- Focused helper for stage visibility. Does not touch is_trip_member.

CREATE OR REPLACE FUNCTION is_trip_planner(p_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id
    AND user_id = auth.uid()::text
    AND role IN ('Owner', 'Planner')
  );
$$;

-- ── 5. Updated trips SELECT policy ──────────────────────────────────────
-- idea/planning → Owner/Planner only. going → all members.
-- Saved going-stage trips remain visible to all members (stage stays 'going').
-- Saved planning-stage trips remain planner-only (stage stays 'planning').

DROP POLICY IF EXISTS trips_select ON trips;

CREATE POLICY trips_select ON trips FOR SELECT TO authenticated
USING (
  CASE
    WHEN stage IN ('idea', 'planning')
    THEN is_trip_planner(id)
    ELSE is_trip_member(id)
  END
);

-- ── 6. Updated trip_status() computed function ──────────────────────────
-- Now incorporates stages in its output.

CREATE OR REPLACE FUNCTION trip_status(t trips) RETURNS text AS $$
  SELECT CASE
    WHEN t.trip_status_override = 'saved' THEN 'saved'
    WHEN t.end_date IS NOT NULL
      AND t.end_date + interval '3 days' < CURRENT_DATE THEN 'past'
    WHEN t.stage = 'going'
      AND t.start_date IS NOT NULL
      AND t.start_date - interval '3 days' <= CURRENT_DATE THEN 'now'
    WHEN t.stage = 'going' THEN 'going'
    WHEN t.stage = 'planning' THEN 'planning'
    ELSE 'idea'
  END;
$$ LANGUAGE sql STABLE SET search_path = '';
