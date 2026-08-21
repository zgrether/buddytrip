-- 137 — opting out of a shared cost is not the same as setting what you owe.
--
-- Closes F4 of the RLS audit.
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
--   expense_splits_self_update
--     USING ((user_id = auth.uid()::text) AND <caller is a member of the trip>)
--     WITH CHECK: none, so USING was reused
--
-- Probed: a plain member set their own split on a shared receipt from 50.00 to
-- -9999.00. The policy said WHICH ROW they could write and nothing about WHAT
-- they could write into it.
--
-- The only self-service caller is `expenses.optOut`, and it writes exactly two
-- columns with a closed set of values:
--
--     { opted_out: input.optOut, amount: input.optOut ? 0 : null }
--
-- "I'm out of this one" (0) or "put me back on the even split" (null, which the
-- read path divides at render time). It never sets a figure. Editing an actual
-- amount is `expenses.updateSplits`, which is Owner-or-payer and reached
-- through a different policy — and that is the whole point: a member can say
-- whether they are in, and the person whose receipt it is decides for how much.
--
-- This is somebody else's money. A member who owes 50 of a 90 dinner can
-- currently write themselves down to 1 — or to a negative, which flows straight
-- into the settle-up arithmetic everyone else reads.
--
-- ── The fix, and why it is expressible ────────────────────────────────────
--
-- RLS is row-level and cannot say "only these columns". It CAN say what the new
-- row must look like, and here the procedure's own value set is narrow enough
-- to state directly: `amount IS NULL OR amount = 0`. That is not a rule
-- invented to constrain the caller — it is the caller's own contract, moved
-- somewhere it applies to a raw PostgREST request too.
--
-- `expense_splits` has exactly one UPDATE call site in the codebase (verified,
-- not assumed: one `.update()` in `expenses.ts`, at optOut), so nothing else
-- can be caught by this.
--
-- ── Why the Owner arm is untouched ────────────────────────────────────────
--
-- `expense_splits_update` (Owner of the expense's trip) is a SEPARATE permissive
-- policy, and permissive policies OR together — including their checks. An
-- Owner writing a real figure passes through that arm and never has to satisfy
-- this one. A plain member has only this arm, so the constraint binds exactly
-- the people it should. Verified by probe rather than inferred from the docs.
--
-- Not addressed here: F5, the INSERT arm — a member can still add a split row
-- to a receipt they neither own nor paid. It needs a different shape than this
-- (there is no `created_by` on `expenses` to key on) and is tracked separately
-- rather than bundled into a fix that would look like it covered both.

DROP POLICY IF EXISTS expense_splits_self_update ON public.expense_splits;
CREATE POLICY expense_splits_self_update ON public.expense_splits
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    user_id = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.expenses ex
      WHERE ex.id = expense_splits.expense_id
        AND public.is_trip_member(ex.trip_id)
    )
  )
  WITH CHECK (
    user_id = (auth.uid())::text
    AND (amount IS NULL OR amount = 0)
    AND EXISTS (
      SELECT 1 FROM public.expenses ex
      WHERE ex.id = expense_splits.expense_id
        AND public.is_trip_member(ex.trip_id)
    )
  );

COMMENT ON POLICY expense_splits_self_update ON public.expense_splits IS
  'A member may opt themselves out of a shared cost, not decide what they owe. USING is unchanged (your own row, on a trip you are on); WITH CHECK now pins the new row to the closed value set expenses.optOut actually writes — amount 0 (opted out) or NULL (back on the even split). Setting a figure is expenses.updateSplits, which is Owner-or-payer and passes through the separate expense_splits_update policy, so this does not constrain an Owner. Before this, a member could write their own share of a shared receipt to any value including a negative one (migration 137, closing audit F4).';
