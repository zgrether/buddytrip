-- 101 — Organizer parity at the RLS layer (#786, ratified in #770/#785)
--
-- ── What this reverses, and why it's right now ───────────────────────────────
-- This directly reverses migration 030 (`tighten_rls_to_match_trpc`, 2026-06-07)
-- for three of its four sections, so 030's reasoning deserves a reply rather
-- than a silent overwrite.
--
-- 030 was CORRECT ON ITS OWN TERMS. Its stated goal was parity: an RLS parity
-- audit found write-policies LOOSER than the tRPC gates, and it pulled RLS down
-- to match tRPC so the backstop mirrored the API. It did not decide that these
-- actions ought to be Owner-only; it took the tRPC gates as given and made the
-- database agree with them.
--
-- What has changed is the thing 030 took as given. #770 ratified the rule the
-- tRPC gates were an unexamined drift away from:
--
--   "An Organizer helps run the trip. Only the Owner changes who is trusted,
--    ends a container, or erases everyone else's content."
--
-- So the tRPC gates 030 mirrored are now themselves the deviation (PERMISSIONS.md
-- → Audit notes). 030's parity principle is UNCHANGED and still governs — this
-- migration keeps RLS mirroring tRPC. Both layers move together, in the same
-- direction, for the same reason. What moves is the reference point, not the
-- rule that they must agree.
--
-- Note also that 030 anticipated exactly the limitation this migration runs
-- into: it declined to touch `trips` UPDATE because lockDestination /
-- transferOwnership are "*column-level* distinctions that row-level RLS can't
-- express without a trigger." That same limitation is why the `trip_members`
-- cluster is deliberately NOT in this migration — see the closing note.
--
-- ── The predicate ────────────────────────────────────────────────────────────
-- `is_trip_planner(trip_id)` already means Owner-or-Organizer (migration 029
-- swapped its body from 'Planner' to 'Organizer' when the role VALUE was
-- renamed). So this is a predicate SWAP, not a new predicate:
--
--   has_trip_role(trip_id, ARRAY['Owner'])  ->  is_trip_planner(trip_id)
--
-- The function NAME still says "planner" and is left alone for the same reason
-- 029 gave when it kept the name: it is an internal helper called by ~6
-- policies, and renaming would churn every one of them for no behavioural gain.
--
-- ── Scope ────────────────────────────────────────────────────────────────────
-- Covers the RLS half of the deviating procedures that can move WITHOUT
-- widening the trust boundary the principle exists to protect:
--
--   invites INSERT           <- tripMembers.inviteByEmail / .sendInvitationBlast
--   ideas INSERT/DELETE      <- ideas.create / ideas.remove
--   team_assignments DELETE  <- teamAssignments.remove
--   date_poll_votes x4       <- datePoll.castVoteForMember
--   assert_game_owner()      <- games.resetScoring / .resetToSkeleton
--
-- DELIBERATELY NOT COVERED (each has a reason, stated at the end):
--   trip_members INSERT/UPDATE/DELETE, and link_guest_to_account().
--
-- Idempotent; replayable from zero (policy DROP IF EXISTS + CREATE, CREATE OR
-- REPLACE FUNCTION, no environment-specific ids).

-- ── 1. invites — creating an invite is an Organizer action ───────────────────
-- Reverses 030 §2. Inviting crew is running the trip; it does not change who is
-- TRUSTED (an invite carries role 'Organizer' or 'Member' per the invites_role
-- CHECK, and accepting one creates a trip_members row through the signup path,
-- not through this policy).
--
-- 030 also renamed this policy from "planners and owners can create invites" to
-- "owners can create invites" so the name wouldn't lie about the predicate. The
-- name would now lie in the other direction, so it is renamed once more — this
-- time to a neutral, convention-matching `invites_insert` (every policy added
-- since 001 uses `<table>_<cmd>`), so a future change to the predicate does not
-- require a third rename. Both historical names are dropped.
DROP POLICY IF EXISTS "planners and owners can create invites" ON public.invites;
DROP POLICY IF EXISTS "owners can create invites" ON public.invites;
DROP POLICY IF EXISTS invites_insert ON public.invites;
CREATE POLICY invites_insert ON public.invites
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_trip_planner(trip_id));

