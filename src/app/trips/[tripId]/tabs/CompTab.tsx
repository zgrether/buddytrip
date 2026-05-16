"use client";

import { AlertTriangle, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionSetupPanel } from "@/components/competition/CompetitionSetupPanel";
import { CompetitionHeader } from "@/components/competition/CompetitionHeader";
import { TeamsPanel } from "@/components/competition/TeamsPanel";
import { EventsPanel } from "@/components/competition/EventsPanel";
import { ScoreboardPanel } from "@/components/competition/ScoreboardPanel";
import type { EventRow } from "@/components/competition/EventsPanel";
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
 *   4. Exists         → CompetitionHeader + Teams + Events stack
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
  // Fetch events to compute unlinked GOLF count for the nudge panel.
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const unlinkedGolfCount = (events as EventRow[])
    .filter((e) => e.type === "GOLF" && !e.is_practice && !e.agenda_item).length;

  return (
    <div className="space-y-6 px-4">
      {/* Nudge: golf events without an agenda link can't provide scorecards */}
      {canEdit && unlinkedGolfCount > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-warning-border, var(--color-bt-border))",
          }}
        >
          <span
            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
          >
            <AlertTriangle size={14} />
          </span>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {unlinkedGolfCount === 1 ? "1 golf event" : `${unlinkedGolfCount} golf events`} not linked to the agenda
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Scorecard entry won&apos;t be available until linked to a golf round on the agenda.
            </p>
          </div>
        </div>
      )}

      <CompetitionHeader
        competition={competition}
        tripId={tripId}
        canEdit={canEdit}
        isOwner={isOwner}
        onDeleted={onCompetitionDeleted}
      />
      {/* Scoreboard only renders once the competition is live — in setup
          mode the comp tab is for building teams + events, not viewing
          standings. The owner flips status via the GO LIVE button in
          CompetitionHeader. */}
      {competition.status === "active" && (
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
      <EventsPanel
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
