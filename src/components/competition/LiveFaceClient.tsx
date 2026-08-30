"use client";

import { useMemo } from "react";
import { useTripId } from "@/components/TripIdProvider";
import Link from "next/link";
import { Trophy } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { SURFACE_BOX } from "@/components/shell/contentArea";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { useRealtimeMyDelegations } from "@/hooks/useRealtimeMyDelegations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CompetitionFace } from "@/components/competition/CompetitionFace";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";

/**
 * The Live face — the competition face's client root, rendered inside
 * `AppShell` as the Cup tab (Phase 3, and body-only since — the shell
 * supplies the app frame: `GameChromeProvider`, the top bar, the tab bar,
 * and chat/news, all of which used to be duplicated here behind a
 * standalone `embedded={false}` mode nothing constructed any more; removed
 * rather than left dormant, see the PR this landed in for the reachability
 * audit).
 *
 * It hosts both states through CompetitionFace (setup guide ⇄ leaderboard) and
 * — as the interim entry point until Stage 5 — the pre-competition create flow
 * the Competition tab used to own inline.
 *
 * Stage B: this is the CLIENT half of the face. The server route (page.tsx)
 * prefetches the same competitions.faceBootstrap resolve and ships it in the
 * dehydrated cache, so the useQuery below reads it during SSR (the board/guide
 * render populated on first paint) and on hydration finds it fresh (60s
 * staleTime) — no client round-trip for first paint. Interactivity + realtime
 * live here (client) over that server-rendered initial state. If the server
 * prefetch was skipped (unauthed/early), this falls back to its own fetch +
 * the loading state below.
 *
 * Role gating (option A — no competition-level reveal gate):
 *   - editor, no competition      → create flow (shape chooser)
 *   - non-editor, no competition  → "not set up yet"
 *   - competition exists          → the CompetitionFace, for EVERY trip member
 *                                   (editing gated inside by canEdit/isOwner)
 */
/** The competitions.faceBootstrap output — the server-resolved initial state. */
export type FaceBootstrap =
  inferRouterOutputs<AppRouter>["competitions"]["faceBootstrap"];

export function LiveFaceClient({
  initialBoot,
}: {
  /** Server-prefetched bootstrap (Stage B). null when the server prefetch was
   *  skipped (unauthed/early) — the client then fetches + shows the spinner. */
  initialBoot: FaceBootstrap | null;
}) {
  /**
   * The trip UUID, via the shared provider — never `useParams()` directly.
   *
   * This once read `useParams().tripId` and handed the raw value to
   * `competitions.faceBootstrap`. Back when trip URLs could carry a slug, that
   * value was a slug for anyone who arrived from a trip list, it never matched
   * `trip_members.trip_id`, and the whole Cup subtree rendered "no competition
   * yet" — an owner seeing the non-editor placeholder instead of the create
   * form was the tell. Slugs are gone now (CLAUDE.md #21), but the rule that
   * came out of it stands: read the id from `useTripId()`.
   *
   * Split outer/inner exactly as `TripDetailPage`/`TripDetailBody` does, so
   * everything below is typed against a plain `string` rather than threading
   * `undefined` through ~15 call sites. The fallback below is reachable only
   * for a param that isn't a trip UUID at all.
   */
  const { tripId } = useTripId();

  if (!tripId) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  return <LiveFaceInner tripId={tripId} initialBoot={initialBoot} />;
}

