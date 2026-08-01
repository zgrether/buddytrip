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
 * Client mirror of the server's team-IDENTITY admission (`requireTeamIdentityEdit`,
 * migration 065): editing a team's name / short name / color is granted to the trip
 * **Owner** OR the **captain of THIS team** (an `is_captain` row on
 * team_assignments). `useTripRole` only knows the TRIP role, so on its own it's
 * blind to a captain-who-is-a-plain-Member — this ORs in the per-team captain grant,
 * exactly as the server admits (mirrors the `useGameEditAccess`/`canEditGame` shape,
 * with `is_captain` swapped in for the `game_delegates` row).
 *
 * IDENTITY ONLY. Roster/structure is gated separately, and as of #789 it is no
 * longer one thing: **membership** (add / remove) is `canManageRoster`
 * (Owner-or-Organizer, matching the server — `assign` has always been
 * Organizer-gated and `remove` moved in #788), **order** is `canReorder`
 * (Owner-or-this-team's-captain, mig 094), and **captaincy** (`setCaptain`) stays
 * `isOwner`. The captain's-draft feature keeps its substance: a captain still
 * cannot add, remove, or name a captain.
 *
 * Consolidates the two formerly-inlined captain checks (TeamsPanel `canEditIdentity`,
 * CompetitionFace `canEditTeamIdentity`) — both now route through `isTeamCaptain`.
 */
export function useCanEditTeam(
  tripId: string | undefined,
  competitionId: string | undefined,
  teamId: string | null | undefined
) {
  const { isOwner, canEdit: tripCanEdit, loading } = useTripRole(tripId);
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
    /** Owner (any team) OR this team's captain — mirrors `requireTeamIdentityEdit`. Gates IDENTITY only. */
    canEdit: isOwner || amCaptain,
    /** Trip Owner only. Now gates ONE roster power: appointing the captain
     *  (`setCaptain`), which is still Owner-only at the server — a captain holds
     *  real RLS grants (migrations 065 / 094), so naming one is "changing who is
     *  trusted" a level down. Do NOT reuse this for add/remove; see
     *  `canManageRoster`. */
    isOwner,
    /** Trip Owner or Organizer — MEMBERSHIP: add (`assign`, Organizer-gated at the
     *  server since it shipped) and remove (`teamAssignments.remove`, moved in
     *  #788). Split from `isOwner` in #789: one flag was guarding both membership
     *  and captaincy, and the server's answer for those differs. Not a new
     *  predicate — this is `useTripRole().canEdit`. */
    canManageRoster: tripCanEdit,
    amCaptain,
    loading,
  };
}
