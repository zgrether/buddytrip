"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import type { FaceBootstrap } from "@/components/competition/LiveFaceClient";

/**
 * Seeds the server-resolved `competitions.faceBootstrap` into the client cache.
 *
 * ── Why this exists instead of just relying on HydrationBoundary ─────────────
 * The trip layout prefetches on the server and dehydrates, and the payload is
 * demonstrably correct — the streamed HTML carries the entry with
 * `status:"success"` under exactly the key the client uses
 * (`[["competitions","faceBootstrap"],{"input":{"tripId":…},"type":"query"}]`).
 * The client refetches it anyway.
 *
 * That is NOT specific to this query: `competitions.getByTrip` has been
 * prefetched in that layout for far longer and shows the same symptom — measured
 * firing on the client in the first batch despite being dehydrated. So the
 * layout's HydrationBoundary has never actually saved a round trip, which is a
 * pre-existing gap this phase happened to surface rather than cause. Worth
 * chasing separately; not worth blocking the seed on.
 *
 * The mechanism that IS known to work is the one the old `/leaderboard` route
 * used before Phase 3 retired it: hand the resolved bootstrap down explicitly.
 * `setData` during render is synchronous and lands before any child mounts and
 * fires its own query — the same pattern (and the same reasoning about render
 * vs effect ordering) that `LiveFaceClient` already uses to seed ITS children.
 *
 * Renders nothing.
 */
export function FaceBootSeed({ tripId, boot }: { tripId: string; boot: FaceBootstrap | null }) {
  const utils = trpc.useUtils();

  // During render, not in an effect: a child's mount-effect runs BEFORE the
  // parent's, so an effect here would seed after the child had already fetched.
  useMemo(() => {
    if (!boot) return;
    utils.competitions.faceBootstrap.setData({ tripId }, boot);
  }, [boot, tripId, utils]);

  return null;
}
