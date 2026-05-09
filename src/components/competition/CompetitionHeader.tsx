"use client";

import { useState } from "react";
import { Flag, Pencil, Plus, Trash2, Trophy, Users, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

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
  /** Action-bar handlers — when provided, the header renders +Team /
   *  +Event affordances inline below the title strip so the
   *  inner panels don't have to surface them. */
  onAddTeam?: () => void;
  onAddEvent?: () => void;
}

/**
 * CompetitionHeader — title strip + at-a-glance setup progress.
 *
 * Tap the pencil (canEdit) to open the edit modal. Owners can also
 * wipe the whole competition via the trash button — clears all teams /
 * events / groups via the schema's CASCADE.
 */
export function CompetitionHeader({
  competition,
  tripId,
  canEdit,
  isOwner,
  onDeleted,
  onAddTeam,
  onAddEvent,
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
    <div data-testid="competition-header">
      {/* Title row — no outer card, sits directly on the page background */}
      <div className="flex items-start gap-3 pb-3">
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
        {/* Delete only before the competition goes live */}
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

      {/* Action bar — equal-width two-column grid */}
      <div className="grid grid-cols-2 gap-2">
        <ActionTile
          icon={<Users size={14} />}
          label="Team"
          status={
            totalMembers > 0
              ? `${assignedCount}/${totalMembers} assigned`
              : "Not set up"
          }
          complete={teamsComplete}
          onAdd={canEdit ? onAddTeam : undefined}
        />
        <ActionTile
          icon={<Flag size={14} />}
          label="Event"
          status={
            eventsTyped.length === 0
              ? "Not set up"
              : `${scoredEvents} scored${
                  eventsTyped.length - scoredEvents > 0
                    ? ` · ${eventsTyped.length - scoredEvents} practice`
                    : ""
                }`
          }
          complete={eventsComplete}
          onAdd={canEdit ? onAddEvent : undefined}
        />
      </div>

      {editing && (
        <CompetitionEditModal
          tripId={tripId}
          competition={competition}
          onClose={() => setEditing(false)}
        />
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

// ── CompetitionEditModal ────────────────────────────────────────────────────

function CompetitionEditModal({
  tripId,
  competition,
  onClose,
}: {
  tripId: string;
  competition: Competition;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(competition.name);
  const [tagline, setTagline] = useState(competition.tagline ?? "");
  const [error, setError] = useState<string | null>(null);

  const updateComp = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous) {
        utils.competitions.getByTrip.setData({ tripId }, {
          ...previous,
          name: vars.name ?? previous.name,
          tagline: vars.tagline ?? previous.tagline,
        });
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) {
        utils.competitions.getByTrip.setData({ tripId }, ctx.previous);
      }
      setError(e.message ?? "Failed to update competition");
    },
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
    },
    onSuccess: () => onClose(),
  });

  const trimmedName = name.trim();
  const disabled = updateComp.isPending || trimmedName.length < 2;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h2 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            Edit Competition
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 px-5 py-4">
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Competition Name <span style={{ color: "var(--color-bt-text-dim)" }}>required</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BBMI 2026, The Yert Open"
              maxLength={200}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Tagline <span className="normal-case font-normal">optional</span>
            </label>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. May the best team win"
              maxLength={500}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </div>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex gap-2 px-5 pb-6 pt-2"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={updateComp.isPending}
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
            onClick={() =>
              updateComp.mutate({
                tripId,
                competitionId: competition.id,
                name: trimmedName,
                tagline: tagline.trim() || null,
              })
            }
            disabled={disabled}
            className="flex flex-1 items-center justify-center rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {updateComp.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── StatusBadge ─────────────────────────────────────────────────────────────

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

function ActionTile({
  icon,
  label,
  status,
  complete,
  onAdd,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  complete: boolean;
  /** Undefined → render the tile as a non-interactive status block
   *  (read-only members or unsupported state). */
  onAdd?: () => void;
}) {
  // Clickable variant — compact secondary add button (icon + "+ Label").
  // Status copy lives in the panel headers below; the button itself just
  // needs to be clearly actionable, not a second status readout.
  if (onAdd) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label.toLowerCase()}`}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-opacity hover:opacity-80 active:scale-[0.98]"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "0.5px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
      >
        <span style={{ color: "var(--color-bt-text-dim)" }}>{icon}</span>
        <Plus size={11} style={{ color: "var(--color-bt-text-dim)" }} />
        <span>{label}</span>
      </button>
    );
  }

  // Read-only variant — status tile for non-editors.
  const accent = complete
    ? "var(--color-bt-accent)"
    : "var(--color-bt-text-dim)";
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <span style={{ color: accent }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p
          className="text-[12px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          {label}
        </p>
        <p
          className="mt-0.5 text-[11px] leading-tight"
          style={{ color: accent }}
        >
          {status}
        </p>
      </div>
    </div>
  );
}
