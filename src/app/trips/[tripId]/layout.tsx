import { HydrateQueryState } from "@/components/HydrateQueryState";
import type { inferRouterOutputs } from "@trpc/server";
import { createSSRHelpers } from "@/server/trpc-ssr";
import { TripBootSeed } from "@/components/competition/TripBootSeed";
import { TripIdProvider } from "@/components/TripIdProvider";
import type { FaceBootstrap } from "@/components/competition/LiveFaceClient";
import type { AppRouter } from "@/server/router";

/** Exactly what `tripMembers.list` returns — inferred, so the seed can never
 *  drift from the query it is seeding. */
type TripMemberRow = inferRouterOutputs<AppRouter>["tripMembers"]["list"][number];

/**
 * Per-trip route layout (Server Component) — the shell's server boundary.
 *
 * Prefetches on the server and dehydrates into the client cache, so the first
 * client render finds the data already there instead of firing a round trip.
 *
 * ── #730: this only started being true just now ──────────────────────────────
 * From this layout's creation until #730, the dehydrated payload was DISCARDED
 * on arrival and every prefetch here was decorative — `helpers.dehydrate()`
 * returns a superjson envelope, not the `DehydratedState` it is typed as, so
 * `HydrationBoundary` read `state.queries`, found `undefined`, and hydrated
 * nothing. Silently. `HydrateQueryState` deserializes it first; the round trip
 * is pinned by `hydrationTransport.test.ts`.
 *
 * The explicit seed below (`TripBootSeed`) exists BECAUSE of that bug and is
 * deliberately still here — the boundary is proven by test but not yet by a
 * cold open, and retiring a workaround belongs in its own revertable change.
 *
 * ── Why `faceBootstrap` lives HERE now (Phase 4) ─────────────────────────────
 * It used to be resolved by `leaderboard/page.tsx`, which stopped being a
 * surface when Phase 3 made the competition a TAB — so the alias hop lost the
 * seed and a cold Cup deep link paid a client fetch for it (measured: a 4-deep
 * waterfall, `faceBootstrap` fetched TWICE, 19 procedures across 6 batches).
 *
 * The layout is the right home because it is the one server boundary BOTH the
 * trip route and the leaderboard alias pass through, so one resolve now covers
 * every tab rather than one surface.
 *
 * ── Parallel, not serial ─────────────────────────────────────────────────────
 * The two prefetches are issued together and awaited with `Promise.all`, so the
 * layout's added wall-clock is the MAX of the two rather than their sum.
 * Awaiting them in sequence would make the cheap `getByTrip` wait behind the
 * heavier bootstrap for no reason.
 *
 * Failures are swallowed per-prefetch: if the user isn't authed or isn't a
 * member, the page surfaces the right error state, and throwing from a layout
 * would replace the whole page with an error boundary. `allSettled` rather than
 * `all` so one failing resolve can't discard the other's result.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  /**
   * The param IS the trip id — `/trips/{id}` is the only URL shape the app
   * produces (CLAUDE.md #21). This used to resolve a slug here first, because
   * a slug never matches `trip_members.trip_id` and prefetching with the raw
   * param threw FORBIDDEN on every list-door entry, silently swallowed by
   * `allSettled`. Slugs are gone, so the resolve is too — and NOT replaced by
   * a shape check: `trips.id` is `text`, so an id that doesn't look like a
   * UUID is still a perfectly good id. A prefetch for an id the caller can't
   * see just fails and falls through, exactly as before.
   */
  const { tripId } = await params;

  // NOT a `DehydratedState`, despite what `helpers.dehydrate()` is typed as —
  // it is a superjson ENVELOPE (`{ json, meta }`). See HydrateQueryState for
  // the whole story; the honest type here is what keeps the lie from
  // re-annotating itself. (#730)
  let dehydratedState: unknown = undefined;
  let boot: FaceBootstrap | null = null;
  let members: TripMemberRow[] | null = null;
  try {
    const helpers = await createSSRHelpers();
    // Issued together, awaited once: the added wall-clock is the MAX of the three,
    // not their sum. `allSettled` so one failure can't discard the others' results.
    //
    // `tripMembers.list` joined this set to kill the trip-open role flash. It is
    // what `useTripRole` reads, and while it was in flight `role` was `null` — so
    // `isOwner` was FALSE, and `ItineraryPanel`'s `if (!isOwner)` took the MEMBER
    // path and painted "Your timeline will start to fill in" until the query
    // landed. Pending was indistinguishable from member.
    //
    // Resolving it here removes the pending state on this path rather than
    // covering it, and it is a CLASS fix: every consumer that reads `role`
    // directly — `ItineraryPanel` via the page, `ChatView`'s `canSeePlanning`,
    // `FloatingChatPanel`'s `canSeeOrganizers` — gets a resolved role on its
    // first render, without any of them being touched.
    //
    // `.fetch` not `.prefetch`, deliberately: the value has to come BACK so it can
    // be seeded explicitly below. See TripBootSeed for why the HydrationBoundary
    // can't do this job here.
    const [, bootResult, membersResult] = await Promise.allSettled([
      helpers.competitions.getByTrip.prefetch({ tripId }),
      helpers.competitions.faceBootstrap.fetch({ tripId }),
      helpers.tripMembers.list.fetch({ tripId }),
    ]);
    if (bootResult.status === "fulfilled") boot = bootResult.value as FaceBootstrap;
    if (membersResult.status === "fulfilled") members = membersResult.value as TripMemberRow[];
    dehydratedState = helpers.dehydrate();
  } catch {
    // Auth or membership — fall through to the client, which renders the
    // right error state. `members` stays null and `useTripRole` fetches as
    // before, which is why ItineraryPanel still honours its `roleLoading`
    // branch rather than trusting the seed to always land.
  }

  return (
    <HydrateQueryState state={dehydratedState}>
      {/* The ONE place the URL param is read. Everything trip-scoped below
          reads `useTripId()`; nothing re-derives it from `useParams()`.
          See TripIdProvider. */}
      <TripIdProvider>
        {/* Explicit seed — the dehydrated state alone does not reach the client
            cache here; see TripBootSeed for the evidence and why. */}
        {tripId && <TripBootSeed tripId={tripId} boot={boot} members={members} />}
        {children}
      </TripIdProvider>
    </HydrateQueryState>
  );
}
