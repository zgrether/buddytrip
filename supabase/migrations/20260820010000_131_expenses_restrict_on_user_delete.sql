-- ────────────────────────────────────────────────────────────────────────
-- Migration 131 — removing a person never deletes shared money
-- ────────────────────────────────────────────────────────────────────────
--
-- Restores ON DELETE RESTRICT on the two FKs that reach an expense from a
-- person:
--
--   expenses.paid_by_user_id  -> users(id)
--   expense_splits.user_id    -> users(id)
--
-- ── This REVERSES migration 027, which deserves the reply ─────────────────
--
-- 027 changed both from RESTRICT to CASCADE, under the heading:
--
--     "CASCADE (delete the user's own transient/financial rows):
--      invites.created_by, expenses.paid_by_user_id, expense_splits.user_id"
--
-- The classification is the error. An expense is not the payer's personal
-- data — it is a SHARED LEDGER ENTRY co-created with everyone it was split
-- across, and their stake in it survives the payer leaving. Measured on the
-- live database before migration 130: deleting ONE account removed 2 expenses
-- and the 14 splits owed by 14 OTHER people. Their balances changed because
-- someone else left.
--
-- 027's actual goal was "deletion just works" — it was solving blocked
-- deletes, and reclassifying expenses as personal is how it got there.
-- Migration 130 solved that goal properly: account deletion now converts the
-- users row to a placeholder instead of deleting it. That is what frees this
-- FK to say what it always should have.
--
-- ── Why RESTRICT and not SET NULL ─────────────────────────────────────────
--
-- SET NULL is impossible here, not merely undesirable: `expense_splits.user_id`
-- is part of the PRIMARY KEY (expense_id, user_id), and a PK column cannot be
-- null. Restructuring the key to permit "a share owed by nobody" would be
-- inventing a meaningless row in order to avoid saying no.
--
-- ── Why this is safe NOW, and would NOT have been last week ───────────────
--
-- RESTRICT blocks any DELETE of a referenced users row. Three callers reach
-- that, and all three are fine:
--
--   1. ACCOUNT DELETION no longer deletes the row (migration 130, applied to
--      production), so it never reaches this constraint. Landing this BEFORE
--      130 would have re-created #993 — an undeleteable account — one day
--      after fixing it.
--
--   2. `merge_guest_to_real_user` REPOINTS both columns to the real user
--      BEFORE deleting the ghost (migration 112: the UPDATEs at lines 196 and
--      222, the DELETE at line 298), and deletes the ghost's losing
--      `expense_splits` row first because (expense_id, user_id) is unique and
--      both sides may hold it. Verified by reading the function body — this is
--      the path where getting it wrong breaks SIGNUP for everyone.
--
--   3. `delete_orphan_guest_user` (below) already catches the violation.
--
-- ── The application has believed RESTRICT all along ───────────────────────
--
-- `ghostCrew.remove` was written against the ORIGINAL schema and says so:
--
--     "Expense/score rows reference users with ON DELETE RESTRICT, so a guest
--      who actually participated can't be hard-deleted; that delete errors and
--      we simply leave the row in place."
--
-- Four comments in that file describe RESTRICT behaviour. 027 changed the
-- constraint underneath them and left the code believing something that had
-- stopped being true, so this RESTORES the contract the application is coded
-- against rather than introducing a new one.
--
-- That mismatch was live and reachable WITHOUT deleting any account:
-- `findContributionBlockers` gates placeholder removal on games and receipts
-- (#996), but before that guard existed an owner removing a placeholder who
-- had paid for dinner hard-deleted the expense and every split on it. The
-- guard is the primary defence — four of the nine contribution columns are
-- invisible to FKs entirely — and this constraint is the backstop underneath
-- it for the two it can see.

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_paid_by_user_id_fkey;
ALTER TABLE public.expenses ADD  CONSTRAINT expenses_paid_by_user_id_fkey
  FOREIGN KEY (paid_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.expense_splits DROP CONSTRAINT IF EXISTS expense_splits_user_id_fkey;
ALTER TABLE public.expense_splits ADD  CONSTRAINT expense_splits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT expenses_paid_by_user_id_fkey ON public.expenses IS
  'RESTRICT: an expense is a shared ledger entry, not the payer''s personal data. Removing a person must never change what someone else owes. Account deletion does not reach this (migration 130 keeps the users row); the guest merge repoints this column before deleting a ghost (migration 131, reversing 027).';

COMMENT ON CONSTRAINT expense_splits_user_id_fkey ON public.expense_splits IS
  'RESTRICT: a split is one person''s share of a shared entry. SET NULL is impossible — user_id is part of the primary key (migration 131, reversing 027).';

-- ── The catch that guards this, restored to saying what it does ───────────
--
-- `delete_orphan_guest_user` swallows foreign_key_violation so that removing a
-- guest with history leaves their users row in place instead of failing the
-- removal the owner already saw succeed. Between migration 027 and this one
-- that catch was DEAD FOR EXPENSES — CASCADE raises nothing, so the delete
-- succeeded and took the expense with it. It is live again now.
--
-- A catch block that reads as protective while protecting nothing is how the
-- next person concludes the case is handled, so it says which constraint it is
-- catching and what happens instead.
--
-- The deployed function had also drifted from its migration file: the file
-- (016) carries an explanatory comment on this branch, the live body did not.
-- Re-stating the whole body here re-converges them.
CREATE OR REPLACE FUNCTION public.delete_orphan_guest_user(p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_guest = true
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_members tm WHERE tm.user_id = p_user_id
      );
EXCEPTION
  WHEN foreign_key_violation THEN
    -- They still hold history a foreign key can see: an expense they paid for,
    -- a split they are part of (both ON DELETE RESTRICT, migration 131), or a
    -- score they submitted. Keep the users row — the placeholder survives with
    -- its history intact, which is the same outcome account deletion produces
    -- (migration 130). The trip removal the owner performed still stands.
    --
    -- NOT a catch-all: only foreign_key_violation is swallowed, so any other
    -- failure still surfaces.
    NULL;
END;
$function$;

COMMENT ON FUNCTION public.delete_orphan_guest_user(text) IS
  'Hard-deletes a guest users row once they are on no trips. No-ops when a foreign key still references them (expenses, splits, submitted scores) — the placeholder survives with its history. Primary defence against removing someone who contributed is the application guard in participationGuard.ts (#996); four of the nine contribution columns have no FK at all.';