function LiveFaceInner({
  tripId,
  initialBoot,
}: {
  tripId: string;
  initialBoot: FaceBootstrap | null;
}) {
  // Push competition (name, tagline, roster setup) + membership changes live so
  // the face re-resolves without a manual refresh.
  useRealtimeCompetition(tripId);
  useRealtimeMembers(tripId);
  // A delegate grant that lands on ME while my board is already open (the
  // Owner assigning it from their own settings page, in their own browser) —
  // see useRealtimeMyDelegations for why this can't wait on a poll.
  const me = useCurrentUser();
  useRealtimeMyDelegations(tripId, me?.id);

  const utils = trpc.useUtils();

  // ── The single boundary resolve (Stage A) ────────────────────────────────
  // One round-trip for everything both face states need — no more 3-wave
  // waterfall, no separate role / delegate fetches. Trip-coupling lives only in
  // the bootstrap's server resolver; the client just reads what it returns.
  //
  // Stage B: the server route resolves this and hands it down as initialData, so
  // `boot` is defined on the very first (SSR) render — the board/guide render
  // populated in the server HTML, zero client round-trip for first paint.
  //
  // STRUCTURE layer (the alive-face cut): faceBootstrap is the slow-changing
  // competition shape, so it's KEPT — staleTime Infinity + a long gcTime
  // (STRUCTURE_QUERY). A warm remount (trip↔live, game→back) reads the kept cache
  // with no refetch, instead of re-fetching the whole blob on every boundary. It
  // refreshes only by INVALIDATION: structural mutations (pattern #10) and the
  // realtime competition hook (which now invalidates faceBootstrap, not just
  // getByTrip — the go-live reveal rode on the old 60s staleTime + the soft-nav
  // server re-run, both gone now). The warm soft-nav server re-resolve itself is
  // suppressed by the Router Cache (experimental.staleTimes.dynamic). The STATE
  // layer (standings) rides its own cadence — see the seed below + the
  // leaderboard's 30s poll.
  const { data: boot, isLoading: loading } =
    trpc.competitions.faceBootstrap.useQuery(
      { tripId },
      initialBoot
        ? { ...STRUCTURE_QUERY, initialData: initialBoot, initialDataUpdatedAt: () => Date.now() }
        : STRUCTURE_QUERY,
    );

  const competition = boot?.competition ?? null;
  // Competition role (owner / co_admin / member), live-derived server-side.
  const role = boot?.myCompetitionRole ?? null;
  const canEdit = role === "owner" || role === "co_admin";
  const isOwner = role === "owner";
  // Seed the child caches from the one bootstrap so the board/guide — and the
  // setup↔leaderboard toggle, and the sub-views — render from cache with NO
  // extra round-trips. Keyed on `boot` so it runs once per resolve, synchronously
  // DURING render — before the face's children mount and fire their queries (an
  // effect runs too late: child mount-effects fire before the parent's, so they'd
  // re-fetch first). This also runs during the SSR render pass, so the children
  // render populated in the server HTML (Stage B first paint).
  //
  // The STRUCTURE children (competition, games, teams, assignments) are seeded
  // ALWAYS — they're kept (STRUCTURE_QUERY) and the seed value is the same kept
  // structure, so re-seeding on remount is a harmless no-op overwrite. But the
  // STATE child (competitions.leaderboard) is seeded ONLY-IF-ABSENT: with
  // faceBootstrap now kept, `boot.leaderboard` can be staler than the live 30s
  // poll (individual score entry doesn't invalidate faceBootstrap), so an
  // always-seed would clobber fresher standings on every remount. Seed it for the
  // cold first paint; thereafter the leaderboard's own poll + direct invalidation
  // own it (the structure/state cut, applied at the seed).
  useMemo(() => {
    if (!boot) return;
    utils.competitions.getByTrip.setData({ tripId }, boot.competition as never);
    utils.games.myDelegateGameIds.setData({ tripId }, boot.myDelegateGameIds);
    if (boot.competition) {
      const cid = boot.competition.id as string;
      if (
        utils.competitions.leaderboard.getData({ tripId, competitionId: cid }) ===
        undefined
      ) {
        utils.competitions.leaderboard.setData(
          { tripId, competitionId: cid },
          boot.leaderboard as never,
        );
      }
      utils.games.listByTrip.setData({ tripId }, boot.games as never);
      utils.teams.list.setData({ tripId, competitionId: cid }, boot.teams as never);
      utils.teamAssignments.list.setData(
        { tripId, competitionId: cid },
        boot.assignments as never,
      );
    }
  }, [boot, tripId, utils]);

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{
            borderColor: "var(--color-bt-accent)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  } else if (!competition) {
    // No competition row yet. Editors land DIRECTLY on the create form (the
    // shape chooser + name) — the old "Enable Competition Mode" intro panel was
    // pure ceremony (a button that only revealed the form) and was removed, so
    // "Set it up" is one decision: pick a shape, name it, create. Everyone else
    // gets a calm placeholder.
    body = canEdit ? <CompetitionSetupPanel tripId={tripId} /> : <NotSetUpEmptyState />;
  } else {
    // Option A: a competition is visible to the WHOLE crew as soon as it exists
    // — there is no competition-level reveal gate any more (GO LIVE was removed;
    // per-game Setup/Scoring handles game-level readiness). Every trip member
    // gets the full face; editing is gated inside it by canEdit/isOwner.
    body = (
      // On delete, faceBootstrap re-resolves to no-competition and the create
      // form (shape chooser) reappears for the owner — no local reset needed.
      <CompetitionFace
        tripId={tripId}
        competition={competition}
        canEdit={canEdit}
        isOwner={isOwner}
      />
    );
  }

  // Body only — the shell (AppShell) owns the frame: GameChromeProvider, the
  // top bar, the tab bar, and chat/news. Rendering a second GameChromeProvider
  // here would give the game panel a provider the bar can't see, and the
  // game's back/title/gear would silently stop appearing — so this never
  // wraps its own.
  //
  // `lg:h-full lg:min-h-0` continues the shell's bounded height down to the board.
  // Without it this `<main>` is auto-height, so the two-pane grid's own `lg:h-full`
  // resolves to 100%-of-auto → auto, the panes stretch to CONTENT height, neither
  // ever overflows, and the shell body absorbs all the scrolling — which is what
  // made the panes non-independent and put a freshly-opened game below the fold.
  // `SURFACE_BOX` rather than this file's own `mx-auto max-w-[1024px] px-3` —
  // Cup no longer decides where the content area starts or how wide it is. At
  // `lg+` it goes flush inside the shell's content area, exactly as Trip does,
  // which is the whole of "one viewport geometry" at this level (contentArea.ts).
  // Mobile keeps a page's own padding, now 16px to match Trip's rather than the
  // 12px this alone carried.
  return <main className={`${SURFACE_BOX} lg:h-full lg:min-h-0`}>{body}</main>;
}

// ── Empty states ────────────────────────────────────────────────────────────

function NotSetUpEmptyState() {
  return (
    <EmptyState
      title="Competition hasn't been set up yet"
      body="The owner will set this up before the trip."
    />
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  const { tripId } = useTripId();
  return (
    <div
      className="mt-6 flex flex-col items-center justify-center rounded-xl px-6 py-16 text-center"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="comp-face-empty"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <Trophy size={28} />
      </div>
      <h2
        className="mt-4 text-lg font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {title}
      </h2>
      <p
        className="mt-2 max-w-xs text-sm leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {body}
      </p>
      <Link
        href={`/trips/${tripId}`}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        Back to trip
      </Link>
    </div>
  );
}
