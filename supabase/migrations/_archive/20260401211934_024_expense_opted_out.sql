-- Add opted_out column to expense_splits for member self-service opt-out
ALTER TABLE expense_splits ADD COLUMN opted_out boolean NOT NULL DEFAULT false;

-- Allow any trip member to update their OWN expense_splits rows (for opt-out/rejoin).
-- The existing expense_splits_update policy (Owner-only) remains.
-- Postgres ORs multiple UPDATE policies, so both coexist.
CREATE POLICY expense_splits_self_update ON expense_splits FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM expenses ex WHERE ex.id = expense_id AND is_trip_member(ex.trip_id)
    )
  );
