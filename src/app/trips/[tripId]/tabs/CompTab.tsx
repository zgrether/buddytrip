"use client";

import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";
import { CompetitionHeader } from "@/components/competition/CompetitionHeader";
import { CompetitionIntroPanel } from "@/components/competition/CompetitionIntroPanel";
import { TeamsPanel } from "@/components/competition/TeamsPanel";
import { CompetitionGamesPanel } from "@/components/competition/CompetitionGamesPanel";
import { ScoreboardPanel } from "@/components/competition/ScoreboardPanel";
import type { TabProps } from "./types";

interface CompTabProps extends TabProps {
  /**
   * Fired when the owner deletes the competition. The trip page uses
   * this to reset compUnlocked + bounce back to the home tab so the
   * comp tab fully disappears for everyone (not just the rest of the
   * crew).
   */
  onCompetitionDeleted?: () => void;
  /**
   * Page-level "owner has tapped the invitation card and is committed to
   * setting up" flag. Persists for the session. Drives whether the
   * pre-competition surface shows the InvitationCard or jumps straight
   * to the CompetitionSetupPanel.
   */
  compUnlocked?: boolean;
  /** Flips compUnlocked to true. Called from the InvitationCard's intro modal. */
  onEnable?: () => void;
}

/**
 * CompTab — competition hub for a trip.
 *
 * State machine for the pre-competition phase (no `competition` row yet):
 *   1. Loading                         → null (instant — data is pre-warmed)
 *   2. canEdit + !compUnlocked         → CompetitionIntroPanel (trophy hero
 *                                        + feature list + "Enable
 *                                        Competition Mode" CTA). Tap Enable
 *                                        flips compUnlocked = true.
 *   3. canEdit + compUnlocked          → CompetitionSetupPanel (create form)
 *   4. !canEdit                        → "not set up yet" empty state
 *
 * Once a competition exists, ExistingCompetitionView takes over regardless
 * of compUnlocked / canEdit.
 *
 * Previously a smaller InvitationCard lived on the home tab and tapping it
 * opened a CompetitionIntroModal with the same trophy/features content.
 * The tab itself is now the discovery surface (default-visible for
 * editors), and the modal content has been inlined as the intro panel —
 * no more "Maybe later" / X dismiss since users back out by switching tabs.
 *
 * `competitions.getByTrip` is already called in page.tsx and cached in
 * TanStack Query before this tab ever mounts, so `isLoading` is always
 * false on the first render — no skeleton flash. The panel-level queries
 * (teams, assignments, events) fire in parallel when the tab mounts and
 * httpBatchLink bundles them into one HTTP round trip.
 */
export function CompTab({
  trip,
  canEdit,
  isOwner,
  onCompetitionDeleted,
  compUnlocked,
  onEnable,
}: CompTabProps) {
  const tripId = trip.id;

  // Already cached by page.tsx — isLoading is false on first render.
  const { data: competition, isLoading } = trpc.competitions.getByTrip.useQuery(
    { tripId },
  );

  // Still loading (shouldn't normally happen given page.tsx pre-warms this).
  if (isLoading) return null;

  if (!competition && canEdit) {
    if (!compUnlocked) {
      // Pre-enablement: full intro panel with trophy hero, feature list,
      // and "Enable Competition Mode" CTA. Tapping Enable flips
      // compUnlocked which re-renders into the setup panel below.
      return (
        <div className="px-4">
          <CompetitionIntroPanel onEnable={onEnable ?? (() => {})} />
        </div>
      );
    }
    return (
      <div className="px-4">
        <CompetitionSetupPanel tripId={tripId} />
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="px-4">
        <NotSetUpEmptyState />
      </div>
    );
  }

  return (
    <ExistingCompetitionView
      tripId={tripId}
      competition={competition}
      canEdit={canEdit}
      isOwner={!!isOwner}
      onCompetitionDeleted={onCompetitionDeleted}
    />
  );
}

// ── ExistingCompetitionView ─────────────────────────────────────────────────

function ExistingCompetitionView({
  tripId,
  competition,
  canEdit,
  isOwner,
  onCompetitionDeleted,
}: {
  tripId: string;
  competition: {
    id: string;
    name: string;
    tagline: string | null;
    status: "upcoming" | "active" | "completed";
  };
  canEdit: boolean;
  isOwner: boolean;
  onCompetitionDeleted?: () => void;
}) {
  // D1 §0/§3: a game's scorecard is gated on scorecard_schema, NEVER on agenda
  // linkage — so the old "unlinked golf event" nudge (a Phase-2 fact used as a
  // Phase-1 gate) is gone. The agenda link is orthogonal and optional (§9).
  return (
    <div className="space-y-6 px-4">
      <CompetitionHeader
        competition={competition}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
        onDeleted={onCompetitionDeleted}
      />
      {/* Scoreboard is always visible to the owner so they can pick a
          style + preview standings while still in setup mode. Non-owners
          only see it once the competition is live — no point surfacing
          an empty leaderboard before the owner flips Go Live. */}
      {(competition.status === "active" || isOwner) && (
        <ScoreboardPanel
          competitionId={competition.id}
          tripId={tripId}
          isOwner={isOwner}
        />
      )}
      <TeamsPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
      />
      <CompetitionGamesPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
      />
    </div>
  );
}

// ── NotSetUpEmptyState ──────────────────────────────────────────────────────

function NotSetUpEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl px-6 py-16 text-center"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="comp-not-set-up"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text-dim)",
        }}
      >
        <Trophy size={28} />
      </div>
      <h2
        className="mt-4 text-lg font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        Competition hasn&rsquo;t been set up yet
      </h2>
      <p
        className="mt-2 max-w-xs text-sm"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        The owner will set this up before the trip.
      </p>
    </div>
  );
}
