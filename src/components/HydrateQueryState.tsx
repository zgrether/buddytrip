"use client";

import { useMemo } from "react";
import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * Deserialize a tRPC server-helpers payload and hand it to TanStack's
 * `HydrationBoundary`. This is the fix for #730 — the reason the trip layout's
 * prefetches were decorative for their entire existence.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 * `createServerSideHelpers().dehydrate()` does NOT return a `DehydratedState`,
 * despite being typed as one. Its last line is:
 *
 *     const after = resolvedOpts.serialize(before);   // superjson.serialize(state)
 *     return after;
 *
 * — so it returns the superjson ENVELOPE, `{ json, meta }`. Feeding that
 * straight to `<HydrationBoundary state={...}>` means TanStack reads
 * `state.queries`, finds `undefined`, iterates nothing, and returns. **No error,
 * no warning, no data.** Every prefetch in that layout was silently discarded,
 * and the client fetched everything anyway.
 *
 * `tsc` could not catch it: tRPC declares the return type as `DehydratedState`,
 * so the annotation at the call site type-checked against a lie. (CLAUDE.md now
 * carries the general form of this lesson.)
 *
 * ── Why a client component rather than deserializing in the layout ───────────
 * `superjson.deserialize(helpers.dehydrate())` in the Server Component would
 * also work — but the restored object would then cross the RSC boundary as a
 * prop, so React's Flight serializer, not superjson, decides what survives.
 * For this app's data that is probably fine (Supabase returns timestamps as
 * strings, not `Date`s), and "probably fine" is exactly the reasoning that
 * produced the bug above: something that looked correct and was quietly wrong.
 * A value that didn't survive Flight would arrive as silently WRONG DATA rather
 * than a crash — the worst failure shape available here.
 *
 * So the envelope crosses the boundary intact, as the opaque string-ish blob it
 * already is, and superjson deserializes what superjson serialized. The RSC
 * boundary stays out of the middle of that round trip.
 *
 * ── Do NOT also set `hydrate.deserializeData` on the client QueryClient ──────
 * tRPC's RSC helper (`@trpc/react-query/rsc`) documents `dehydrate.serializeData`
 * / `hydrate.deserializeData` as required — but that is for a DIFFERENT
 * transport, where each query's data is serialized individually and the state
 * itself is plain. `createServerSideHelpers` is the other shape: its internal
 * QueryClient is a bare `new QueryClient(config.queryClientConfig)` with no
 * `serializeData`, so the per-query data stays plain and the WHOLE state is
 * serialized once at the end.
 *
 * The two are alternatives, not complements. Setting `deserializeData` as well
 * would run superjson over each query's ALREADY-plain data — a second
 * deserialize of something never serialized. `hydrationTransport.test.ts` pins
 * both halves so this can't be "completed" into a breakage later.
 */
export function HydrateQueryState({
  /** The raw return of `createServerSideHelpers().dehydrate()` — a superjson
   *  envelope, whatever its declared type says. `unknown` on purpose: the
   *  honest type is what makes the deserialize below obviously necessary. */
  state,
  children,
}: {
  state: unknown;
  children: React.ReactNode;
}) {
  const hydrated = useMemo(() => {
    if (state === undefined || state === null) return undefined;
    return superjson.deserialize(state as never) as DehydratedState;
  }, [state]);

  return <HydrationBoundary state={hydrated}>{children}</HydrationBoundary>;
}
