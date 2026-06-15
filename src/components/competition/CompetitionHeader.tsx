"use client";

import { useMemo, useState } from "react";
import { Pause, Pencil, Radio, Trash2, Trophy, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import type { CSSProperties } from "react";

// ── Status strip (§2) ───────────────────────────────────────────────────────
// Content-driven, collapses entirely when empty. Priority ladder: games
// underway now ("On tap: …") → standing glance ("BLU 8½ · RED 7½") → nothing.
// Quiet, not a live ticker (the live pulse belongs on game pages — deferred).
interface StripLB {
  teams: { id: string; short_name: string }[];
  games: { name: string; status: string; dropped: boolean }[];
  teamTotals: Record<string, number>;
}
function fmtHalf(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}
function buildStatusStrip(lb: StripLB | undefined): string | null {
  if (!lb) return null;
  const live = (lb.games ?? []).filter((g) => !g.dropped);
  const active = live.filter((g) => g.status === "active");
  if (active.length > 0) return `On tap: ${active.map((g) => g.name).join(", ")}`;
  const teams = lb.teams ?? [];
  const totals = lb.teamTotals ?? {};
  if (teams.length >= 2 && teams.some((t) => (totals[t.id] ?? 0) > 0)) {
    return [...teams]
      .sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
      .map((t) => `${t.short_name} ${fmtHalf(totals[t.id] ?? 0)}`)
      .join("  ·  ");
  }
  return null;
}

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
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
   * Fired after the owner deletes the competition. Lets the host
   * reset its unlocked flag so the create flow reappears.
   */
  onDeleted?: () => void;
  /**
   * Chrome-shrink (§3): post-live the header collapses to a compact bar
   * (smaller glyph, no tagline) so the leaderboard is the hero and doesn't
   * start halfway down the page.
   */
  compact?: boolean;
  /**
   * Go-live toggle handler. The mutation is owned by the host
   * (CompetitionFace) so going live can also flip the default view to the
   * board. When omitted, a read-only status badge is shown instead of the
   * toggle (non-owners / completed competitions).
   */
  onToggleLive?: () => void;
  /** True while the go-live mutation is in flight (disables the toggle). */
  togglePending?: boolean;
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
  compact = false,
  onToggleLive,
  togglePending = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const utils = trpc.useUtils();

  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const { data: allGames = [] } = trpc.games.listByTrip.useQuery(
    { tripId },
    { enabled: !!competition.id }
  );

  const teamsCount = (assignments as Array<unknown>).length;
  const gamesCount = (allGames as Array<{ competition_id: string | null }>).filter(
    (g) => g.competition_id === competition.id
  ).length;

  // Status strip content (§2). Shares the leaderboard query with the board view
  // (same key → deduped), so it adds no fetch when the board is showing.
  const { data: lb } = trpc.competitions.leaderboard.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: !!competition.id }
  );
  const statusStrip = useMemo(
    () => buildStatusStrip(lb as unknown as StripLB | undefined),
    [lb]
  );

  const deleteComp = trpc.competitions.delete.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
    },
    onSuccess: () => {
      setConfirming(false);
      onDeleted?.();
    },
  });

  // Chrome-shrink (§3): compact glyph + tighter spacing post-live so the
  // board is the hero. The tagline is dropped in compact mode.
  const glyphBox: CSSProperties = {
    background: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
  };

  return (
    <div data-testid="competition-header">
      {/* Title row — no outer card, sits directly on the page background */}
      <div className={`flex items-start gap-3 ${compact ? "pb-2" : "pb-3"}`}>
        <div
          className={`flex flex-shrink-0 items-center justify-center rounded-xl ${
            compact ? "h-8 w-8" : "h-10 w-10"
          }`}
          style={glyphBox}
        >
          <Trophy size={compact ? 16 : 18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`font-bold ${compact ? "text-sm" : "text-base"}`}
              style={{ color: "var(--color-bt-text)" }}
            >
              {competition.name}
            </p>
            {onToggleLive && competition.status !== "completed" ? (
              <LiveToggleButton
                status={competition.status}
                pending={togglePending}
                onClick={onToggleLive}
              />
            ) : (
              <StatusBadge status={competition.status} />
            )}
          </div>
          {!compact && competition.tagline && competition.tagline.trim() && (
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

      {/* Status strip (§2) — lower region, collapses entirely when empty. */}
      {statusStrip && (
        <p
          className={compact ? "pb-2" : "pb-3"}
          style={{ color: "var(--color-bt-text-dim)", fontSize: 12 }}
          data-testid="competition-status-strip"
        >
          {statusStrip}
        </p>
      )}

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
          gamesCount={gamesCount}
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
  gamesCount,
  isPending,
  onCancel,
  onConfirm,
}: {
  competitionName: string;
  teamsCount: number;
  gamesCount: number;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Tally the cascading damage so the user knows what they're about to lose.
  // teamsCount uses the assignments-derived count (not raw teams.length) so
  // the copy stays accurate even when teams have no members yet.
  const summary = describeCascade(teamsCount, gamesCount);

  return (
    <ScrollLock>
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
    </ScrollLock>
  );
}

function describeCascade(teamAssignments: number, games: number): string {
  // " (3 assignments and 2 games)" / " (2 games)" / "" — keeps the
  // headline copy clean when nothing's been built yet.
  const parts: string[] = [];
  if (teamAssignments > 0) {
    parts.push(`${teamAssignments} assignment${teamAssignments === 1 ? "" : "s"}`);
  }
  if (games > 0) {
    parts.push(`${games} game${games === 1 ? "" : "s"}`);
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
    <ScrollLock>
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
    </ScrollLock>
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

// ── LiveToggleButton (owner only) ──────────────────────────────────────────
//
// Replaces the SETUP / Active badge for owners with a one-tap toggle.
// "upcoming" → tap to GO LIVE (activates bottom nav + scoreboard
// surface for the whole crew). "active" → tap to return to setup
// (hides nav + scoreboard until ready again).

function LiveToggleButton({
  status,
  pending,
  onClick,
}: {
  status: "upcoming" | "active";
  pending: boolean;
  onClick: () => void;
}) {
  const isLive = status === "active";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={isLive ? "Switch back to setup mode" : "Go live for the crew"}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-60"
      style={
        isLive
          ? {
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
          : {
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              border: "1px solid var(--color-bt-accent)",
            }
      }
      data-testid="competition-live-toggle"
    >
      {isLive ? <Pause size={10} strokeWidth={3} /> : <Radio size={10} strokeWidth={3} />}
      {isLive ? "Back to Setup" : "Go Live"}
    </button>
  );
}

