"use client";

import { useState } from "react";
import { Trash2, RotateCcw, Eraser } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { TeamsPanel } from "./TeamsPanel";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
}

interface Props {
  competition: Competition;
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  /** Live = structure locked (TeamsPanel can't restructure mid-competition). */
  isLive: boolean;
  /** Roster-build phase — show the one-way "Save rosters" commit button. */
  rosterBuilding: boolean;
  /** Commit the roster build (advances the flag to `saved` + returns to board). */
  onSaveRosters: () => void;
  /** Fired after the owner deletes the competition (host resets its flag). */
  onDeleted?: () => void;
}

/**
 * CompetitionSettings — the single home for everything that used to be scattered
 * across the header (edit modal, delete trash) and the retired setup guide
 * (all-teams roster page). Reached from the header gear and the board's pre-save
 * "Team Rosters" button. Three sections:
 *   1. Details   — name + tagline, inline-edited (was the header pencil modal)
 *   2. Rosters   — the all-teams TeamsPanel (+ the one-way "Save rosters" commit)
 *   3. Danger    — delete the competition (was the header trash; owner + pre-live)
 *
 * STANDARD PALETTE ONLY — no competition accent / tonal shift.
 */
export function CompetitionSettings({
  competition,
  tripId,
  canEdit,
  isOwner,
  isLive,
  rosterBuilding,
  onSaveRosters,
  onDeleted,
}: Props) {
  return (
    <div className="space-y-6">
      <DetailsSection competition={competition} tripId={tripId} canEdit={canEdit} />

      <section className="space-y-3">
        <SectionLabel>Team Rosters</SectionLabel>
        <TeamsPanel
          competitionId={competition.id}
          tripId={tripId}
          canEdit={canEdit}
          structureLocked={isLive}
        />
        {canEdit && rosterBuilding && (
          <button
            type="button"
            onClick={onSaveRosters}
            className="w-full"
            style={{ height: 48, borderRadius: 12, background: "var(--color-bt-accent)", color: "var(--color-bt-base)", fontSize: 15, fontWeight: 600 }}
            data-testid="comp-save-rosters"
          >
            Save rosters
          </button>
        )}
      </section>

      {isOwner && competition.status === "upcoming" && (
        <DangerSection competition={competition} tripId={tripId} onDeleted={onDeleted} />
      )}
    </div>
  );
}

// ── Details (name + tagline, inline) ─────────────────────────────────────────

