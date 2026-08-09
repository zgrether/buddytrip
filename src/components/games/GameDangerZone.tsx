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
 * hard reload; `onChanged` lets the host refetch its local game query, and
 * `onScoresReset` (REQUIRED) drops what it holds locally.
 *
 * **Available in every game state.** There is no `disabled` prop: the zone used
 * to lock itself while scoring was live (#501) and no longer does — see the note
 * at the render site for why the confirmation, not a hidden mode change, is what
 * guards these. `reset_game_scoring` (migration 066) returns the game to
 * `status = 'pending'` with `corrections_open = false` and `scoring_enabled`
 * KEPT, from `active` OR `complete` alike (its only exclusion is the retired
 * `dropped`), so resetting a finalized game lands it back at ready-to-score
 * rather than in a state nothing can leave.
 */
export function GameDangerZone({
  tripId,
  gameId,
  competitionId,
  onChanged,
  onDeleted,
  onScoresReset,
}: {
  tripId: string;
  gameId: string;
  competitionId: string | null;
  /** Refetch the host's game view after a reset (config/scoring changed). */
  onChanged: () => void;
  /** Game removed — leave the page (back to the board / trip). */
  onDeleted: () => void;
  /**
   * Scores were wiped server-side — drop whatever the host is holding locally.
   *
   * **REQUIRED, and that is the fix.** Deliberately SEPARATE from `onChanged`,
   * which fires for ordinary config changes too; clearing the board's scores on
   * a tee-time edit would be worse than the bug this fixes. Invalidation alone
   * is not enough — the server answering "there are no scores" is expressed as
   * ABSENCE, and every local model here ignores absence: `reconcileScores`
   * overlays server values onto local ones (#807), and non-golf's result drafts
   * are null-sentinels that fall back to the server mirror only while untouched.
   * Either way the old scores stay on screen until the view remounts.
   *
   * It was optional, and non-golf simply never passed it — the eleventh instance
   * of the divergence CLAUDE.md #24 describes. Making it required means the next
   * format cannot be wired without answering "what does reset mean here?", so
   * the omission is a compile error instead of a bug report.
   */
  onScoresReset: () => void;
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
    onScoresReset?.();
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
      {/* ── No `disabled`. This REVERSES #501, deliberately. ─────────────────
          #501 locked the whole zone while the game was live, reasoning that
          wiping scores or deleting mid-competition is a terrible UX. The
          terrible UX is real; locking the zone is not what prevents it.

          What #501's lock actually does is make the destructive action
          UNREACHABLE until you find an unrelated, non-obvious state change —
          flip the game back to Setup mode first. Nobody guesses that. The
          concrete case: a mate messes with the app before the round, someone
          wants to clear the bogus scores, and the only visible answer is a
          greyed-out row with no explanation of what would un-grey it.

          Answering #501 on its own terms: the mis-tap it worried about is
          already covered by the confirmation sheet, which names the cost in
          full before anything happens. That is the gate that works, because
          it appears at the moment of the mistake. The hidden state change
          covers nothing — it deters the confused, not the careless. Three
          gates remain (owner/organizer role, the danger zone's own row→confirm
          friction, and the cost-naming confirm); a fourth that nobody can
          discover is not protection, it is a dead end. */}
      <SectionLabel danger>Danger zone</SectionLabel>
      <div className="space-y-2.5">
        <DangerRow
          icon={<RotateCcw size={16} />}
          tone="warning"
          label="Reset scores"
          blurb="Clears scores; pairings, course, handicaps, and points stay."
          onClick={() => setConfirm("scoring")}
          testId="game-reset-scoring-btn"
        />
        <DangerRow
          icon={<Eraser size={16} />}
          tone="warning"
          label="Reset game settings"
          blurb="Clears the setup; the name and point value are kept."
          onClick={() => setConfirm("skeleton")}
          testId="game-reset-skeleton-btn"
        />
        <DangerRow
          icon={<Trash2 size={16} />}
          tone="danger"
          label="Delete game"
          blurb="Removes the game and everything in it. This can’t be undone."
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
