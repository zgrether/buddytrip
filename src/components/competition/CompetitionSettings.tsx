"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
  const [confirming, setConfirming] = useState(false);

  // Cascade-tally inputs for the confirm copy (assignments + competition games).
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

  const deleteComp = trpc.competitions.delete.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The face renders from the faceBootstrap snapshot — re-resolve so it
      // returns to the empty/intro state without a hard refresh (#10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
    onSuccess: () => {
      setConfirming(false);
      onDeleted?.();
    },
  });

  return (
    <section className="space-y-3">
      <SectionLabel danger>Danger zone</SectionLabel>
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          Deleting removes the competition and everything in it — teams, rosters, and games. This can&rsquo;t be undone.
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold"
          style={{ background: "transparent", color: "var(--color-bt-danger)", border: "1px solid var(--color-bt-border)" }}
          data-testid="competition-delete-btn"
        >
          <Trash2 size={14} />
          Delete competition
        </button>
      </div>

      {confirming && (
        <DeleteCompetitionConfirmModal
          competitionName={competition.name}
          teamsCount={teamsCount}
          gamesCount={gamesCount}
          isPending={deleteComp.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => deleteComp.mutate({ tripId, competitionId: competition.id })}
        />
      )}
    </section>
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

// ── DeleteCompetitionConfirmModal (relocated from the header) ─────────────────

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
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-5 pb-3 text-center sm:text-left">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
              style={{ background: "var(--color-bt-danger-faint)", color: "var(--color-bt-danger)" }}
            >
              <Trash2 size={18} />
            </div>
            <h3 className="mt-3 text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              Delete &ldquo;{competitionName}&rdquo;?
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              This will delete all teams, events, and groups{summary}. This cannot be undone.
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
              style={{ background: "var(--color-bt-danger)" }}
              data-testid="competition-delete-confirm"
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
  const parts: string[] = [];
  if (teamAssignments > 0) parts.push(`${teamAssignments} assignment${teamAssignments === 1 ? "" : "s"}`);
  if (games > 0) parts.push(`${games} game${games === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  return ` (${parts.join(" and ")})`;
}
