-- ────────────────────────────────────────────────────────────────────────
-- Migration 027 — Make user deletion cascade/anonymize cleanly
-- ────────────────────────────────────────────────────────────────────────
--
-- Account deletion policy (option A — "we're a glorified spreadsheet, not a
-- bank"): a deleted user's TRIP CONTENT survives with authorship anonymized,
-- and their TRANSIENT / personal rows are removed. Today several FKs into
-- public.users are RESTRICT or NO ACTION, which BLOCK the delete entirely
-- (the on_auth_user_deleted trigger from migration 025 deletes the
-- public.users row, and any blocking FK rolls the whole auth-user delete back).
--
-- This migration re-points those FKs so deletion just works — for both the
-- in-app "Delete account" flow (users.deleteMe) and the Supabase dashboard.
--
-- SET NULL (keep the row, anonymize the author — requires the col be nullable):
--   schedule_items.created_by, schedule_items.confirmed_by,
--   logistics_items.created_by, idea_lodging_options.created_by
-- CASCADE (delete the user's own transient/financial rows):
--   invites.created_by, expenses.paid_by_user_id, expense_splits.user_id
--   (expense_splits already cascades off expenses, so a deleted payer's
--    expenses take their splits with them.)
--
-- NOTE: the SET NULL columns become nullable — any code reading `created_by`
-- must tolerate a null author (a member who has since deleted their account).
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-ADD; DROP NOT NULL is a no-op if
-- already dropped.

-- ── SET NULL: trip content survives, author anonymized ─────────────────────
ALTER TABLE public.schedule_items      ALTER COLUMN created_by   DROP NOT NULL;
ALTER TABLE public.logistics_items     ALTER COLUMN created_by   DROP NOT NULL;
ALTER TABLE public.idea_lodging_options ALTER COLUMN created_by  DROP NOT NULL;

ALTER TABLE public.schedule_items DROP CONSTRAINT IF EXISTS schedule_items_created_by_fkey;
ALTER TABLE public.schedule_items ADD  CONSTRAINT schedule_items_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.schedule_items DROP CONSTRAINT IF EXISTS schedule_items_confirmed_by_fkey;
ALTER TABLE public.schedule_items ADD  CONSTRAINT schedule_items_confirmed_by_fkey
  FOREIGN KEY (confirmed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.logistics_items DROP CONSTRAINT IF EXISTS logistics_items_created_by_fkey;
ALTER TABLE public.logistics_items ADD  CONSTRAINT logistics_items_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.idea_lodging_options DROP CONSTRAINT IF EXISTS idea_lodging_options_created_by_fkey;
ALTER TABLE public.idea_lodging_options ADD  CONSTRAINT idea_lodging_options_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── CASCADE: the user's own transient / financial rows go with them ────────
ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_created_by_fkey;
ALTER TABLE public.invites ADD  CONSTRAINT invites_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_paid_by_user_id_fkey;
ALTER TABLE public.expenses ADD  CONSTRAINT expenses_paid_by_user_id_fkey
  FOREIGN KEY (paid_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.expense_splits DROP CONSTRAINT IF EXISTS expense_splits_user_id_fkey;
ALTER TABLE public.expense_splits ADD  CONSTRAINT expense_splits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
