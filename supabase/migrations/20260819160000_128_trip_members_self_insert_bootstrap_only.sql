-- Migration 128 — a self-INSERT into trip_members may only BOOTSTRAP a trip
--
-- ── What this reverses, and why the earlier reasoning was half right ───────
--
-- Migration 122 widened the roster policies and kept the self arm untouched,
-- deliberately and with a stated reason:
--
--   "The self arm (`user_id = auth.uid()`) is preserved exactly as-is:
--    members still write their OWN row (join, travel, status, nickname), and
--    the trigger stops that arm being used to self-elevate."
--
-- That is correct about ELEVATION and silent about ADMISSION. The trigger does
-- stop self-elevation: `enforce_trip_member_role_write` returns early for
-- `INSERT ... role = 'Member'` and refuses every other role for a non-Owner.
-- But 'Member' IS the row that grants trip access. The policy never asked
-- whether the caller had any business being on that trip at all — so composed,
-- the two meant ANY authenticated account could add ITSELF to ANY trip whose
-- UUID it knew, as a Member, and then read and write it like any other member.
--
-- Note the shape, because it is the third instance: the tRPC layer gates this
-- correctly (`tripMembers.add` is Organizer-gated and mints no self rows), and
-- the DB policy is more permissive than any caller uses. #720's rule — a tRPC
-- check is not a policy — with the corollary this adds: a policy wider than its
-- callers is not "unused", it is unattended.
--
-- ── Confirmed by probe, not inferred (2026-08-19) ─────────────────────────
--
-- Run against production inside a transaction that was force-aborted, as the
-- `authenticated` role carrying a real non-member's JWT (test-outsider, 0
-- memberships) targeting a real 15-person trip:
--
--   self-INSERT role='Member'   -> ALLOWED
--   then, as that new member    -> read the trip title, all 16 roster rows,
--                                  69 crew chat messages, 148 score entries,
--                                  1 competition, 1 schedule item
--   post into the crew chat     -> ALLOWED
--   self-INSERT role='Organizer'-> refused (42501, the role guard)
--
-- Nothing was written; the probe transaction was aborted by a raised exception
-- and the roster/message counts were re-verified unchanged afterwards.
--
-- ── The remaining legitimate self-INSERT ──────────────────────────────────
--
-- Exactly one, and it is a bootstrap: `trips.create` inserts the creator as
-- Owner through the user-scoped client immediately after creating the trip, at
-- which point `is_trip_planner()` is false because no row exists yet. The
-- trigger already special-cases this (STEP 3, "the FIRST Owner of a brand-new
-- trip"); this policy now mirrors that condition instead of admitting every
-- self-insert in order to permit one.
--
-- The other self-insert this policy used to serve was `app/invite/page.tsx`
-- copying `invites.role` into `trip_members` from the browser. That code is
-- removed (#980) and was provably dead before removal: `invites` SELECT is
-- gated on `is_trip_member`, so the only session that could read the invite
-- token was already a member — precisely when the insert was skipped.
--
-- Untouched: self UPDATE and self DELETE. Members still write their own row
-- (travel, status, nickname) and still leave a trip on their own.
--
-- ── Residual, deliberately accepted ───────────────────────────────────────
--
-- A trip with ZERO members could still be claimed as Owner by any
-- authenticated caller. That window is the gap between `trips.create`'s two
-- inserts, and `trips.create` deletes the trip if the second one fails.
-- Production currently has 0 such trips (verified). Closing it properly needs
-- a `trips.created_by` column to compare against — `trips` has no ownership
-- column at all today — which is a schema change with a backfill and belongs
-- in its own migration, not in a security fix that should be applied now.

-- ── The helper ────────────────────────────────────────────────────────────
-- SECURITY DEFINER because a policy on trip_members that subqueries
-- trip_members would re-enter RLS. Same reason `is_trip_member` is one.
CREATE OR REPLACE FUNCTION public.trip_has_any_member(p_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = p_trip_id);
$function$;

COMMENT ON FUNCTION public.trip_has_any_member(text) IS
  'True once a trip has any roster row. Used by trip_members_insert to allow the creator''s own first Owner row (the bootstrap trips.create performs) while refusing every other self-insert (migration 128).';

-- ── The policy ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS trip_members_insert ON public.trip_members;
CREATE POLICY trip_members_insert ON public.trip_members
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    is_trip_planner(trip_id)
    OR (
      user_id = (auth.uid())::text
      AND role = 'Owner'
      AND NOT public.trip_has_any_member(trip_id)
    )
  );

COMMENT ON POLICY trip_members_insert ON public.trip_members IS
  'An Owner or Organizer may add anyone. A caller may add THEMSELVES only as the first Owner of a trip that has no roster yet — the bootstrap trips.create performs. Adding yourself to an existing trip is refused: it was reachable by anyone holding a trip UUID (migration 128, reversing the self arm migration 122 preserved).';
