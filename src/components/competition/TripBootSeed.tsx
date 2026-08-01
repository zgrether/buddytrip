"use client";

import { useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc-client";
import type { AppRouter } from "@/server/router";
import type { FaceBootstrap } from "@/components/competition/LiveFaceClient";

type TripMemberRow = inferRouterOutputs<AppRouter>["tripMembers"]["list"][number];

/**
 * Seeds the trip layout's server-resolved queries into the client cache.
 *
 * Was `FaceBootSeed`, which seeded only `competitions.faceBootstrap`. It now
 * seeds `tripMembers.list` as well, so the name was renamed rather than left
 * describing half the job.
 *
 * ── Why this existed instead of relying on HydrationBoundary — NOW FIXED ─────
 * ⚠️ **This component is a workaround for a bug that has been fixed (#730), and
 * is retained deliberately rather than because it is still needed.**
 *
 * The observation that produced it was exact and is worth keeping: the streamed
 * HTML carried the entry with `status:"success"` under precisely the key the
 * client uses, and the client refetched anyway — for `faceBootstrap`,
 * `competitions.getByTrip` and `tripMembers.list` alike, i.e. every prefetch in
 * that layout was decorative.
 *
 * The cause was NOT a key mismatch, a stale `dataUpdatedAt`, a duplicate
 * QueryClient or boundary placement. `createServerSideHelpers().dehydrate()`
 * returns a superjson ENVELOPE while being TYPED as a `DehydratedState`, so
 * `HydrationBoundary` read `state.queries`, found `undefined`, and hydrated
 * nothing — silently, and invisibly to `tsc`. `HydrateQueryState` deserializes
 * it first; `hydrationTransport.test.ts` pins the contract.
 *
 * **Retirement is a separate, revertable change.** The boundary is proven by
 * test but not yet by a cold open, and two mechanisms briefly overlapping is
 * safe where neither working is not. `setData` during render is idempotent
 * against an already-hydrated cache — it writes the same server value under the
 * same key — so the overlap cannot corrupt anything; it is redundant, not
 * harmful. Remove this once a cold open confirms the hydrated queries do not
 * fire.
 *
 * The mechanism it uses is the one the old `/leaderboard` route used before
 * Phase 3 retired it: hand the resolved value down explicitly. `setData` during
 * render is synchronous and lands before any child mounts and fires its own
 * query — the same pattern (and the same reasoning about render vs effect
 * ordering) that `LiveFaceClient` already uses to seed ITS children.
 *
 * ── Why `tripMembers.list` is here ──────────────────────────────────────────
 * It is what `useTripRole` reads, and a pending role is indistinguishable from a
 * member role: `role` is `null` in flight, so `isOwner` is `false`, and
 * `ItineraryPanel`'s `if (!isOwner)` took the MEMBER path and painted "Your
 * timeline will start to fill in" over the owner's trip until the query landed.
 *
 * Seeding it is a CLASS fix, not an instance fix. Every consumer that reads
 * `role` directly gets a resolved value on its first render without being
 * touched: `ItineraryPanel` (via the page), `ChatView`'s `canSeePlanning`, and
 * `FloatingChatPanel`'s `canSeeOrganizers`. The two chat surfaces are fixed BY
 * CONSEQUENCE here — that is why they look correct despite no edit of their own.
 *
 * It does NOT make `useTripRole`'s own loading branch redundant: the layout
 * swallows auth/membership failures by design, so `members` can arrive null and
 * the client still fetches. `ItineraryPanel` keeps its `roleLoading` branch for
 * exactly that path.
 *
 * Renders nothing.
 */
export function TripBootSeed({
  tripId,
  boot,
  members,
}: {
  tripId: string;
  boot: FaceBootstrap | null;
  members: TripMemberRow[] | null;
}) {
  const utils = trpc.useUtils();

  // During render, not in an effect: a child's mount-effect runs BEFORE the
  // parent's, so an effect here would seed after the child had already fetched.
  useMemo(() => {
    if (boot) utils.competitions.faceBootstrap.setData({ tripId }, boot);
    if (members) utils.tripMembers.list.setData({ tripId }, members);
  }, [boot, members, tripId, utils]);

  return null;
}
