"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { TopNav } from "@/components/TopNav";
import { TripBottomNav } from "@/components/BottomNav";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, type NewsAuthorMeta } from "@/components/NewsPanel";
import { CompetitionFace } from "@/components/competition/CompetitionFace";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";
import { GameChromeProvider, useGameChrome } from "@/components/games/GameChrome";

/**
 * The Live face — the competition face's client root (the "Live" bottom-nav
 * destination). Stage 3 escaped this off the trip's Competition tab: it's a
 * clean face = global title bar (Band 1) + the competition header (Band 2) +
 * the bottom nav, with NO trip header and NO trip tab bar.
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
  const { tripId } = useParams<{ tripId: string }>();

  // Push competition (name, tagline, roster setup) + membership changes live so
  // the face re-resolves without a manual refresh.
  useRealtimeCompetition(tripId);
  useRealtimeMembers(tripId);

  const [chatOpen, setChatOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);

  const openChat = () => {
    setNewsOpen(false);
    setChatOpen((p) => !p);
  };
  const openNews = () => {
    setChatOpen(false);
    setNewsOpen((p) => !p);
  };

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

  // The current user's TEAM color, for the app-bar avatar (Task 2 — reinforces
  // team identity in competition context). Resolved from the same faceBootstrap
  // snapshot the board uses: my assignment → team → color. Undefined when I'm
  // teamless/unresolvable → the avatar falls back to the teal accent.
  const { data: me } = trpc.users.getMe.useQuery();
  const myTeamColor = useMemo(() => {
    if (!boot || !me) return null;
    const myTeamId = (boot.assignments as { user_id: string; team_id: string }[] | undefined)
      ?.find((a) => a.user_id === me.id)?.team_id;
    if (!myTeamId) return null;
    return (
      (boot.teams as { id: string; color: string | null }[] | undefined)
        ?.find((t) => t.id === myTeamId)?.color ?? null
    );
  }, [boot, me]);
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

  // Crew names (for chat/news authors) are container-provided and NOT needed to
  // render the face — fetch lazily, only when a panel opens (A4: chat/news off
  // the load critical path).
  const { data: members = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: chatOpen || newsOpen },
  );

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

  return (
    <GameChromeProvider>
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* Band 1 — the global title bar, identical to the trip face (§2). */}
      <TopNav
        tripId={tripId}
        onOpenChat={openChat}
        chatOpen={chatOpen}
        onOpenNews={openNews}
        newsOpen={newsOpen}
        avatarTeamColor={myTeamColor}
        onDismissPanels={() => {
          setChatOpen(false);
          setNewsOpen(false);
        }}
      />

      <main className="mx-auto max-w-[1024px] px-3 pt-4 pb-32">{body}</main>

      {/* Bottom nav persists on the face so you can always cross back to the trip
          (§11) — EXCEPT on the focused score-entry surface (#550 Task 5), where a
          game view publishes hideBottomNav. Live is the current destination. */}
      <FaceBottomNav
        tripId={tripId}
        liveLabel={competition?.short_name ?? competition?.name ?? null}
      />

      {/* Chat / News overlay any surface (§11). */}
      <FloatingChatPanel
        tripId={tripId}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        memberNames={Object.fromEntries(
          members.map(
            (m: {
              user_id: string | null;
              memberId: string;
              displayName: string;
            }) => [m.user_id ?? m.memberId, m.displayName]
          )
        )}
      />
      <NewsPanel
        tripId={tripId}
        isOpen={newsOpen}
        onClose={() => setNewsOpen(false)}
        canPost={canEdit}
        authors={Object.fromEntries(
          members.map(
            (m: {
              user_id: string | null;
              memberId: string;
              displayName: string;
              role: NewsAuthorMeta["role"];
              user: { avatar_icon: string | null } | null;
            }) => [
              m.user_id ?? m.memberId,
              {
                name: m.displayName,
                role: m.role,
                avatarIcon: m.user?.avatar_icon ?? null,
              },
            ]
          )
        )}
      />
    </div>
    </GameChromeProvider>
  );
}

// ── Bottom nav (game-aware) ──────────────────────────────────────────────────
// A consumer INSIDE the provider so it can read the published chrome; the score-
// entry surface hides it (Task 5). Kept on the scoreboard + everywhere else.
function FaceBottomNav({ tripId, liveLabel }: { tripId: string; liveLabel: string | null }) {
  const chrome = useGameChrome();
  if (chrome?.hideBottomNav) return null;
  return <TripBottomNav tripId={tripId} showComp={true} liveLabel={liveLabel} />;
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
  const { tripId } = useParams<{ tripId: string }>();
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
