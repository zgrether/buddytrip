-- Drop the enforce_stage_transition trigger and its function.
--
-- The trigger was added in 029_trip_stages.sql to enforce forward-only
-- stage transitions (idea → planning → going). It is now redundant because:
--   1. The application layer enforces valid forward transitions via the
--      `advanceToPlanning` and `advanceToGoing` tRPC procedures.
--   2. The dev-only `updatePlanningTier` toggle needs to revert stage
--      from "going" → "planning" so owners can re-run the Make it Official
--      flow without creating a new trip.
--
-- Removing the trigger allows the time-machine behaviour while keeping the
-- business logic guard in app code where it can be tested cleanly.

DROP TRIGGER IF EXISTS trip_stage_transition ON trips;
DROP FUNCTION IF EXISTS enforce_stage_transition();
