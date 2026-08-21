-- 140 — the last three audit findings. Narrowing only; every capability these
-- remove already has a home, landed in 138/139 and deployed in #1008.
--
-- ══ F5 — anyone on the trip could add split rows to anyone's receipt ══════
--
--   expense_splits_insert
--     WITH CHECK (EXISTS (SELECT 1 FROM expenses ex
--                          WHERE ex.id = expense_splits.expense_id
--                            AND is_trip_member(ex.trip_id)))
--
-- Probed: a member added a 999.00 split for a third person onto a receipt paid
-- by the Owner. Nothing tied the row to the caller or to a receipt they had
-- any part in.
--
-- `expenses.updateSplits` — the procedure that rewrites splits — is
-- Owner-or-payer. `expenses.create` inserts the splits for a receipt the caller
-- is creating. Nothing else inserts a split at all, so those two are the whole
-- legitimate set, and the policy now says exactly that:
--
--   Owner  OR  the payer  OR  the person who logged the receipt
--
-- The third arm is what needed migration 138's `created_by`, because
-- `expenses.create` lets any member record a receipt someone ELSE paid — a real
-- flow ("Zach paid for dinner") that Owner-OR-payer alone would have broken.
--
-- NULL `created_by` — every row predating 138 — falls through to Owner-or-payer,
-- which is the correct reading: there is no author on record to appeal to. That
-- costs nothing, because the only procedure that inserts splits onto an
-- existing receipt is `updateSplits`, and it is Owner-or-payer anyway.
--
-- ══ F8 / F9 — the captain arms ═══════════════════════════════════════════
--
-- A team captain could change `team_assignments.user_id` (swapping a teammate
-- for anyone in the database) and `teams.competition_id` (moving their team to
-- another cup). Both probed. `requireTeamIdentityEdit`'s own comment says the
-- gate is "identity + presentation of a team you already run, not roster
-- control" and that "MEMBERSHIP stays owner-only... don't widen it" — the tRPC
-- layer honours that; these two policies did not, because a row-level policy
-- cannot express "these columns only".
--
-- Both arms are removed. Nothing is taken away from a captain: since #1008 the
-- two things they actually do go through definers that can do nothing else —
-- `update_team_identity` (four identity columns; `competition_id` absent from
-- its UPDATE by construction) and `reorder_team_roster` (permutation-validated,
-- writes `sort_order` alone). Those functions run their OWN authorization —
-- Owner or that team's captain, the same gate — so captaincy still means what
-- it meant. It simply stops being expressed as write access to whole rows.
--
-- ── The trigger that is deliberately not here ─────────────────────────────
--
-- Comparing OLD to NEW in a BEFORE UPDATE trigger is the ordinary way to freeze
-- a column, and it would have been wrong. `merge_guest_to_real_user` runs
-- `UPDATE team_assignments SET user_id = p_real_id` inside the `handle_new_user`
-- signup trigger — precisely the write F8 forbids, by the one caller that is
-- correct — and triggers fire regardless of SECURITY DEFINER. At the row level
-- the merge and a captain's swap are the same statement. Migration 122 met this
-- on `trip_members` and escaped it with an early exit; there is no equivalent
-- signal here, and the failure mode is a failed SIGNUP for anyone holding a
-- colliding placeholder. Moving the capability avoided having to tell the two
-- apart at all.
--
-- ── What each still admits, stated so the next reader need not re-derive it ──
--
--   teams_update              Owner of the competition's trip
--   team_assignments_update   Owner or Organizer of that trip
--   (captains)                update_team_identity / reorder_team_roster only

-- ── F5 ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS expense_splits_insert ON public.expense_splits;
CREATE POLICY expense_splits_insert ON public.expense_splits
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses ex
      WHERE ex.id = expense_splits.expense_id
        AND public.is_trip_member(ex.trip_id)
        AND (
          public.has_trip_role(ex.trip_id, ARRAY['Owner'::text])
          OR ex.paid_by_user_id = (auth.uid())::text
          OR ex.created_by      = (auth.uid())::text
        )
    )
  );

COMMENT ON POLICY expense_splits_insert ON public.expense_splits IS
  'Splits may be added by the trip Owner, the person who paid, or the person who logged the receipt — the three the procedures actually use (expenses.create for a receipt you are creating, expenses.updateSplits which is Owner-or-payer). Was any trip member, which let someone add rows assigning debt to arbitrary people on a receipt they had no part in. The created_by arm exists because expenses.create lets a member record a receipt somebody else paid; NULL created_by (rows predating migration 138) falls back to Owner-or-payer, there being no author on record (migration 140, closing audit F5).';

-- ── F8 ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS team_assignments_update ON public.team_assignments;
CREATE POLICY team_assignments_update ON public.team_assignments
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = team_assignments.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = team_assignments.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
    )
  );

COMMENT ON POLICY team_assignments_update ON public.team_assignments IS
  'Trip staff only. The captain arm is gone: it admitted the whole row, so a captain could rewrite user_id and swap a teammate for anyone in the database — roster control that requireTeamIdentityEdit explicitly reserves to the Owner. Captains reorder through reorder_team_roster instead, which validates a permutation and writes sort_order alone. Not fixed with a trigger because merge_guest_to_real_user performs this exact UPDATE inside the signup trigger, and triggers fire even for SECURITY DEFINER (migration 140, closing audit F8).';

-- ── F9 ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS teams_update ON public.teams;
CREATE POLICY teams_update ON public.teams
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = teams.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = teams.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text])
    )
  );

COMMENT ON POLICY teams_update ON public.teams IS
  'Trip Owner only. The captain arm is gone: being row-level it admitted competition_id too, so a captain could move their team into a different cup. Captains rename and recolour through update_team_identity instead, whose UPDATE omits competition_id by construction. WITH CHECK is now spelled out rather than defaulting to USING — on this table the two were always the same, and writing it down stops the next reader inferring it (migration 140, closing audit F9).';
