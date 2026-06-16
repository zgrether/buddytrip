"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { canAccessCompetition } from "@/lib/competitionAccess";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { TopNav } from "@/components/TopNav";
import { TripBottomNav } from "@/components/BottomNav";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, type NewsAuthorMeta } from "@/components/NewsPanel";
import { CompetitionFace } from "@/components/competition/CompetitionFace";
import { CompetitionIntroPanel } from "@/components/competition/CompetitionIntroPanel";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";

/**
 * The Live face — the competition face's root (the "Live" bottom-nav
 * destination). Stage 3 escaped this off the trip's Competition tab: it's now
 * a clean face = global title bar (Band 1) + the competition header (Band 2) +
 * the bottom nav, with NO trip header and NO trip tab bar.
 *
 * It hosts both states through CompetitionFace (setup guide ⇄ leaderboard) and
 * — as the interim entry point until Stage 5 — the pre-competition create flow
 * the Competition tab used to own inline.
 *
 * Role gating:
 *   - editor, no competition      → intro → create form
 *   - non-editor, no competition  → "not set up yet"
 *   - non-editor, not live        → "not live yet" (go-live reveals the board)
 *   - otherwise                   → the two-state CompetitionFace
 */
export default function LiveFacePage() {
  const { tripId } = useParams<{ tripId: string }>();

  // Push competition (Go Live, name, tagline) + membership changes live so the
  // face re-resolves without a manual refresh.
  useRealtimeCompetition(tripId);
  useRealtimeMembers(tripId);

  const [chatOpen, setChatOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  // Editor has tapped "Enable Competition Mode" — swaps the intro panel for the
  // create form. Reset when the competition is deleted so the intro reappears.
  const [unlocked, setUnlocked] = useState(false);

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
  const { data: boot, isLoading: loading } =
    trpc.competitions.faceBootstrap.useQuery({ tripId });

  const competition = boot?.competition ?? null;
  // Competition role (owner / co_admin / member), live-derived server-side.
  const role = boot?.myCompetitionRole ?? null;
  const canEdit = role === "owner" || role === "co_admin";
  const isOwner = role === "owner";
  // A delegate is a BUILDER — reaches the competition in both phases to set up
  // their assigned game (canAccessCompetition admits them). Edit stays scoped to
  // their game by the edit gate; this is visibility only.
  const amDelegate = (boot?.myDelegateGameIds.length ?? 0) > 0;

  // Seed the child caches from the one bootstrap so the board/guide — and the
  // setup↔leaderboard toggle, and the sub-views — render from cache with NO
  // extra round-trips. The global 60s staleTime keeps the seed fresh, so the
  // children's own useQuery calls don't re-fetch. Keyed on `boot` so it runs
  // exactly once per resolve, synchronously DURING render — before the face's
  // children mount and fire their queries (an effect runs too late: child
  // mount-effects fire before the parent's, so they'd re-fetch first).
  useMemo(() => {
    if (!boot) return;
    utils.competitions.getByTrip.setData({ tripId }, boot.competition as never);
    utils.games.myDelegateGameIds.setData({ tripId }, boot.myDelegateGameIds);
    if (boot.competition) {
      const cid = boot.competition.id as string;
      utils.competitions.leaderboard.setData(
        { tripId, competitionId: cid },
        boot.leaderboard as never,
      );
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
    // No competition row yet. Editors get the create flow (the interim entry
    // point); everyone else gets a calm placeholder.
    if (canEdit) {
      body = unlocked ? (
        <CompetitionSetupPanel tripId={tripId} />
      ) : (
        <CompetitionIntroPanel onEnable={() => setUnlocked(true)} />
      );
    } else {
      body = <NotSetUpEmptyState />;
    }
  } else if (
    !canAccessCompetition({ canEdit, amDelegate, status: competition.status })
  ) {
    // Plain members (no delegation) don't see the competition until Go Live.
    // Builders (owner / organizer / co-admin / delegate) always get the full
    // face. Same predicate as the "Live" nav entry — they can't disagree.
    body = <NotLiveEmptyState />;
  } else {
    body = (
      <CompetitionFace
        tripId={tripId}
        competition={competition}
        canEdit={canEdit}
        isOwner={isOwner}
        onCompetitionDeleted={() => setUnlocked(false)}
      />
    );
  }

  return (
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
        onDismissPanels={() => {
          setChatOpen(false);
          setNewsOpen(false);
        }}
      />

      <main className="mx-auto max-w-[1024px] px-4 pt-4 pb-32">{body}</main>

      {/* Bottom nav persists on the face so you can always cross back to the
          trip (§11). Live is the current destination. */}
      <TripBottomNav tripId={tripId} showComp={true} />

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
  );
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

function NotLiveEmptyState() {
  return (
    <EmptyState
      title="Competition isn't live yet"
      body="The organizer hasn't flipped this to live. The leaderboard appears here once they hit Go Live."
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
