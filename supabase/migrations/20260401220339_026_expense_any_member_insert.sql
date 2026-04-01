-- Allow any trip member to create expenses (not just Owner/Planner)
DROP POLICY expenses_insert ON expenses;
CREATE POLICY expenses_insert ON expenses FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id));

DROP POLICY expense_splits_insert ON expense_splits;
CREATE POLICY expense_splits_insert ON expense_splits FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM expenses ex WHERE ex.id = expense_id AND is_trip_member(ex.trip_id)
  ));
