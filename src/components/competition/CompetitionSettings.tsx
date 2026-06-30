"use client";

import { useState } from "react";
import { Trash2, RotateCcw, Eraser } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";

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
  /** Fired after the owner deletes the competition (host resets its flag). */
  onDeleted?: () => void;
}

/**
 * CompetitionSettings — competition META + danger zone. Reached from the header
 * gear. Two sections:
 *   1. Details   — name + tagline, inline-edited (was the header pencil modal)
 *   2. Danger    — reset / delete the competition (owner + pre-live)
 *
 * Team management is NO LONGER here — it moved to the member-visible Rosters
 * overlay opened from the leaderboard header (W-TEAMSURFACE-01), where roster
 * editing is live + drag-based rather than form-and-save.
 *
 * STANDARD PALETTE ONLY — no competition accent / tonal shift.
 */
export function CompetitionSettings({
  competition,
  tripId,
  canEdit,
  isOwner,
  onDeleted,
}: Props) {
  return (
    <div className="space-y-6">
      <DetailsSection competition={competition} tripId={tripId} canEdit={canEdit} />

      {/* Danger zone is the owner's reset/delete hatch — it must be reachable at
          ALL times, not just pre-live. (Was gated to `status === "upcoming"`,
          which stranded an active competition with no in-app reset/delete — the
          live BBMI Cup hit exactly this.) Delete-and-restart is the supported
          recovery path, so the owner always sees it. */}
      {isOwner && (
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

  // A reset changes results + (for skeleton) config across every game. Two layers
  // of cache to clear:
  //  1. Board surfaces render from the faceBootstrap snapshot (#10) → re-resolve
  //     it + the child caches other board surfaces read directly.
  //  2. Per-GAME surfaces — the score-entry / scorecard / match pages read
  //     games.getById + scores/matches/playGroups.listByGame, which the board
  //     PREFETCHES on row hover (fresh for the 60s staleTime). Without clearing
  //     these, opening a game after a reset shows its OLD scores + pairings until
  //     the staleTime expires (the 15-30s lag). Invalidate every cached instance
  //     (all gameIds) so an opened game refetches the cleared state on mount.
  function invalidateAfterReset() {
    utils.competitions.faceBootstrap.invalidate({ tripId });
    utils.competitions.leaderboard.invalidate({ tripId, competitionId: competition.id });
    utils.games.listByTrip.invalidate({ tripId });
    utils.games.getById.invalidate();
    utils.scores.listByGame.invalidate();
    utils.matches.listByGame.invalidate();
    utils.playGroups.listByGame.invalidate();
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

function describeCascade(teamAssignments: number, games: number): string {
  const parts: string[] = [];
  if (teamAssignments > 0) parts.push(`${teamAssignments} assignment${teamAssignments === 1 ? "" : "s"}`);
  if (games > 0) parts.push(`${games} game${games === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  return ` (${parts.join(" and ")})`;
}
