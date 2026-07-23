-- 091 — allow a Member to delete/edit a receipt they paid for (RLS parity with tRPC)
--
-- expenses.remove and expenses.updateSplits (server/routers/expenses.ts) now
-- allow Owner (+ Organizer for remove) to act on any receipt, OR a plain
-- Member to remove/edit one where they are the paid_by_user_id (a mistyped
-- self-logged receipt shouldn't be stuck waiting on staff). tRPC enforces
-- this, but the writes go through the caller's own authenticated Supabase
-- client, so RLS must grant the same access or the write silently affects 0
-- rows (no error — just a no-op).
--
-- Only the self-payer clause is ADDED to each policy; existing Owner/Organizer
-- (expenses delete) and Owner-only (everything else) scoping is left exactly
-- as it was — narrowing or widening either beyond this ask is out of scope
-- here. updateSplits does DELETE + INSERT on expense_splits (not UPDATE), so
-- expense_splits_delete needs the exception too; expense_splits_insert is
-- already "any trip member" and needs no change. Idempotent (DROP + CREATE,
-- same as every other policy migration in this repo).

DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses FOR DELETE TO authenticated
  USING (
    has_trip_role(trip_id, ARRAY['Owner'::text, 'Organizer'::text])
    OR paid_by_user_id = (auth.uid())::text
  );

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated
  USING (
    has_trip_role(trip_id, ARRAY['Owner'::text])
    OR paid_by_user_id = (auth.uid())::text
  );

DROP POLICY IF EXISTS expense_splits_delete ON public.expense_splits;
CREATE POLICY expense_splits_delete ON public.expense_splits FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM expenses ex
    WHERE ex.id = expense_splits.expense_id
      AND (
        has_trip_role(ex.trip_id, ARRAY['Owner'::text])
        OR ex.paid_by_user_id = (auth.uid())::text
      )
  ));
