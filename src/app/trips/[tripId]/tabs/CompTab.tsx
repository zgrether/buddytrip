"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";
import { CompetitionHeader } from "@/components/competition/CompetitionHeader";
import { TeamsPanel } from "@/components/competition/TeamsPanel";
import { MatchupPanel } from "@/components/competition/MatchupPanel";
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
 *   1. Loading        → null (instant — data is pre-warmed by page.tsx)
 *   2. None + canEdit → full-width CompetitionSetupPanel in create mode
 *   3. None + member  → read-only "not set up yet" empty state
 *   4. Exists         → CompetitionHeader + Teams + Matchup stack
 *
 * `competitions.getByTrip` is already called in page.tsx and cached in
 * TanStack Query before this tab ever mounts, so `isLoading` is always
 * false on the first render — no skeleton flash. The panel-level queries
 * (teams, assignments, events, venues) fire in parallel when the tab
 * mounts and httpBatchLink bundles them into one HTTP round trip.
 */
export function CompTab({
  trip,
  canEdit,
  isOwner,
  onCompetitionDeleted,
}: CompTabProps) {
  const tripId = trip.id;

  // Already cached by page.tsx — isLoading is false on first render.
  const { data: competition, isLoading } = trpc.competitions.getByTrip.useQuery(
    { tripId },
  );

  // Still loading (shouldn't normally happen given page.tsx pre-warms this).
  if (isLoading) return null;

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
    status: "upcoming" | "active" | "completed";
  };
  canEdit: boolean;
  isOwner: boolean;
  onCompetitionDeleted?: () => void;
}) {
  // Creation state lives at this level so the +Team / +Event / +Venue
  // buttons in CompetitionHeader can drive the same sheets that the
  // panels' empty-state CTAs trigger.
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [creatingManualVenue, setCreatingManualVenue] = useState(false);

  return (
    <div className="space-y-3 px-4">
      <CompetitionHeader
        competition={competition}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
        onDeleted={onCompetitionDeleted}
        onAddTeam={() => setCreatingTeam(true)}
        onAddEvent={() => setCreatingEvent(true)}
        onAddVenue={() => setCreatingManualVenue(true)}
      />
      <TeamsPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
        creating={creatingTeam}
        onCreatingChange={setCreatingTeam}
      />
      <MatchupPanel
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
        creatingEvent={creatingEvent}
        onCreatingEventChange={setCreatingEvent}
        creatingManualVenue={creatingManualVenue}
        onCreatingManualVenueChange={setCreatingManualVenue}
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
