"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useTripRole } from "./useTripRole";
import { useCurrentUser } from "./useCurrentUser";

/**
 * Pure predicate: is `userId` the captain of `teamId`, given the competition's
 * team_assignments? Shared by `useCanEditTeam` (single-team) AND multi-team
 * consumers (TeamsPanel maps over every team — React forbids calling the hook
 * per row, so the loop uses this predicate against the assignments it already
 * holds). One captain-resolution, no per-surface drift.
 */
export function isTeamCaptain(
  assignments:
    | { user_id: string; team_id: string; is_captain?: boolean }[]
    | undefined,
  userId: string | null | undefined,
  teamId: string | null | undefined
): boolean {
  return (
    !!userId &&
    !!teamId &&
    (assignments ?? []).some(
      (a) => a.user_id === userId && a.team_id === teamId && !!a.is_captain
    )
  );
}

/**
 * Client mirror of the server's team rules for ONE team, after PR 8's
 * permissions pass (migrations 199 / 200):
 *
 *  - IDENTITY (name / short / color) and roster ORDER: trip Owner or Organizer,
 *    or the captain of THIS team (`requireTeamIdentityEdit`, which admits
 *    Organizer since 199 — whoever can delete a team can rename it).
 *  - MEMBERSHIP (add / remove / move): Owner or Organizer (`canManageRoster`),
 *    plus the captain's narrower pre-results add/remove, which is decided per
 *    row by `rosterRights` (src/lib/rosterRights.ts), not by a flag here.
 *  - CAPTAINCY (`setCaptain`): Owner or Organizer since 200 — you can hand out
 *    powers you already hold.
 *
 * `useTripRole` only knows the TRIP role, so on its own it is blind to a
 * captain-who-is-a-plain-Member; this ORs in the per-team captain grant exactly
 * as the server admits.
 *
 * Consolidates the formerly-inlined captain checks (TeamsPanel, CompetitionFace)
 * — both route through `isTeamCaptain`.
 */
export function useCanEditTeam(
  tripId: string | undefined,
  competitionId: string | undefined,
  teamId: string | null | undefined
) {
  const { canEdit: tripCanEdit, loading } = useTripRole(tripId);
  const me = useCurrentUser();
  const assignQ = trpc.teamAssignments.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );
  const amCaptain = useMemo(
    () =>
      isTeamCaptain(
        assignQ.data as
          | { user_id: string; team_id: string; is_captain?: boolean }[]
          | undefined,
        me?.id,
        teamId
      ),
    [assignQ.data, me, teamId]
  );

  return {
    /** Owner or Organizer (any team) OR this team's captain — mirrors
     *  `requireTeamIdentityEdit` (Organizer since 199). Gates IDENTITY and ORDER. */
    canEdit: tripCanEdit || amCaptain,
    /** Owner or Organizer — appointing the captain (`setCaptain`, mig 200). */
    canAppointCaptain: tripCanEdit,
    /** Owner or Organizer — roster MEMBERSHIP (add / remove / move). A captain's
     *  narrower membership rights are per-row: see `rosterRights`. */
    canManageRoster: tripCanEdit,
    amCaptain,
    /** The viewer — a captain may not remove themselves (`rosterRights`). */
    viewerId: me?.id ?? null,
    loading,
  };
}
