"use client";

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { GameLifecycleActions } from "@/components/games/GameLifecycleActions";
import { ScoringStateBanner } from "@/components/games/ScoringStateBanner";
import { PointsAtStake } from "@/components/games/PointsAtStake";
import { useGameFinalize } from "@/hooks/useGameFinalize";
import { useOpenCorrection } from "@/hooks/useGameCorrection";
import { gameLockState } from "@/lib/gameLifecycle";
import { drawComplete } from "@/lib/bracketAdvance";
import type { ResolvedMatch } from "@/lib/bracketAdvance";
import { BracketBoard, type BracketEntrantMeta } from "./BracketBoard";

/**
 * The bracket's scoring surface — the sibling of `NonGolfScoreboard`, not a fifth
 * game view.
 *
 * A bracket is a manual game whose placements are DERIVED rather than typed, so
 * the lifecycle around it — chrome, locks, exit, realtime, settings, go-live — is
 * non-golf's, unchanged, and only what sits between the header and the CTAs
 * swaps. That is the boundary #917 set for phase 3 and this component is the whole
 * of what falls inside it: the board, the pick error, and the same three lifecycle
 * CTAs every other format renders.
 *
 * ── This is the second half of #917 ─────────────────────────────────────────
 * Slice 3 swapped the manual result editor for the board and stopped there, which
 * left a live bracket with no way to finish at all: `NonGolfScoreboard` owned the
 * finalize CTA, and the branch that replaced it rendered none. So the format could
 * be set up, gone live and played to a champion, and then had no button. Splitting
 * the surface out rather than adding CTAs to the branch is what keeps that from
 * happening again — this file has the same shape as the one beside it, so a
 * lifecycle behaviour either is here or is visibly missing.
 *
 * ── What the finalize sends: nothing ────────────────────────────────────────
 * `finalize()` is called with NO placements. The entered-order arm passes them
 * because someone typed them; a bracket's are read off the draw server-side by
 * the same pure rule that renders this board (CLAUDE.md #8). Passing a
 * client-computed order would be a second answer to who won — and `games.finish`
 * ignores `placements` on this arm anyway, so sending them would be a lie that
 * type-checks.
 *
 * Persistence-agnostic it is NOT, deliberately: like `NonGolfScoreboard`, this is
 * the surface that owns the mutations. `BracketBoard` underneath it is the
 * props-and-callbacks component (CLAUDE.md #7).
 */
export function BracketScoringSurface({
  tripId,
  gameId,
  competitionId,
  game,
  matches,
  entrants,
  canEdit,
  onPosted,
}: {
  tripId: string;
  gameId: string;
  /** Null for a standalone game — the board invalidations are skipped. */
  competitionId: string | null;
  game: { status: string; corrections_open: boolean; points_total: number | null };
  /** The RESOLVED draw — advancement already applied by the parent, from the same
   *  `resolveDraw` the pick mutation validates against. */
  matches: ResolvedMatch[];
  entrants: BracketEntrantMeta[];
  canEdit: boolean;
  /** Posted successfully — the page navigates back to the leaderboard. */
  onPosted: () => void;
}) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const { correct: handleCorrect, isPending: correctPending } = useOpenCorrection(
    tripId,
    gameId,
    competitionId,
    setError
  );
  const { finalize, isPending: finalizePending } = useGameFinalize({
    tripId,
    gameId,
    competitionId,
    // The board is redrawn from the draw + the game row, so both need refreshing.
    // `bracketDraw` matters even though the picks did not change: finalize is what
    // freezes them, and the surface reads its lock state from the game row.
    refreshSelf: () => {
      void utils.games.getById.invalidate({ tripId, gameId });
      void utils.games.bracketDraw.invalidate({ tripId, gameId });
    },
    onExit: onPosted,
    // The server's message, inline beside the control that failed — non-golf's
    // considered behaviour, kept rather than flattened to the global toast. It is
    // the one that carries "this bracket still has matches to decide".
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to post"),
  });

  // The SAME shared predicate every other format reads (CLAUDE.md #24), so the
  // board's pickability and the CTA beneath it cannot disagree about whether this
  // game is open: pre-finalize → pickable, LOCKED → not, CORRECTING → pickable
  // again.
  const { isLocked } = gameLockState({ status: game.status, correctionsOpen: game.corrections_open });

  const [pickError, setPickError] = useState<string | null>(null);
  const pickMutation = trpc.games.pickWinner.useMutation({
    // Server truth on both paths — a pick changes what the WHOLE tree derives, so
    // there is nothing useful to patch optimistically and a wrong local guess
    // would be visible three rounds up. The refetch is one small query.
    onSuccess: () => {
      setPickError(null);
      void utils.games.bracketDraw.invalidate({ tripId, gameId });
    },
    onError: (e) => setPickError(e.message),
  });
  const handlePick = useCallback(
    (ref: { bracket: "main" | "consolation"; round: number; slot: number }, seed: number | null) => {
      setPickError(null);
      pickMutation.mutate({ tripId, gameId, ...ref, winnerSeed: seed });
    },
    [pickMutation, tripId, gameId]
  );

  /**
   * Is the bracket finished enough to post? `drawComplete` — the SAME predicate
   * the server's finalize refuses on, so the CTA cannot be live for a state
   * `games.finish` would reject.
   *
   * Note it is not "the final has a winner": a draw carrying a consolation match
   * is unfinished while the play-off is open, and posting there would record two
   * tied thirds for a game about to separate them.
   */
  const allComplete = drawComplete(matches);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-5">
      {/* What the game is worth — same row, same formatter as the other formats,
          so the number here and the board's "N PTS" agree by construction. */}
      <div className="flex justify-end">
        <PointsAtStake value={Number(game.points_total ?? 0)} />
      </div>

      <ScoringStateBanner status={game.status} correctionsOpen={game.corrections_open} />

      <div
        style={{
          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
          color: "var(--color-bt-text-dim)", fontWeight: 700, margin: "2px 0 3px",
        }}
      >
        {canEdit && !isLocked ? "Tap a competitor to advance them" : "Bracket"}
      </div>
      <BracketBoard
        matches={matches}
        entrants={entrants}
        canPick={canEdit && !isLocked}
        onPick={handlePick}
      />
      {pickError && (
        <p style={{ fontSize: 12, color: "var(--color-bt-danger)" }} data-testid="bracket-pick-error">
          {pickError}
        </p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}

      {/* The SAME three lifecycle CTAs every other format renders — `gameLifecycle`
          decides which is offered, this only renders it. `allComplete` is the
          bracket's reading of "there is something to post", and it is the server's
          reading too. */}
      <GameLifecycleActions
        canEdit={canEdit}
        status={game.status}
        correctionsOpen={game.corrections_open}
        allComplete={allComplete}
        finalizePending={finalizePending}
        correctPending={correctPending}
        // No placements: the server derives them from the draw. See the header.
        onFinalize={() => void finalize()}
        onCorrect={handleCorrect}
      />
    </div>
  );
}
