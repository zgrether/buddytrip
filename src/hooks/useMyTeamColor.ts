"use client";

import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";

/**
 * useMyTeamColor — the viewer's team colour for a trip, or null.
 *
 * Drives the account avatar in the app bar: once the trip has a competition and
 * the viewer is assigned to a team, the avatar reads in that team's colour
 * instead of the default teal. Null for everything else — no trip selected, no
 * competition, or on no team — and the avatar falls back to teal.
 *
 * ── It follows the TRIP, not the tab ─────────────────────────────────────────
 * The colour shows on EVERY tab (Home · Trip · Cup · Chat) while a valid trip is
 * current, not only on the competition surface. The avatar is the user's
 * identity in this trip's context, and that context does not stop applying
 * because they tapped Chat.
 *
 * This is why the prop's original doc ("Undefined off competition pages") no
 * longer describes the design: it was written when the competition face owned
 * its own route and its own `TopNav`. The four-tab shell replaced that with one
 * shared bar spanning all four surfaces — which is also how the feature was lost
 * (the only call site that ever set the colour was the standalone face's bar,
 * removed as dead code once nothing rendered it).
 *
 * STRUCTURE_QUERY: a roster assignment and a team colour change rarely and never
 * on their own, so this is cached indefinitely and refreshed by explicit
 * invalidation from the mutations that change either (see `TeamsPanel`).
 */
export function useMyTeamColor(tripId: string | null | undefined): string | null {
  const { data } = trpc.competitions.myTeamColor.useQuery(
    { tripId: tripId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId },
  );
  return data?.color ?? null;
}

/**
 * The viewer's TEAM ID for a trip, or null (no competition, or not on a team).
 *
 * Same query, same cache entry, same `STRUCTURE_QUERY` policy as
 * `useMyTeamColor` — React Query dedupes them to one request, so reading the id
 * costs nothing extra. `myTeamColor` has always returned `teamId`; only the
 * colour was being exposed.
 *
 * Used by the clinch celebration to answer "did the person looking at this
 * screen actually win?" — which decides whether the spark burst fires and
 * whether the re-fire button exists.
 */
export function useMyTeamId(tripId: string | null | undefined): string | null {
  const { data } = trpc.competitions.myTeamColor.useQuery(
    { tripId: tripId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId },
  );
  return data?.teamId ?? null;
}
