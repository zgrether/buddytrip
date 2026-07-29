"use client";

import { createContext, useContext, useMemo } from "react";
import { useParams } from "next/navigation";

/**
 * TripIdProvider / useTripId — the ONE place the `/trips/[tripId]` URL param is
 * read.
 *
 * ── Trip identity in a URL is the trip id; there is no second form ──────────
 * `/trips/{id}` is the only shape the app produces. There is nothing to
 * resolve: the param IS the id that tRPC inputs, realtime channel names and
 * React Query cache keys already use. (New ids are `crypto.randomUUID()`, but
 * `trips.id` is `text` — do not assume the shape; see `resolveTripIdValue`.)
 * The param is still funnelled through this one provider — see the next
 * paragraph for why that matters independently of resolution.
 *
 * This used to accept a slug as well and resolve it here. Slugs are gone (see
 * CLAUDE.md #21): the generator, the `slug ?? id` navigation fallbacks, the
 * `trips.resolveSlug` procedure and finally the `trips.slug` column itself
 * (migration 097) have all been removed, and the drop is applied to production.
 * Nothing writes or reads a second identifier form anywhere in the stack, so
 * this provider resolves nothing — there is nothing left to resolve.
 *
 * ── Why the provider survives the resolution it used to wrap ────────────────
 * Reading the param in one place is worth more than the resolving was. It used
 * to be a convention that every consumer resolved the param itself, and the
 * convention broke: six components had each copied the same resolve block, and
 * a seventh — `LiveFaceClient`, root of the whole Cup subtree — skipped it and
 * handed the raw param to `competitions.faceBootstrap`. That was invisible for
 * as long as it was, because which form the URL carried depended on the door
 * you came through, so Cup worked on app load and broke on the next trip
 * picked from a list.
 *
 * Removing slugs kills that specific bug, but not the shape of it — a param
 * read in twelve places is still twelve places to get something wrong the next
 * time this route's shape changes (Phase 7 will change it). So: consume
 * `useTripId()`, and do NOT reach for `useParams().tripId` in trip-scoped code.
 * A source guard in `TripIdProvider.test.ts` fails the build if you do, and a
 * second guard asserts no call site builds a trip URL from anything but `.id`.
 */

export interface TripIdValue {
  /** The trip id from the URL. `undefined` only before routing settles. */
  tripId: string | undefined;
  /**
   * The same value, under the name URL-building call sites use. Identical to
   * `tripId` — kept as a distinct name so those call sites keep reading as
   * "this is the URL layer", not "this is an id I may pass to a procedure".
   */
  rawParam: string;
}

const TripIdContext = createContext<TripIdValue | null>(null);

/**
 * The param → id mapping, as a pure function so it stays directly testable.
 * Now an identity; kept as a seam because the URL shape is about to change
 * again (Phase 7 moves context into a search param), and a named function is
 * a cheaper place to make that change than a dozen call sites.
 *
 * **Deliberately does NOT validate the shape.** `trips.id` is `text`, not
 * `uuid` (CLAUDE.md, ID Type Convention) — ids are conventionally UUIDs but
 * nothing enforces it, and the E2E suite seeds `e2e-trip-<ts>-<rand>`. An
 * earlier draft of this gated on a UUID regex and broke every one of those
 * trips, which is exactly the kind of "tightened a type the schema never
 * promised" mistake the text-id convention exists to warn about.
 *
 * Whether the id names a trip you can see is the SERVER's answer, not a
 * regex's: `requireTripMember` throws FORBIDDEN and `trips.getById` errors,
 * and the trip page already bounces to /dashboard on that (its stale-pointer
 * recovery). That path also covers revoked membership and deleted trips —
 * cases no client-side shape check could ever catch.
 */
export function resolveTripIdValue({ rawParam }: { rawParam: string }): TripIdValue {
  return { tripId: rawParam || undefined, rawParam };
}

export function TripIdProvider({ children }: { children: React.ReactNode }) {
  const params = useParams<{ tripId?: string }>();
  const rawParam = params?.tripId ?? "";

  const value = useMemo<TripIdValue>(() => resolveTripIdValue({ rawParam }), [rawParam]);

  return <TripIdContext.Provider value={value}>{children}</TripIdContext.Provider>;
}

/**
 * The trip id for the current route.
 *
 * Throws outside the provider ON PURPOSE: the provider is mounted in
 * `/trips/[tripId]/layout.tsx`, so every trip-scoped surface has it, and a
 * component that can't reach it has no business reading a trip id from the
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
