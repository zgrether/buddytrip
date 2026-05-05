"use client";

import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";
import { CompetitionHeader } from "@/components/competition/CompetitionHeader";
import { TeamsPanel } from "@/components/competition/TeamsPanel";
import { EventsPanel } from "@/components/competition/EventsPanel";
import { GroupsPanel } from "@/components/competition/GroupsPanel";
import type { TabProps } from "./types";

interface CompTabProps extends TabProps {
  /**
   * Fired when the owner deletes the competition. The trip page uses
   * this to reset compUnlocked + bounce back to the home tab so the
   * comp tab fully disappears for everyone (not just the rest of the
   * crew).
   */
  onCompetitionDeleted?: () => void;
}

/**
 * CompTab — competition hub for a trip.
 *
 * Four states:
 *   1. Loading        → skeleton panels (same height as real ones)
 *   2. None + canEdit → full-width CompetitionSetupPanel in create mode
 *   3. None + member  → read-only "not set up yet" empty state
 *   4. Exists         → CompetitionHeader + Teams + Events + Groups stack
 */
export function CompTab({
  trip,
  canEdit,
  isOwner,
  onCompetitionDeleted,
}: CompTabProps) {
  const tripId = trip.id;
  const { data: competition, isLoading } = trpc.competitions.getByTrip.useQuery({ tripId });

  if (isLoading) return <SkeletonPanels />;

  if (!competition && canEdit) {
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
  };
  canEdit: boolean;
  isOwner: boolean;
  onCompetitionDeleted?: () => void;
}) {
  return (
    <div className="space-y-3 px-4">
      <CompetitionHeader
        competition={competition}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
        onDeleted={onCompetitionDeleted}
      />
      <TeamsPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
      />
      <EventsPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
      />
      <GroupsPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
      />
    </div>
  );
}

// ── SkeletonPanels ──────────────────────────────────────────────────────────

function SkeletonPanels() {
  return (
    <div className="space-y-3 px-4" data-testid="comp-skeleton">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        />
      ))}
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