-- ── 2. ideas — adding and removing trip ideas is an Organizer action ─────────
-- Owner-only since 001 (and archived migration 048 tightened INSERT to
-- owner-only explicitly). An idea is one unit of work: removing one does not
-- end a container and does not erase a body of other people's content — idea
-- VOTES cascade with it, but the idea is the object, not a container others
-- live inside. Straightforward pre-rule drift.
DROP POLICY IF EXISTS ideas_insert ON public.ideas;
CREATE POLICY ideas_insert ON public.ideas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_trip_planner(trip_id));

DROP POLICY IF EXISTS ideas_delete ON public.ideas;
CREATE POLICY ideas_delete ON public.ideas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_trip_planner(trip_id));

-- ── 3. team_assignments DELETE — un-assigning a player from a team ───────────
-- The INSERT and UPDATE arms of this table are ALREADY Owner+Organizer (001 for
-- INSERT; migration 094 for UPDATE, which additionally added the team captain
-- and deliberately RETAINED Organizer because teamAssignments.assign is
-- `requireTripRole('Organizer')` and upserts). DELETE was the odd one out — an
-- Organizer could assign a player but not un-assign them. This closes that
-- split within one table.
--
-- The captain branch of 094 is NOT extended to DELETE: 094 drew its line at
-- DISPLAY ORDER vs MEMBERSHIP, and removing an assignment is a membership act.
-- Owner + Organizer only, exactly as INSERT already is.
DROP POLICY IF EXISTS team_assignments_delete ON public.team_assignments;
CREATE POLICY team_assignments_delete ON public.team_assignments
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = team_assignments.competition_id
      AND is_trip_planner(c.trip_id)
  ));

-- ── 4. date_poll_votes — voting on behalf of another member ──────────────────
-- Reverses 030 §3 for the two "_ghost" policies, and extends the same change to
-- the two "_owner_any" policies 030 left alone (it had no need to touch them —
-- they were already Owner-only from 001).
--
-- All four back ONE procedure, datePoll.castVoteForMember: the "_ghost" pair
-- covers voting for a placeholder crew member, the "_owner_any" pair covers
-- voting for a real member who hasn't voted. Moving only one pair would leave
-- an Organizer able to vote for guests but not for people, which is a stranger
-- rule than either endpoint. All four move together.
--
-- This does NOT let an Organizer alter a member's own vote in the sense that
-- matters: the policies are additive to date_poll_votes_update (self-vote), and
-- the tRPC procedure is what decides whose vote may be cast. Recording
-- availability for someone who is standing next to you is running the trip.
DROP POLICY IF EXISTS date_poll_votes_insert_ghost ON public.date_poll_votes;
CREATE POLICY date_poll_votes_insert_ghost ON public.date_poll_votes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM public.users u
       WHERE u.id = date_poll_votes.user_id AND u.is_guest = true))
    AND (EXISTS (SELECT 1 FROM public.date_windows dw
       WHERE dw.id = date_poll_votes.window_id
         AND is_trip_planner(dw.trip_id)))
  );

DROP POLICY IF EXISTS date_poll_votes_update_ghost ON public.date_poll_votes;
CREATE POLICY date_poll_votes_update_ghost ON public.date_poll_votes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM public.users u
       WHERE u.id = date_poll_votes.user_id AND u.is_guest = true))
    AND (EXISTS (SELECT 1 FROM public.date_windows dw
       WHERE dw.id = date_poll_votes.window_id
         AND is_trip_planner(dw.trip_id)))
  );

DROP POLICY IF EXISTS date_poll_votes_insert_owner_any ON public.date_poll_votes;
CREATE POLICY date_poll_votes_insert_owner_any ON public.date_poll_votes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM public.date_windows dw
       WHERE dw.id = date_poll_votes.window_id
         AND is_trip_planner(dw.trip_id)))
    AND (EXISTS (SELECT 1 FROM public.trip_members tm
       JOIN public.date_windows dw2 ON dw2.id = date_poll_votes.window_id
       WHERE tm.trip_id = dw2.trip_id AND tm.user_id = date_poll_votes.user_id))
  );

DROP POLICY IF EXISTS date_poll_votes_update_owner_any ON public.date_poll_votes;
CREATE POLICY date_poll_votes_update_owner_any ON public.date_poll_votes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM public.date_windows dw
       WHERE dw.id = date_poll_votes.window_id
         AND is_trip_planner(dw.trip_id)))
    AND (EXISTS (SELECT 1 FROM public.trip_members tm
       JOIN public.date_windows dw2 ON dw2.id = date_poll_votes.window_id
       WHERE tm.trip_id = dw2.trip_id AND tm.user_id = date_poll_votes.user_id))
  );

