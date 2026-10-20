"use client";

import { createContext, useContext, useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useTripId } from "@/components/TripIdProvider";
import { teamBadgeLabels } from "@/lib/teamInitial";

/**
 * THE TRIP'S TEAM BADGE LABELS — one letter per team, or two where two teams in
 * the competition would share one (Zach, 2026-10-20).
 *
 * The rule needs every team at once: a badge on its own cannot know that
 * "Bravo" and "Blue" both start with B. A trip holds ONE competition (migration
 * 195), so this provider, mounted once for the trip, computes the labels from
 * that competition's teams and every `TeamBadge` below reads its own. Labels are
 * looked up by team id, or by name where a site has no id to hand (a scramble's
 * rows are keyed by group, the team chat header by name).
 *
 * Outside a trip, or before the teams load, there is nothing to read and a badge
 * falls back to its plain initial.
 */

interface Labels {
  byId: Map<string, string>;
  byName: Map<string, string>;
}

const EMPTY: Labels = { byId: new Map(), byName: new Map() };
const TeamBadgeLabelsContext = createContext<Labels>(EMPTY);

export function TripTeamBadgeLabels({ children }: { children: React.ReactNode }) {
  const { tripId } = useTripId();
  const compQ = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competitionId = (compQ.data as { id?: string } | null | undefined)?.id;
  const teamsQ = trpc.teams.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );
  const value = useMemo<Labels>(() => {
    const teams = ((teamsQ.data ?? []) as { id: string; name: string; short_name?: string | null }[]).map((t) => ({
      id: t.id,
      name: t.name,
      shortName: t.short_name ?? null,
    }));
    if (teams.length === 0) return EMPTY;
    const byId = teamBadgeLabels(teams);
    const byName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), byId.get(t.id)!]));
    return { byId, byName };
  }, [teamsQ.data]);
  return <TeamBadgeLabelsContext.Provider value={value}>{children}</TeamBadgeLabelsContext.Provider>;
}

/** This team's label in the trip's competition, if the trip has one. */
export function useTeamBadgeLabel(teamId: string | undefined, name: string): string | undefined {
  const { byId, byName } = useContext(TeamBadgeLabelsContext);
  return (teamId ? byId.get(teamId) : undefined) ?? byName.get(name.trim().toLowerCase());
}

/** For tests and static renders: supply labels without a trip. */
export function TeamBadgeLabelsForTest({ teams, children }: { teams: { id: string; name: string; shortName?: string | null }[]; children: React.ReactNode }) {
  const byId = teamBadgeLabels(teams);
  const byName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), byId.get(t.id)!]));
  return <TeamBadgeLabelsContext.Provider value={{ byId, byName }}>{children}</TeamBadgeLabelsContext.Provider>;
}
