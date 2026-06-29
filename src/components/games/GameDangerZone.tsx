"use client";

import { useState } from "react";
import { RotateCcw, Eraser, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";

/**
 * The per-game danger zone — the escalating ladder ONE LEVEL DOWN from the
 * competition's (CompetitionSettings), reusing the same shared primitives:
 *
 *   Reset scores  → games.resetScoring   (clears this game's results; config kept)
 *   Reset settings → games.resetToSkeleton (clears config to a shell; identity +
 *                    per-match point VALUE kept — §E-1)
 *   Delete game   → games.delete
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
  status,
  onChanged,
  onDeleted,
}: {
  tripId: string;
  gameId: string;
  competitionId: string | null;
  /** The game's status — drives Drop vs Restore (A2-ux: Drop/abandon's home). */
  status?: string | null;
  /** Refetch the host's game view after a reset (config/scoring changed). */
  onChanged: () => void;
  /** Game removed — leave the page (back to the board / trip). */
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<"scoring" | "skeleton" | "drop" | "delete" | null>(null);
  const isDropped = status === "dropped";

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
  // A2-ux: Drop/abandon (status ⇄ dropped) — reversible archive, excluded from the
  // leaderboard roll-up. Its ONLY home was the Edit modal; bringing it here (the one
  // settings surface) unblocks retiring that modal. Restore is safe (no confirm).
  const setStatus = trpc.games.setStatus.useMutation({
    onSuccess: () => { setConfirm(null); invalidateAfterReset(); },
  });

  return (
    <section className="mt-8 space-y-3">
      <SectionLabel danger>Danger zone</SectionLabel>
      <div
        className="space-y-3 rounded-xl p-4"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <DangerRow
          icon={<RotateCcw size={14} />}
          tone="warning"
          label="Reset scores"
          blurb="Clears this game's scores. Pairings, course, handicaps, and points stay — the game is ready to re-score."
          onClick={() => setConfirm("scoring")}
          testId="game-reset-scoring-btn"
        />
        <DangerRow
          icon={<Eraser size={14} />}
          tone="warning"
          label="Reset game settings"
          blurb="Resets this game to unconfigured. Pairings, course, handicaps, and scores are cleared; the name and point value stay."
          onClick={() => setConfirm("skeleton")}
          testId="game-reset-skeleton-btn"
        />
        {isDropped ? (
          <DangerRow
            icon={<ArchiveRestore size={14} />}
            tone="warning"
            label="Restore game"
            blurb="Brings this abandoned game back onto the board. Its pairings and any scores are intact."
            onClick={() => setStatus.mutate({ tripId, gameId, status: "pending" })}
            testId="game-restore-btn"
          />
        ) : (
          <DangerRow
            icon={<Archive size={14} />}
            tone="warning"
            label="Abandon game"
            blurb="Pulls this game from the board without deleting it — keeps it and its scores, hidden from the standings. Reversible."
            onClick={() => setConfirm("drop")}
            testId="game-drop-btn"
          />
        )}
        <DangerRow
          icon={<Trash2 size={14} />}
          tone="danger"
          label="Delete game"
          blurb="Removes this game and everything in it — pairings, scores, and results. This can't be undone."
          onClick={() => setConfirm("delete")}
          testId="game-delete-btn"
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
      {confirm === "drop" && (
        <DangerConfirmModal
          tone="warning"
          icon={<Archive size={18} />}
          title="Abandon this game?"
          body="Pulls it from the board and the standings without deleting it — the game and any scores are kept and can be restored later."
          confirmLabel="Abandon game"
          pendingLabel="Abandoning…"
          isPending={setStatus.isPending}
          testId="game-drop-confirm"
          onCancel={() => setConfirm(null)}
          onConfirm={() => setStatus.mutate({ tripId, gameId, status: "dropped" })}
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
