"use client";

import { createContext, useContext, useMemo } from "react";
import { useParams } from "next/navigation";

/**
 * TripIdProvider / useTripId — the ONE place the `/trips/[tripId]` URL param is
 * read.
 *
 * ── Trip identity in a URL is the UUID; there is no second form ─────────────
 * `/trips/{uuid}` is the only shape the app produces. There is nothing to
 * resolve: the param IS the canonical id, and everything below the URL (tRPC
 * inputs, realtime channel names, React Query cache keys) has always been
 * UUID-only. The param is still funnelled through this one provider — see the
 * next paragraph for why that matters independently of resolution.
 *
 * This used to accept a slug as well and resolve it here. Slugs were removed
 * (see CLAUDE.md #21): the generator, the `slug ?? id` navigation fallbacks and
 * the `trips.resolveSlug` procedure are all gone, so what remains is a param
 * that is already the id. `trips.slug` itself is dropped in a follow-up PR,
 * after this code is deployed — a DROP inverts the usual migration ordering
 * (CLAUDE.md Migration Workflow 3b).
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TripIdValue {
  /** The canonical trip UUID, or `undefined` if the param isn't one. */
  tripId: string | undefined;
  /** The raw URL param, for building URLs. Identical to `tripId` for any URL
   *  the app produces; they differ only for a malformed/legacy param. */
  rawParam: string;
  /**
   * Always false. Kept so consumers written against the resolving era keep
   * compiling and reading correctly — there is no asynchronous step any more,
   * so the id is known on the first render or it is never known.
   */
  isResolving: boolean;
  /** The param is not a trip UUID — a malformed link, or a legacy slug URL
   *  someone copied out of the address bar before slugs were removed. Routes
   *  bounce to /dashboard on this. */
  isError: boolean;
}

const TripIdContext = createContext<TripIdValue | null>(null);

/**
 * The param → id decision, as a pure function so it stays directly testable.
 * Now trivial; kept as a seam because the URL shape is about to change again
 * (Phase 7 moves context into a search param), and a named function is a
 * cheaper place to make that change than twelve call sites.
 */
export function resolveTripIdValue({ rawParam }: { rawParam: string }): TripIdValue {
  const isId = UUID_RE.test(rawParam);
  return {
    tripId: isId ? rawParam : undefined,
    rawParam,
    isResolving: false,
    isError: !!rawParam && !isId,
  };
}

export function TripIdProvider({ children }: { children: React.ReactNode }) {
  const params = useParams<{ tripId?: string }>();
  const rawParam = params?.tripId ?? "";

  const value = useMemo<TripIdValue>(() => resolveTripIdValue({ rawParam }), [rawParam]);

  return <TripIdContext.Provider value={value}>{children}</TripIdContext.Provider>;
}

/**
 * The canonical trip UUID for the current route.
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
