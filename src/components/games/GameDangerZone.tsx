"use client";

import { useState } from "react";
import { RotateCcw, Eraser, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";

/**
 * The per-game danger zone — the escalating ladder ONE LEVEL DOWN from the
 * competition's (CompetitionSettings), reusing the same shared primitives in the
 * TRIP danger-zone pattern (#512): each action is a row (icon + label + one-line
 * description + chevron) that opens a focused confirm sheet.
 *
 *   Reset scores  → games.resetScoring   (clears this game's results; config kept)
 *   Reset settings → games.resetToSkeleton (clears config to a shell; identity +
 *                    per-match point VALUE kept — §E-1)
 *   Delete game   → games.delete
 *
 * THREE actions only — Abandon/Drop was removed at the source (#512 §6a: the
 * `dropped` status was a CC-introduced concept that was never requested; do not
 * re-add a drop/abandon/archive-game capability).
 *
 * Owner-only (the resets are owner-gated server-side; the host renders this only
 * for the owner). The resets call the Phase A primitives (migration 066). After a
 * reset it invalidates the game's own caches AND the faceBootstrap-seeded board
 * (pattern #10) so the page + the leaderboard reflect the cleared state without a
 * hard reload; `onChanged` lets the host refetch its local game query.
 */
export function GameDangerZone({
  tripId,
  gameId,
  competitionId,
  onChanged,
  onDeleted,
  disabled = false,
}: {
  tripId: string;
  gameId: string;
  competitionId: string | null;
  /** Refetch the host's game view after a reset (config/scoring changed). */
  onChanged: () => void;
  /** Game removed — leave the page (back to the board / trip). */
  onDeleted: () => void;
  /** #501: the whole zone is locked while the game is LIVE (scoring mode) — wiping
   *  scores / settings or deleting mid-competition is a terrible UX. Switch back to
   *  Setup (the toggle) to manage the game. Every action row disables. */
  disabled?: boolean;
}) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<"scoring" | "skeleton" | "delete" | null>(null);

  function invalidateAfterReset() {
    void utils.games.getById.invalidate({ tripId, gameId });
    void utils.scores.listByGame.invalidate({ tripId, gameId });
    void utils.matches.listByGame.invalidate({ tripId, gameId });
    void utils.playGroups.listByGame.invalidate({ tripId, gameId });
    void utils.games.listByTrip.invalidate({ tripId });
    if (competitionId) {
      void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      void utils.competitions.faceBootstrap.invalidate({ tripId });
    }
    onChanged();
  }

  const resetScoring = trpc.games.resetScoring.useMutation({
    onSuccess: () => { setConfirm(null); invalidateAfterReset(); },
  });
  const resetToSkeleton = trpc.games.resetToSkeleton.useMutation({
    onSuccess: () => { setConfirm(null); invalidateAfterReset(); },
  });
  const deleteGame = trpc.games.delete.useMutation({
    onSuccess: () => {
      void utils.games.listByTrip.invalidate({ tripId });
      if (competitionId) {
        void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
        void utils.competitions.faceBootstrap.invalidate({ tripId });
      }
      setConfirm(null);
      onDeleted();
    },
  });

  return (
    <section className="mt-8 space-y-3">
      <SectionLabel danger>Danger zone</SectionLabel>
      {disabled && (
        <p className="px-1 text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }} data-testid="danger-zone-locked">
          Locked while the game is live — switch back to Setup to reset or remove it.
        </p>
      )}
      <div className="space-y-2.5">
        <DangerRow
          icon={<RotateCcw size={16} />}
          tone="warning"
          label="Reset scores"
          blurb="Clears scores; pairings, course, handicaps, and points stay."
          onClick={() => setConfirm("scoring")}
          testId="game-reset-scoring-btn"
          disabled={disabled}
        />
        <DangerRow
          icon={<Eraser size={16} />}
          tone="warning"
          label="Reset game settings"
          blurb="Clears the setup; the name and point value are kept."
          onClick={() => setConfirm("skeleton")}
          testId="game-reset-skeleton-btn"
          disabled={disabled}
        />
        <DangerRow
          icon={<Trash2 size={16} />}
          tone="danger"
          label="Delete game"
          blurb="Removes the game and everything in it. This can’t be undone."
          onClick={() => setConfirm("delete")}
          testId="game-delete-btn"
          disabled={disabled}
        />
      </div>

      {confirm === "scoring" && (
        <DangerConfirmModal
          tone="warning"
          icon={<RotateCcw size={18} />}
          title="Reset this game's scores?"
          body="Clears all scores for this game. Pairings, course, handicaps, and points stay — it's ready to re-score."
          confirmLabel="Reset scores"
          pendingLabel="Resetting…"
          isPending={resetScoring.isPending}
          testId="game-reset-scoring-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resetScoring.mutate({ tripId, gameId })}
        />
      )}
      {confirm === "skeleton" && (
        <DangerConfirmModal
          tone="warning"
          icon={<Eraser size={18} />}
          title="Reset this game to skeleton?"
          body="Resets this game to unconfigured — pairings, course, handicaps, and scores are cleared. The name and point value stay; you'll set it up again."
          confirmLabel="Reset settings"
          pendingLabel="Resetting…"
          isPending={resetToSkeleton.isPending}
          testId="game-reset-skeleton-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => resetToSkeleton.mutate({ tripId, gameId })}
        />
      )}
      {confirm === "delete" && (
        <DangerConfirmModal
          tone="danger"
          icon={<Trash2 size={18} />}
          title="Delete this game?"
          body="This removes the game and all its pairings, scores, and results. This cannot be undone."
          confirmLabel="Delete game"
          pendingLabel="Deleting…"
          isPending={deleteGame.isPending}
          testId="game-delete-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => deleteGame.mutate({ tripId, gameId })}
        />
      )}
    </section>
  );
}
