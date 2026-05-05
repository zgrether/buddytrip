"use client";

import { useState } from "react";
import { Pencil, Trash2, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionSetupPanel } from "./CompetitionSetupPanel";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
  // motto column still exists in the DB but the UI no longer reads it.
}

const STATUS_CHIP: Record<
  Competition["status"],
  { label: string; bg: string; color: string; border: string }
> = {
  upcoming: {
    label: "Setup",
    bg: "var(--color-bt-warning-faint)",
    color: "var(--color-bt-warning)",
    border: "var(--color-bt-warning-border)",
  },
  active: {
    label: "Active",
    bg: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
  completed: {
    label: "Completed",
    bg: "var(--color-bt-tag-bg)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
};

interface Props {
  competition: Competition;
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  /**
   * Fired after the owner deletes the competition. Lets the trip page
   * reset compUnlocked + bounce the user off the comp tab so the comp
   * tab fully disappears (not just for the rest of the crew).
   */
  onDeleted?: () => void;
}

/**
 * CompetitionHeader — title strip + at-a-glance setup progress.
 *
 * Tap the pencil (canEdit) to expand CompetitionSetupPanel inline for
 * editing. Owners can also wipe the whole competition via the trash
 * button — clears all teams / events / groups via the schema's CASCADE.
 */
export function CompetitionHeader({
  competition,
  tripId,
  canEdit,
  isOwner,
  onDeleted,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const utils = trpc.useUtils();

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

  const eventsTyped = events as Array<{
    id: string;
    type?: string | null;
    is_practice?: boolean | null;
  }>;
  const scoredEvents = eventsTyped.filter((e) => !e.is_practice).length;
  const eventsComplete = scoredEvents > 0;

  const { data: arenas = [] } = trpc.arenas.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const arenasTyped = arenas as Array<{ event_id: string | null }>;
  const arenasLinked = arenasTyped.filter((a) => a.event_id !== null).length;
  const arenasComplete = scoredEvents > 0 && arenasLinked === scoredEvents;

  const teamsCount = (assignments as Array<unknown>).length;
  const eventsCount = eventsTyped.length;

  const deleteComp = trpc.competitions.delete.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
    },
    onSuccess: () => {
      setConfirming(false);
      onDeleted?.();
    },
  });

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
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="text-base font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {competition.name}
            </p>
            <StatusBadge status={competition.status} />
          </div>
          {competition.tagline && competition.tagline.trim() && (
            <p
              className="mt-0.5 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
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
        {/* Delete is only available before the competition has gone live —
            once status flips to active or completed the data is meaningful
            and shouldn't be wiped from the header. Phase B can offer an
            archive flow for that case. */}
        {isOwner && !editing && competition.status === "upcoming" && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Delete competition"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "transparent",
              color: "var(--color-bt-danger)",
            }}
            data-testid="competition-delete-btn"
          >
            <Trash2 size={14} />
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
        <ProgressPill label={`Events: ${scoredEvents}`} complete={eventsComplete} />
        <ProgressPill
          label={`Arenas: ${arenasLinked} linked`}
          complete={arenasComplete}
        />
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

      {confirming && (
        <DeleteCompetitionConfirmModal
          competitionName={competition.name}
          teamsCount={teamsCount}
          eventsCount={eventsCount}
          isPending={deleteComp.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            deleteComp.mutate({ tripId, competitionId: competition.id })
          }
        />
      )}
    </div>
  );
}

// ── DeleteCompetitionConfirmModal ───────────────────────────────────────────

function DeleteCompetitionConfirmModal({
  competitionName,
  teamsCount,
  eventsCount,
  isPending,
  onCancel,
  onConfirm,
}: {
  competitionName: string;
  teamsCount: number;
  eventsCount: number;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Tally the cascading damage so the user knows what they're about to lose.
  // teamsCount uses the assignments-derived count (not raw teams.length) so
  // the copy stays accurate even when teams have no members yet.
  const summary = describeCascade(teamsCount, eventsCount);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 text-center sm:text-left">
          <div
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
            style={{
              background: "var(--color-bt-danger-faint)",
              color: "var(--color-bt-danger)",
            }}
          >
            <Trash2 size={18} />
          </div>
          <h3
            className="mt-3 text-base font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Delete &ldquo;{competitionName}&rdquo;?
          </h3>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            This will delete all teams, events, and groups{summary}. This
            cannot be undone.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--color-bt-danger)" }}
          >
            {isPending ? "Deleting…" : "Delete Competition"}
          </button>
        </div>
      </div>
    </div>
  );
}

function describeCascade(teamAssignments: number, events: number): string {
  // " (3 assignments and 2 events)" / " (2 events)" / "" — keeps the
  // headline copy clean when nothing's been built yet.
  const parts: string[] = [];
  if (teamAssignments > 0) {
    parts.push(`${teamAssignments} assignment${teamAssignments === 1 ? "" : "s"}`);
  }
  if (events > 0) {
    parts.push(`${events} event${events === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "";
  return ` (${parts.join(" and ")})`;
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function describeGroupsStatus(golfEventCount: number): string {
  if (golfEventCount === 0) return "no golf events yet";
  return "set per event";
}

function StatusBadge({ status }: { status: Competition["status"] }) {
  const cfg = STATUS_CHIP[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
      }}
      data-testid="competition-status-badge"
    >
      {cfg.label}
    </span>
  );
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
