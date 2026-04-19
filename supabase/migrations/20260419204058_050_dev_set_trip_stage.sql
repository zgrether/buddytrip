-- ============================================================
-- 050: dev_set_trip_stage — debug-only stage override
--
-- Problem: migration 029 installed `enforce_stage_transition` which
-- raises an exception on any backward stage transition. This blocks
-- the owner-only dev toggle button (devSetStage tRPC procedure) from
-- reverting going → planning or planning → idea, so the button
-- appears to do nothing in that direction.
--
-- Fix: allow the trigger to be bypassed when a session-local GUC
-- `app.allow_stage_reversal` is set, and expose a SECURITY DEFINER
-- function that sets the GUC, updates the stage, and resets the
-- matching stage_advanced_to_*_at timestamp so downstream logic
-- (e.g. advanceToGoing's RSVP message nudge) doesn't see stale
-- going-stage artifacts after a revert.
--
-- Remove along with devSetStage before launch.
-- ============================================================

-- ── 1. Teach the trigger about the bypass GUC ──────────────────────────

CREATE OR REPLACE FUNCTION enforce_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Debug bypass: only effective within the transaction that sets it.
  IF current_setting('app.allow_stage_reversal', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Forward transitions only (original behaviour).
  IF OLD.stage = 'idea' AND NEW.stage = 'planning' THEN
    RETURN NEW;
  ELSIF OLD.stage = 'planning' AND NEW.stage = 'going' THEN
    RETURN NEW;
  ELSIF OLD.stage = NEW.stage THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid stage transition: % → %', OLD.stage, NEW.stage;
  END IF;
END;
$$;

-- ── 2. dev_set_trip_stage RPC ──────────────────────────────────────────
-- Owner-only shortcut that sets the stage directly and clears the
-- corresponding advancement timestamp when reversing.

CREATE OR REPLACE FUNCTION dev_set_trip_stage(p_trip_id text, p_stage text)
RETURNS trips
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.trips;
BEGIN
  IF p_stage NOT IN ('idea', 'planning', 'going') THEN
    RAISE EXCEPTION 'Invalid stage: %', p_stage;
  END IF;

  -- Owner-only gate (devSetStage's tRPC middleware also enforces this,
  -- but the RPC must defend itself too).
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id
      AND user_id = auth.uid()::text
      AND role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'Only the trip owner can override the stage';
  END IF;

  -- Bypass the forward-only trigger for this transaction.
  PERFORM set_config('app.allow_stage_reversal', 'on', true);

  UPDATE public.trips
  SET
    stage = p_stage,
    -- Clear the going timestamp if we're no longer going.
    stage_advanced_to_going_at = CASE
      WHEN p_stage = 'going' THEN stage_advanced_to_going_at
      ELSE NULL
    END,
    -- Clear the planning timestamp if we're dropping back to idea.
    stage_advanced_to_planning_at = CASE
      WHEN p_stage IN ('planning', 'going') THEN stage_advanced_to_planning_at
      ELSE NULL
    END,
    -- Drop the RSVP nudge message when we leave the going stage.
    rsvp_message = CASE
      WHEN p_stage = 'going' THEN rsvp_message
      ELSE NULL
    END
  WHERE id = p_trip_id
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Trip not found: %', p_trip_id;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION dev_set_trip_stage(text, text) TO authenticated;