function DetailsSection({
  competition,
  tripId,
  canEdit,
}: {
  competition: Competition;
  tripId: string;
  canEdit: boolean;
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
      if (ctx?.previous) utils.competitions.getByTrip.setData({ tripId }, ctx.previous);
      setError(e.message ?? "Failed to update competition");
    },
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face header reads name/tagline from the faceBootstrap snapshot —
      // re-resolve it so the rename shows without a hard refresh (#10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  const trimmedName = name.trim();
  const dirty = trimmedName !== competition.name || tagline.trim() !== (competition.tagline ?? "");
  const disabled = !canEdit || updateComp.isPending || trimmedName.length < 2 || !dirty;

  return (
    <section className="space-y-3">
      <SectionLabel>Competition details</SectionLabel>
      <div
        className="space-y-4 rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Competition Name <span className="normal-case font-normal">required</span>
          </label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
            readOnly={!canEdit}
            placeholder="e.g. BBMI 2026, The Yert Open"
            maxLength={200}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: canEdit ? 1 : 0.7 }}
            data-testid="comp-settings-name"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Tagline <span className="normal-case font-normal">optional</span>
          </label>
          <input
            value={tagline}
            onChange={(e) => { setTagline(e.target.value); if (error) setError(null); }}
            readOnly={!canEdit}
            placeholder="e.g. May the best team win"
            maxLength={500}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: canEdit ? 1 : 0.7 }}
            data-testid="comp-settings-tagline"
          />
        </div>

        {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}

        {canEdit && (
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
            className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            data-testid="comp-settings-save"
          >
            {updateComp.isPending ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>
    </section>
  );
}

// ── Danger zone (delete) ─────────────────────────────────────────────────────

/** Which danger-zone confirm is open. The escalating ladder, mildest → severest:
 *  reset scoring → reset to skeleton → delete. */
type DangerConfirm = null | "scoring" | "skeleton" | "delete";

function DangerSection({
  competition,
  tripId,
  onDeleted,
}: {
  competition: Competition;
  tripId: string;
  onDeleted?: () => void;
}) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<DangerConfirm>(null);
  const [error, setError] = useState<string | null>(null);

  // Cascade-tally inputs for the delete confirm copy (assignments + games).
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

  // A reset changes results + (for skeleton) config across every game — the board
  // + leaderboard render from the faceBootstrap snapshot, so re-resolve it (#10),
  // plus the child caches other surfaces read directly.
  function invalidateAfterReset() {
    utils.competitions.faceBootstrap.invalidate({ tripId });
    utils.competitions.leaderboard.invalidate({ tripId, competitionId: competition.id });
    utils.games.listByTrip.invalidate({ tripId });
  }

  const resetScoring = trpc.competitions.resetScoring.useMutation({
    onSuccess: () => { invalidateAfterReset(); setConfirm(null); },
    onError: (e) => setError(e.message ?? "Failed to reset scoring"),
  });
  const resetToSkeleton = trpc.competitions.resetToSkeleton.useMutation({
    onSuccess: () => { invalidateAfterReset(); setConfirm(null); },
    onError: (e) => setError(e.message ?? "Failed to reset to skeleton"),
  });
  const deleteComp = trpc.competitions.delete.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face renders from the faceBootstrap snapshot — re-resolve so it
      // returns to the empty/intro state without a hard refresh (#10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
    onSuccess: () => { setConfirm(null); onDeleted?.(); },
    onError: (e) => setError(e.message ?? "Failed to delete competition"),
  });

  const open = (which: DangerConfirm) => { setError(null); setConfirm(which); };

  return (
    <section className="space-y-3">
      <SectionLabel danger>Danger zone</SectionLabel>
      <div
        className="space-y-3 rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        {/* The escalating ladder: clear scores → strip setup → delete. */}
        <DangerRow
          icon={<RotateCcw size={14} />}
          tone="warning"
          label="Reset all scoring"
          blurb="Clears every game's scores. Teams, games, and setup stay — each game is ready to re-score."
          onClick={() => open("scoring")}
          testId="comp-reset-scoring-btn"
        />
        <DangerRow
          icon={<Eraser size={14} />}
          tone="warning"
          label="Reset all games to skeleton"
          blurb="Resets every game to unconfigured. Teams stay; all pairings, courses, handicaps, and scores are cleared."
          onClick={() => open("skeleton")}
          testId="comp-reset-skeleton-btn"
        />
        <DangerRow
          icon={<Trash2 size={14} />}
          tone="danger"
          label="Delete competition"
          blurb="Removes the competition and everything in it — teams, rosters, and games. This can't be undone."
          onClick={() => open("delete")}
          testId="competition-delete-btn"
        />
        {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
      </div>

      {confirm === "scoring" && (
        <DangerConfirmModal
          tone="warning"
          icon={<RotateCcw size={18} />}
          title="Reset all scoring?"
          body="Clears all scores. Teams, games, and setup stay — every game is ready to re-score."
          confirmLabel="Reset scoring"
          pendingLabel="Resetting…"
          isPending={resetScoring.isPending}
          testId="comp-reset-scoring-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resetScoring.mutate({ tripId, competitionId: competition.id })}
        />
      )}
      {confirm === "skeleton" && (
        <DangerConfirmModal
          tone="warning"
          icon={<Eraser size={18} />}
          title="Reset all games to skeleton?"
          body="Resets every game to unconfigured. Teams stay; all pairings, courses, handicaps, and scores are cleared — each game needs setting up again."
          confirmLabel="Reset to skeleton"
          pendingLabel="Resetting…"
          isPending={resetToSkeleton.isPending}
          testId="comp-reset-skeleton-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resetToSkeleton.mutate({ tripId, competitionId: competition.id })}
        />
      )}
      {confirm === "delete" && (
        <DangerConfirmModal
          tone="danger"
          icon={<Trash2 size={18} />}
          title={`Delete “${competition.name}”?`}
          body={`This will delete all teams, events, and groups${describeCascade(teamsCount, gamesCount)}. This cannot be undone.`}
          confirmLabel="Delete Competition"
          pendingLabel="Deleting…"
          isPending={deleteComp.isPending}
          testId="competition-delete-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => deleteComp.mutate({ tripId, competitionId: competition.id })}
        />
      )}
    </section>
  );
}

/** One danger-zone action: a labelled button with a one-line cost blurb above it.
 *  `tone` colors the text/icon (warning = reversible-but-heavy; danger = gone). */
function DangerRow({
  icon, tone, label, blurb, onClick, testId,
}: {
  icon: React.ReactNode;
  tone: "warning" | "danger";
  label: string;
  blurb: string;
  onClick: () => void;
  testId: string;
}) {
  const color = tone === "danger" ? "var(--color-bt-danger)" : "var(--color-bt-warning)";
  return (
    <div>
      <p className="mb-1.5 text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        {blurb}
      </p>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold"
        style={{ background: "transparent", color, border: "1px solid var(--color-bt-border)" }}
        data-testid={testId}
      >
        {icon}
        {label}
      </button>
    </div>
  );
}

function SectionLabel({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <p
      className="px-1 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)" }}
    >
      {children}
    </p>
  );
}

// ── DangerConfirmModal — the one in-app confirm for every danger-zone action ──
// (No window.confirm anywhere — #433.) Cost-naming body, tone-colored icon/CTA.

function DangerConfirmModal({
  tone,
  icon,
  title,
  body,
  confirmLabel,
  pendingLabel,
  isPending,
  testId,
  onCancel,
  onConfirm,
}: {
  tone: "warning" | "danger";
  icon: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  testId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const accent = tone === "danger" ? "var(--color-bt-danger)" : "var(--color-bt-warning)";
  const accentFaint = tone === "danger" ? "var(--color-bt-danger-faint)" : "var(--color-bt-warning-faint)";

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onCancel}
      >
        <div
          className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-5 pb-3 text-center sm:text-left">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
              style={{ background: accentFaint, color: accent }}
            >
              {icon}
            </div>
            <h3 className="mt-3 text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              {title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              {body}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: accent }}
              data-testid={testId}
            >
              {isPending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

function describeCascade(teamAssignments: number, games: number): string {
  const parts: string[] = [];
  if (teamAssignments > 0) parts.push(`${teamAssignments} assignment${teamAssignments === 1 ? "" : "s"}`);
  if (games > 0) parts.push(`${games} game${games === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  return ` (${parts.join(" and ")})`;
}
