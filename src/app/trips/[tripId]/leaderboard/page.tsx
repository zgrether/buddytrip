"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
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

  const { data: competition, isLoading: compLoading } =
    trpc.competitions.getByTrip.useQuery({ tripId });
  const { role, isOwner, canEdit, loading: roleLoading } = useTripRole(tripId);
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  // A game delegate is a BUILDER, not audience — they reach the competition in
  // BOTH phases to configure their assigned game (setup happens pre-live, and
  // delegates aren't always organizers). One competition per trip (MVP), so any
  // delegated game ⇒ a delegate of this competition. Edit stays scoped to their
  // game(s) by the edit gate; this is visibility only.
  const { data: myDelegateGameIds = [], isLoading: delegateLoading } =
    trpc.games.myDelegateGameIds.useQuery({ tripId }, { enabled: !!competition });
  const amDelegate = (myDelegateGameIds as string[]).length > 0;

  const loading = compLoading || roleLoading || delegateLoading;

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
  } else if (!canEdit && !amDelegate && competition.status !== "active") {
    // Plain members (no delegation) don't see the competition until Go Live
    // (the visibility switch). Owners/organizers/co-admins AND game delegates
    // (builders) always get the full face — a delegate needs pre-live access to
    // set up their assigned game.
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
        canPost={role === "Owner" || role === "Organizer"}
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