-- ── 5. assert_game_owner() — the THIRD gate, invisible as a policy ───────────
-- Migration 066 introduced this guard for the per-game reset primitives. It is
-- not an RLS policy, so it does not appear in any pg_policies sweep: it is a
-- hardcoded `tm.role = 'Owner'` inside a plpgsql body, reached through the
-- `reset_game_scoring` / `reset_game_to_skeleton` wrappers. A tRPC-only change
-- to games.resetScoring / .resetToSkeleton would have left both refused here,
-- with an error from a layer nobody was looking at.
--
-- A game is ONE UNIT OF WORK, not a container others live inside — the test
-- PERMISSIONS.md states — so resetting one is the Organizer's to do. Note the
-- sibling gate for the same tier is already Owner+Organizer: `games_write`
-- (migration 033, FOR ALL) has always permitted an Organizer, which is why
-- games.delete needs no policy change in this migration at all. The reset
-- primitives were the outlier.
--
-- The predicate is written INLINE rather than as is_trip_planner(v_trip_id)
-- to preserve the function's existing shape: it already resolves the trip from
-- the game (games.trip_id, deliberately not via competition_id, which is
-- nullable), and the EXISTS check is the mechanism 066 borrowed from
-- assert_competition_owner. Only the role set changes.
--
-- The NAME is kept, and now under-states what it permits — the same trade 029
-- made when it kept `is_trip_planner` after the role rename. Renaming would
-- churn both wrappers and migration 100's comment for no behavioural gain; the
-- error message is corrected instead, since that is the part a user sees.
CREATE OR REPLACE FUNCTION public.assert_game_owner(p_game_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_trip_id text;
BEGIN
  SELECT trip_id INTO v_trip_id FROM public.games WHERE id = p_game_id;

  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Game % not found', p_game_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members tm
    WHERE tm.trip_id = v_trip_id
      AND tm.user_id = (auth.uid())::text
      AND tm.role IN ('Owner', 'Organizer')
  ) THEN
    RAISE EXCEPTION 'Only a trip owner or organizer can reset a game'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ── What is deliberately NOT here ────────────────────────────────────────────
--
-- (a) trip_members INSERT / UPDATE / DELETE — backing tripMembers.add, .remove,
--     .updateNickname, .updateMemberTravel and ghostCrew.create / .remove.
--
--     Widening these is NOT a predicate swap; it dissolves exception 1 at the
--     database layer. RLS grants at ROW granularity and cannot confine a writer
--     to a COLUMN, so `is_trip_planner` on trip_members_update would let an
--     Organizer calling PostgREST directly set any member's `role` — including
--     their own, to 'Owner'. The tRPC gate on tripMembers.updateRole would still
--     refuse, but tRPC is not the boundary being crossed. The one rule the
--     principle exists to protect would hold only in the client.
--
--     This is the exact limitation 030 named when it declined to touch `trips`
--     UPDATE ("column-level distinctions that row-level RLS can't express
--     without a trigger"), and migration 094 recorded the same residual for
--     captains as an accepted one. It is not accepted here, because the column
--     at stake is the trust boundary itself.
--
--     The fix is a BEFORE INSERT OR UPDATE trigger on trip_members that refuses
--     a role change (and the creation of an 'Owner' row) from anyone who is not
--     that trip's Owner, after which the policies can be widened safely. That
--     trigger sits on the signup/merge write path (handle_new_user ->
--     merge_guest_to_real_user repoints trip_members rows), so it is its own
--     migration with its own verification, not a rider on this one.
--
-- (b) link_guest_to_account() — backing ghostCrew.update's auto-link branch.
--
--     A FOURTH gate, found the same way as assert_game_owner: a hardcoded
--     `has_trip_role(p_trip_id, ARRAY['Owner'])` inside a plpgsql body
--     (migration 095), invisible to a policy sweep. It is the guarded wrapper
--     around merge_guest_to_real_user, whose core is revoked from `authenticated`
--     because it would otherwise be an account-takeover primitive.
--
--     Widening it is a change to the guest->real-user merge path, which runs
--     inside the signup trigger. That is out of scope by rule, so
--     ghostCrew.update stays Owner-only rather than being widened at tRPC and
--     then failing at the database the moment an Organizer pastes an email that
--     matches an existing account — a partial widening whose failure mode is
--     precisely the confusing cross-layer FORBIDDEN #786 was filed to avoid.
