-- 103 · invites_insert — an Organizer may invite a Member, not an Organizer.
--
-- Narrows migration 101 §1, which widened `invites_insert` from Owner-only to
-- `is_trip_planner` (Owner OR Organizer). That widening was right about the act
-- and wrong about one fact, so this keeps the act and fixes the fact.
--
-- ── What 101 said, and why it doesn't hold ──────────────────────────────────
-- 101 §1 reasoned:
--
--   "Inviting crew is running the trip; it does not change who is TRUSTED (an
--    invite carries role 'Organizer' or 'Member' per the invites_role CHECK,
--    and accepting one creates a trip_members row through the signup path, not
--    through this policy)."
--
-- The first half stands: inviting is an Organizer act. The parenthetical does
-- not. `handle_new_user()` — the signup trigger — creates the `users` row and
-- sets `invites.accepted_at`. It NEVER writes `trip_members`. On the invite-link
-- path the membership row is written by the INVITEE'S OWN CLIENT
-- (`src/app/invite/page.tsx`), as:
--
--     insert into trip_members (trip_id, user_id, role, status)
--     values (invite.trip_id, session.user.id, invite.role, 'in')
--
-- which satisfies `trip_members_insert` through its self-insert arm
-- (`user_id = auth.uid()::text`) — an arm with NO role predicate. So
-- `invites.role` does reach `trip_members`, and this policy is the gate on it.
--
-- The full chain that was reachable:
--   1. an Organizer inserts an `invites` row with role 'Organizer' (this policy
--      permitted it — direct PostgREST, no tRPC involved);
--   2. the invitee opens the link and self-inserts that role;
--   3. an Organizer has minted an Organizer.
--
-- That is exception 1 — "only the Owner changes who is trusted" — routed
-- around, and it is the same hazard that caused #790 to revert the tRPC guards
-- on `inviteByEmail` / `sendInvitationBlast`. It was masked before 101 because
-- the policy was Owner-only; 101 removed the accident without replacing it.
--
-- ── The rule this encodes ───────────────────────────────────────────────────
-- An Organizer may invite a MEMBER. Only the Owner may invite an ORGANIZER.
-- The invite isn't the trusted act — the ROLE BEING GRANTED is. So the policy
-- reads the row's `role`, not just the caller's.
--
-- Deliberately NOT touching `trip_members_insert` or the role-column trigger:
-- that cluster sits on the signup write path and is its own, larger change.
-- The mint ORIGINATES here, so this is where it is refused.
--
-- Idempotent; replayable from zero (DROP IF EXISTS + CREATE, no
-- environment-specific ids).

DROP POLICY IF EXISTS invites_insert ON public.invites;
CREATE POLICY invites_insert ON public.invites
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    is_trip_planner(trip_id)
    AND (
      role = 'Member'
      OR has_trip_role(trip_id, ARRAY['Owner'::text])
    )
  );

COMMENT ON POLICY invites_insert ON public.invites IS
  'Owner or Organizer may create an invite; only the Owner may create one carrying role Organizer. The invitee''s client copies invites.role into trip_members via the self-insert arm of trip_members_insert, so this policy is the gate on who can be granted Organizer (see migration 103).';
