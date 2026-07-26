-- 094 — Roster REORDER opens to the captain, at the RLS layer.
--
-- ── What this reverses, and why it's right now ───────────────────────────────
-- This reverses a deliberate, documented decision — not an oversight. Both the
-- middleware note (middleware.ts:179-181) and PERMISSIONS.md drew the captain
-- line at IDENTITY, and PERMISSIONS.md named reorder INDIVIDUALLY in the
-- exclusion list:
--
--   "Roster/structure stays OWNER-ONLY — add/remove (teamAssignments.assign/
--    remove), reorder (reorder), and appointing the captain itself (setCaptain)
--    are not granted to a captain ... Captain-led roster management is parked
--    for the future captain's-draft feature."
--
-- That reasoning deserves a reply rather than a silent overwrite. It grouped
-- reorder with add/remove/setCaptain as "roster/structure". The distinction that
-- matters is MEMBERSHIP vs DISPLAY ORDER: assign/remove change who is on a team,
-- setCaptain changes who holds the role, and both are membership acts. reorder
-- changes only how an existing roster is PRESENTED in the assignment pickers —
-- it is validated as a strict permutation of the team's current members
-- (teamAssignments.reorder), so it can neither add, drop, nor move anyone. On
-- that reading reorder sits with identity, which the captain already owns
-- (migration 065): a captain who may rename and recolour their team may also
-- order it. add/remove/setCaptain are untouched and stay owner-only, so the
-- parked captain's-draft feature keeps its actual substance.
--
-- There is also a concrete forcing function. The planned Edit Team
-- draft-then-save commits identity + roster order from one Save, firing
-- teams.update (owner-or-captain, mig 065) alongside teamAssignments.reorder
-- (owner-only today). A captain pressing Save would get identity written and
-- ordering refused — a partial write, for precisely the user the feature exists
-- for. One shared gate removes that hazard.
--
-- ── The change ───────────────────────────────────────────────────────────────
-- team_assignments_update: keep Owner + Organizer, ADD the captain of THAT team.
-- Organizer is deliberately RETAINED here (unlike mig 065, which dropped it from
-- teams_update): teamAssignments.assign is gated requireTripRole('Organizer') and
-- upserts — moving a player UPDATEs an existing row — so dropping Organizer would
-- break assignment for co-admins.
--
-- WITH CHECK is now stated EXPLICITLY. Postgres falls back to USING when an
-- UPDATE policy omits WITH CHECK, so this is behaviour-preserving for
-- Owner/Organizer; it is spelled out because the captain branch makes the
-- post-image condition load-bearing (see below).
--
-- ── Recorded limitation (accepted, deliberate) ───────────────────────────────
-- RLS grants at ROW granularity — it cannot confine a captain to the sort_order
-- COLUMN. So at the database layer a captain gains UPDATE on their own team's
-- team_assignments rows generally, not just on sort_order. This is the standard
-- defence-in-depth posture used throughout this app: RLS is the coarse backstop,
-- the tRPC procedure is the precise gate. teamAssignments.reorder only ever
-- writes sort_order (and re-writes team_id to the value the row already has),
-- and setCaptain remains owner-gated at the tRPC layer.
--
-- The residual, stated plainly so a future audit finds a decision rather than a
-- surprise. Each line below was EXERCISED against this policy, not reasoned
-- about — a captain calling PostgREST directly, bypassing the client:
--
--   CAN  edit sort_order on their own team's rows          — the intended grant.
--   CAN  clear their OWN is_captain flag (self-demotion).  One-way: the moment
--        the flag is gone so is the grant, so they cannot restore it; only an
--        owner can. Verified.
--   CAN  change competition_id on a row of their own team, which strands that
--        row in another competition while keeping team_id. Corrupts their own
--        team's data; grants them nothing. The sharpest residual here, and still
--        self-inflicted rather than an escalation. Verified.
--   CANNOT promote a teammate to captain. One-step is refused by
--        team_assignments_one_captain_per_team (UNIQUE); the two-step
--        (clear own, then promote) fails at step 2 because step 1 already
--        revoked the grant. Verified both ways.
--   CANNOT move any row to a different team — WITH CHECK re-evaluates the
--        POST-image, and captaincy is at most one team. Verified.
--   CANNOT touch another team's rows at all. Verified — this is the boundary
--        this migration exists to establish.
--
-- Net: no privilege escalation and no cross-team reach; the reachable damage is
-- confined to a roster the captain already administers. Accepted deliberately.
--
-- ── Why the captain test is a SECURITY DEFINER function, not an inline EXISTS ─
-- The captain predicate has to read team_assignments — the SAME relation the
-- policy guards. Inlining it as `EXISTS (SELECT 1 FROM public.team_assignments
-- cap WHERE ...)` makes the policy self-referential, and Postgres raises
-- `infinite recursion detected in policy for relation "team_assignments"` on
-- EVERY update, for every role (verified against this exact policy before
-- switching approaches — owner writes died too, not just captain ones).
--
-- Migration 065 could inline the same lookup because its policy guards `teams`,
-- a DIFFERENT relation from the team_assignments it reads. That option isn't
-- available here.
--
-- The fix is the pattern already established in this schema: a STABLE
-- SECURITY DEFINER predicate, exactly mirroring has_trip_role / is_trip_member
-- (same LANGUAGE sql, same `SET search_path TO ''`, same broad EXECUTE). Running
-- as the definer bypasses RLS on the inner read, so the cycle is broken.
--
-- EXECUTE stays granted (it is NOT revoked): CLAUDE.md's
-- "REVOKE FROM PUBLIC" rule targets un-guarded SECURITY DEFINER *cores* that
-- perform privileged ACTIONS. This is a read-only boolean predicate evaluated
-- INSIDE an RLS policy — the calling role must be able to execute it or every
-- policy check fails. has_trip_role and is_trip_member carry the same grants for
-- the same reason.
--
-- Additive + idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS), replayable
-- from zero.

CREATE OR REPLACE FUNCTION public.is_team_captain(p_team_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_assignments
    WHERE team_id = p_team_id
      AND user_id = (auth.uid())::text
      AND is_captain
  );
$$;

COMMENT ON FUNCTION public.is_team_captain(text) IS
  'True when the CURRENT user is the captain of p_team_id. SECURITY DEFINER so it '
  'can be used inside team_assignments'' own RLS policy without self-recursion.';

DROP POLICY IF EXISTS team_assignments_update ON public.team_assignments;
CREATE POLICY team_assignments_update ON public.team_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = team_assignments.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
    )
    OR public.is_team_captain(team_assignments.team_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = team_assignments.competition_id
        AND public.has_trip_role(c.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
    )
    OR public.is_team_captain(team_assignments.team_id)
  );
