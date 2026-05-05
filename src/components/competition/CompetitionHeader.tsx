"use client";

import { useState } from "react";
import { Pencil, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionSetupPanel } from "./CompetitionSetupPanel";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  // motto column still exists in the DB but the UI no longer reads it.
}

interface Props {
  competition: Competition;
  tripId: string;
  canEdit: boolean;
}

/**
 * CompetitionHeader — title strip + at-a-glance setup progress.
 *
 * Tap the pencil (canEdit only) to expand CompetitionSetupPanel inline
 * for editing. The progress pills are decorative for now — Phase B
 * scroll-to-anchor lands when the leaderboard navigation returns.
 */
export function CompetitionHeader({ competition, tripId, canEdit }: Props) {
  const [editing, setEditing] = useState(false);

  // Counts: trip members, team assignments, events. Each query is cheap
  // and keyed by the same trip/competition so there's no extra waterfall.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );

  const totalMembers = members.length;
  const assignedCount = assignments.length;
  const teamsComplete = totalMembers > 0 && assignedCount === totalMembers;

  const scoredEvents = (events as Array<{ is_practice?: boolean | null }>).filter(
    (e) => !e.is_practice
  ).length;
  const eventsComplete = scoredEvents > 0;

  const golfEvents = (events as Array<{ id: string; type?: string | null }>).filter(
    (e) => e.type === "GOLF"
  );
  const groupsLabel = describeGroupsStatus(golfEvents.length);
  const groupsComplete = golfEvents.length > 0;

  return (
    <div
      className="rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="competition-header"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Trophy size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {competition.name}
          </p>
          {competition.tagline && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {competition.tagline}
            </p>
          )}
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit competition"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
            }}
            data-testid="competition-edit-btn"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {/* Progress strip — divider above */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        <ProgressPill
          label={
            totalMembers > 0
              ? `Teams: ${assignedCount}/${totalMembers} assigned`
              : "Teams: not set up"
          }
          complete={teamsComplete}
        />
        <ProgressPill
          label={`Events: ${scoredEvents}`}
          complete={eventsComplete}
        />
        <ProgressPill label={`Groups: ${groupsLabel}`} complete={groupsComplete} />
      </div>

      {editing && (
        <div
          className="px-4 pb-4 pt-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <CompetitionSetupPanel
            tripId={tripId}
            competition={competition}
            onSuccess={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function describeGroupsStatus(golfEventCount: number): string {
  if (golfEventCount === 0) return "no golf events yet";
  return "set per event";
}

function ProgressPill({
  label,
  complete,
}: {
  label: string;
  complete: boolean;
}) {
  return (
    <span
      className="text-[11px] font-medium"
      style={{
        color: complete ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {label}
    </span>
  );
}
