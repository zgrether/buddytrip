"use client";

import { createContext, useContext, useMemo } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";

/**
 * TripIdProvider / useTripId — the ONE place the `/trips/[tripId]` URL param is
 * turned into the canonical trip UUID.
 *
 * ── The canonical form, stated once (the thing whose absence caused the bug) ──
 * The URL layer accepts BOTH a human-friendly slug (`bbmi-2027-a3f9c1`) and a
 * raw trip UUID — old links must keep working and the slug is a display nicety.
 * **Everything below the URL is UUID-only**: tRPC inputs, realtime channel
 * names, and every React Query cache key. The param is resolved to the UUID
 * exactly ONCE, here, at the route boundary; no component downstream re-derives
 * it.
 *
 * ── Why this exists rather than each consumer calling useParams() ────────────
 * It used to be a convention, and the convention broke. Six components had each
 * copied the same `UUID_RE.test(param) ? param : resolveSlug(param)` block, and
 * a seventh — `LiveFaceClient`, the root of the whole Cup subtree — simply read
 * `useParams().tripId` and handed the raw value to `competitions.faceBootstrap`.
 * A slug never matches `trip_members.trip_id`, so the server threw FORBIDDEN and
 * the Cup tab rendered "no competition yet".
 *
 * That stayed invisible because which form the URL carries depends on the door
 * you came through: the root route redirects to `/trips/<uuid>` (the
 * `bt-last-trip-id` cookie stores the resolved id), while every trip LIST
 * navigates to `/trips/<slug>` (`TripCard`, `ContextRail` both use
 * `slug ?? id`). So Cup worked on app load and broke the moment you picked a
 * trip from a list — and "worked again after a reload" because a reload goes
 * through the root route's UUID redirect.
 *
 * Pre-refactor this could not happen: the face lived at its own
 * `/trips/[tripId]/leaderboard` route, linked from inside the trip page using
 * the already-resolved UUID. Making the competition a TAB on `/trips/[param]`
 * is what exposed it to the raw param.
 *
 * So: consume `useTripId()`. Do NOT reach for `useParams().tripId` to feed a
 * procedure, a channel name, or a cache key — that is the path this provider
 * exists to close. (Using the raw param to BUILD A URL is fine and correct;
 * that's the display layer, and `rawParam` is exposed for it.)
 */

// Inlined rather than imported from @/lib/slug, which pulls in node crypto and
// would break the client bundle.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TripIdValue {
  /** The canonical trip UUID. `undefined` while a slug is still resolving. */
  tripId: string | undefined;
  /** The raw URL param — slug or uuid. For building URLs ONLY, never for a
   *  procedure input, channel name, or cache key. */
  rawParam: string;
  /** A slug lookup is in flight; `tripId` is not known yet. */
  isResolving: boolean;
  /** The param matched no trip the user can see (deleted / revoked / typo). */
  isError: boolean;
}

const TripIdContext = createContext<TripIdValue | null>(null);

/**
 * The whole resolution decision, as a pure function so it can be tested
 * directly — in particular the `initialParam === rawParam` guard, which is the
 * thing standing between a trip switch and cross-trip bleed.
 */
export function resolveTripIdValue({
  rawParam,
  initialParam,
  initialTripId,
  resolvedId,
  resolveErrored,
}: {
  rawParam: string;
  initialParam: string | null;
  initialTripId: string | null;
  resolvedId: string | undefined;
  resolveErrored: boolean;
}): TripIdValue {
  const isId = UUID_RE.test(rawParam);
  // Trust the server-resolved id ONLY for the exact param it was resolved for.
  // This component is reused across a client-side trip switch, and
  // `useParams()` and the RSC payload need not update in the same commit — so
  // without this check trip A's resolved id could be read under trip B's param
  // for a render, which is precisely the cross-trip bleed this fix exists to
  // prevent. Checked, not assumed.
  const seeded = initialParam === rawParam && !isId ? initialTripId : null;

  return {
    tripId: isId ? rawParam : (seeded ?? resolvedId),
    rawParam,
    isResolving: !isId && !seeded && !resolvedId && !resolveErrored,
    isError: !isId && !seeded && resolveErrored,
  };
}

export function TripIdProvider({
  children,
  /**
   * The id the LAYOUT already resolved on the server for this same param.
   * Passing it down means a slug URL has its canonical id on the very first
   * client render — no undefined window, no client round trip, and no flash of
   * a "still resolving" state on any server-rendered navigation. The client
   * query below is the fallback for when that server resolve was skipped
   * (unauthed / early), not the normal path.
   */
  initialTripId = null,
  /** The param `initialTripId` was resolved FOR — see `seeded` below. */
  initialParam = null,
}: {
  children: React.ReactNode;
  initialTripId?: string | null;
  initialParam?: string | null;
}) {
  const params = useParams<{ tripId?: string }>();
  const rawParam = params?.tripId ?? "";
  const isId = UUID_RE.test(rawParam);
  const seeded = initialParam === rawParam && !isId ? initialTripId : null;

  // A UUID param skips the lookup entirely, as does a server-seeded id.
  // STRUCTURE_QUERY: a slug→id mapping is immutable for the life of the trip,
  // so this is fetched once and kept — never a per-navigation round trip.
  const resolved = trpc.trips.resolveSlug.useQuery(
    { slugOrId: rawParam },
    { ...STRUCTURE_QUERY, enabled: !!rawParam && !isId && !seeded, retry: false },
  );

  const value = useMemo<TripIdValue>(
    () =>
      resolveTripIdValue({
        rawParam,
        initialParam,
        initialTripId,
        resolvedId: resolved.data?.id,
        resolveErrored: resolved.isError,
      }),
    [rawParam, initialParam, initialTripId, resolved.data, resolved.isError],
  );

  return <TripIdContext.Provider value={value}>{children}</TripIdContext.Provider>;
}

/**
 * The canonical trip UUID for the current route.
 *
 * Throws outside the provider ON PURPOSE: the provider is mounted in
 * `/trips/[tripId]/layout.tsx`, so every trip-scoped surface has it, and a
 * component that can't reach it has no business resolving a trip id from the
 * URL on its own.
 */
export function useTripId(): TripIdValue {
  const ctx = useContext(TripIdContext);
  if (!ctx) {
    throw new Error(
      "useTripId must be used within TripIdProvider (mounted in /trips/[tripId]/layout.tsx)",
    );
  }
  return ctx;
}
