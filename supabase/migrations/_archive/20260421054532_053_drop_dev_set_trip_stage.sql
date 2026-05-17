-- ============================================================
-- 053: Drop dev_set_trip_stage — remove debug-only stage override
--
-- Reverts migration 050. The owner-only debug toggle button that
-- cycled planning ↔ going in the trip top bar has been removed,
-- along with the devSetStage tRPC procedure. Drop the supporting
-- RPC and restore the original enforce_stage_transition trigger
-- (no GUC bypass) so backward stage transitions are strictly
-- forbidden again.
-- ============================================================

-- ── 1. Drop the debug RPC ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS dev_set_trip_stage(text, text);

-- ── 2. Restore the original enforce_stage_transition ───────────────────
-- Matches migration 029: forward-only, no bypass.

CREATE OR REPLACE FUNCTION enforce_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
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
