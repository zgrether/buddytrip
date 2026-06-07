-- 030 — tighten RLS to match the tRPC permission intent (defense-in-depth)
--
-- The 2026-06-07 RLS parity audit found a handful of write-policies that were
-- LOOSER than the tRPC gates (they allowed Organizers where tRPC reserves the
-- action to the Owner). No active hole — all writes go through tRPC — but RLS
-- should mirror the API so it's a real backstop. This pulls those to Owner-only.
--
-- NOT changed: `trips` UPDATE stays Owner+Organizer. Organizers legitimately
-- update most trip columns (rename, about message, dates, change destination);
-- only lockDestination / transferOwnership are Owner-only, and those are
-- *column-level* distinctions that row-level RLS can't express without a
-- trigger. tRPC enforces them. Idempotent.

-- 1. trip_members — roster writes are Owner-only (members may still write their
--    OWN row: join, travel, status). Drop 'Organizer' from the non-self arm.
DROP POLICY IF EXISTS trip_members_insert ON public.trip_members;
CREATE POLICY trip_members_insert ON public.trip_members
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = (auth.uid())::text) OR has_trip_role(trip_id, ARRAY['Owner'::text]));

DROP POLICY IF EXISTS trip_members_update ON public.trip_members;
CREATE POLICY trip_members_update ON public.trip_members
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = (auth.uid())::text) OR has_trip_role(trip_id, ARRAY['Owner'::text]));

-- 2. invites — creating an invite is Owner-only (tRPC inviteByEmail /
--    sendInvitationBlast). Also renames the now-inaccurate policy
--    ("planners and owners …") to reflect Owner-only.
DROP POLICY IF EXISTS "planners and owners can create invites" ON public.invites;
DROP POLICY IF EXISTS "owners can create invites" ON public.invites;
CREATE POLICY "owners can create invites" ON public.invites
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (has_trip_role(trip_id, ARRAY['Owner'::text]));

-- 3. date_poll_votes — voting on behalf of someone else is Owner-only
--    (tRPC castVoteForMember). The "_ghost" policies (vote for a guest crew
--    row) allowed Organizers; pull to Owner. Self-vote + the existing
--    "_owner_any" policies are unchanged.
DROP POLICY IF EXISTS date_poll_votes_insert_ghost ON public.date_poll_votes;
CREATE POLICY date_poll_votes_insert_ghost ON public.date_poll_votes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (EXISTS (SELECT 1 FROM public.users u
       WHERE u.id = date_poll_votes.user_id AND u.is_guest = true))
    AND (EXISTS (SELECT 1 FROM public.date_windows dw
       WHERE dw.id = date_poll_votes.window_id
         AND has_trip_role(dw.trip_id, ARRAY['Owner'::text])))
  );

DROP POLICY IF EXISTS date_poll_votes_update_ghost ON public.date_poll_votes;
CREATE POLICY date_poll_votes_update_ghost ON public.date_poll_votes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM public.users u
       WHERE u.id = date_poll_votes.user_id AND u.is_guest = true))
    AND (EXISTS (SELECT 1 FROM public.date_windows dw
       WHERE dw.id = date_poll_votes.window_id
         AND has_trip_role(dw.trip_id, ARRAY['Owner'::text])))
  );
