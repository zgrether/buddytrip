"use client";

import { useCallback, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { GameLifecycleActions } from "@/components/games/GameLifecycleActions";
import { ScoringStateBanner } from "@/components/games/ScoringStateBanner";
import { useGameFinalize } from "@/hooks/useGameFinalize";
import { useOpenCorrection } from "@/hooks/useGameCorrection";
import { gameLockState } from "@/lib/gameLifecycle";
import { applyPickCascadingWith, drawComplete, resolveDraw, type WinnerBySeed } from "@/lib/bracketAdvance";
import type { BracketDrawMatch } from "@/lib/bracket";
import type { BracketSide } from "@/lib/bracket";
import type { MatchStakes } from "@/lib/bracketStakes";
import type { ResolvedMatch } from "@/lib/bracketAdvance";
import { BracketBoard, type BracketEntrantMeta } from "./BracketBoard";

/**
 * The READABLE COLUMN — everything on this surface that is prose or a control.
 *
 * `contentArea.ts` (#906) is explicit that a surface may still cap its own
 * column for readability even though the shell no longer caps the viewport, and
 * a points row, a banner and three CTAs all want that cap. The BOARD does not:
 * it is a tree, and its natural width is the field's.
 *
 * Declared at module scope, not inside the component. A component created during
 * render is a NEW component type every render, so React unmounts and remounts
 * its whole subtree and any state inside it resets — which here would have meant
 * the lifecycle CTAs losing their pending state on every keystroke elsewhere on
 * the surface. (Caught by eslint, not by me.)
 */
function Column({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">{children}</div>;
}

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
  pointsDistribution,
  stakesFor,
  mustWin,
  resolve,
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
  /** The game's placement split, for the per-match stakes. Empty = no per-place
   *  values, and the headers quote nothing. */
  pointsDistribution: readonly number[];
  /** Format-supplied, so neither this surface nor the board asks which format it is
   *  rendering. Absent → the board's single-elim defaults. */
  stakesFor?: (m: ResolvedMatch) => MatchStakes | null;
  /** How to resolve the draw — supplied by the caller so the optimistic cascade uses the
   *  SAME walk the board rendered with. Absent → single elim. */
  resolve?: (draw: BracketDrawMatch[], winners: WinnerBySeed) => ResolvedMatch[];
  mustWin?: (seed: number) => boolean;
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

  /**
   * How many picks are still in flight. Only the LAST one reconciles, so a burst
   * of taps costs one refetch instead of one per tap.
   *
   * ── What this does NOT do, corrected ────────────────────────────────────────
   * This comment used to claim the counter was "not about saving requests; it is
   * about never letting a stale response overwrite a newer local truth." It
   * cannot do that, and never did. It gates whether a NEW reconcile is ISSUED. A
   * refetch ALREADY IN FLIGHT is untouched by it — and `reconcile`'s deliberate
   * `cancelRefetch: false` guarantees such a fetch is left to finish and its data
   * lands (`invalidateCancelsRefetch.test.ts`). So the exact scenario described —
   * "the first pick's refetch is already on the wire when the second is applied
   * optimistically, and it lands carrying server state that predates the second"
   * — was not prevented here. It was the change-a-winner flash, and it is fixed
   * in `handlePick` by cancelling in-flight fetches before the optimistic write.
   *
   * Saving requests is a real benefit and worth keeping; it was just described as
   * something stronger than it is.
   */
  const pendingPicks = useRef(0);
  const reconcile = useCallback(() => {
    // `cancelRefetch: false` — a second invalidation during an in-flight refetch
    // otherwise CANCELS it and the first response never reaches the cache
    // (verified mechanism, `src/lib/invalidateCancelsRefetch.test.ts`).
    void utils.games.bracketDraw.invalidate({ tripId, gameId }, undefined, { cancelRefetch: false });
  }, [utils, tripId, gameId]);

  const pickMutation = trpc.games.pickWinner.useMutation({
    onSuccess: () => setPickError(null),
    // A REFUSED pick must roll back visibly, immediately — a check-mark that
    // appears and silently stays after the server said no is worse than one that
    // took 800ms to arrive. Re-pulling server truth IS the rollback (CLAUDE.md
    // #1: invalidate as rollback, never an onMutate snapshot-restore).
    onError: (e) => {
      setPickError(e.message);
      reconcile();
    },
    onSettled: () => {
      pendingPicks.current = Math.max(0, pendingPicks.current - 1);
      if (pendingPicks.current === 0) reconcile();
    },
  });

  /**
   * Tap → mark, with no round trip in between.
   *
   * ── Why this is safe to guess, when the header used to say it wasn't ───────
   * The previous note here argued there was "nothing useful to patch
   * optimistically" because a pick changes what the whole tree derives. That is
   * true and is exactly why the patch is safe: we write the ONE column the
   * server writes — `winnerSeed` on one match — and everything downstream is
   * DERIVED from it by `resolveDraw`, which the parent already runs over this
   * cache. So the optimistic value goes through the same advancement, the same
   * `winnerOf` drop-rule and the same placement maths as a fetched one. There is
   * no second code path to disagree with, which is what makes the guess honest
   * rather than a local imitation of the server.
   *
   * ── The optimistic patch CASCADES too, and it has to ──────────────────────
   * `applyPickCascading` is the same function the server runs to decide which
   * stored picks a pick orphans, so the client deletes exactly what the server
   * is about to delete. Using the non-cascading `applyPick` here would have made
   * the two disagree for a whole round trip — and the disagreement would have
   * been visible as the flash this reversal exists to remove: the optimistic
   * write showing the cleared state, then the server's response reinstating the
   * orphan for the rest of the round trip.
   *
   * Both invariants therefore hold for free rather than by re-implementation:
   *   - #924's stale-winner rule — a seed that is not a resolved occupant is
   *     dropped by `winnerOf`, so an optimistic pick into a match whose feeders
   *     moved still reads undecided.
   *   - the CASCADE (which REVERSES #925) — an orphaned pick is deleted here
   *     exactly as it is server-side, so re-picking the original brings nothing
   *     back on either side.
   *
   * What it buys: the measured cost of a pick in production is ~806ms, and the
   * check-mark used to wait for all of it. It now waits for a state update.
   */
  const handlePick = useCallback(
    (ref: { bracket: BracketSide; round: number; slot: number }, seed: number | null) => {
      setPickError(null);
      /**
       * CANCEL BEFORE WRITING — the fix for the change-a-winner flash.
       *
       * A refetch already on the wire predates this tap by definition, so it
       * cannot carry newer truth. `reconcile()` deliberately passes
       * `cancelRefetch: false` (so a reconcile never throws away a response it
       * asked for), which means such a fetch is left alone AND ITS DATA LANDS —
       * verified in `invalidateCancelsRefetch.test.ts`. Landing after this
       * setData, it reinstates exactly what the cascade just cleared.
       *
       * That is the reported symptom: "when you change the winner of a match and
       * it has to clear out the old results, sometimes they clear and switch to
       * the new winner/loser, but sometimes they flash the old ones briefly."
       * The "sometimes" is whether a reconcile was still in flight — a render bug
       * is not intermittent, a race is. A CHANGE shows it and a first pick does
       * not, because a change is the case where the optimistic write REMOVES
       * things: a stale response reinstating a whole cleared subtree across both
       * brackets is loud, one reinstating "no winner yet" is invisible.
       *
       * `pendingPicks` below does NOT cover this, despite its comment claiming to
       * ("never letting a stale response overwrite a newer local truth"). It gates
       * whether a NEW reconcile is ISSUED; it has no effect on a fetch already in
       * flight. The invariant was stated but never implemented — this line is what
       * implements it.
       *
       * NOT awaited, on purpose: cancellation dispatches synchronously and only
       * its promise settles later, so the mark still paints in this tick. A pick
       * costs ~806ms in production, which is the entire reason for the optimistic
       * patch — do not make this handler `async`.
       *
       * Orthogonal to CLAUDE.md #1, which governs ROLLBACK (invalidate and re-pull,
       * never an onMutate snapshot-restore). That is unchanged; this only decides
       * which response is allowed to win.
       */
      void utils.games.bracketDraw.cancel({ tripId, gameId });
      utils.games.bracketDraw.setData({ tripId, gameId }, (prev) =>
        prev && applyPickCascadingWith(prev, ref, seed, resolve ?? resolveDraw)
      );
      pendingPicks.current += 1;
      pickMutation.mutate({ tripId, gameId, ...ref, winnerSeed: seed });
    },
    // `resolve` belongs here: it selects WHICH walk the optimistic cascade runs, so a
    // stale closure would cascade a double-elim pick through the single-elim resolver.
    [pickMutation, utils, tripId, gameId, resolve]
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
    // Full width, and the cap moved INSIDE. The whole surface used to sit in one
    // `max-w-2xl` box, so a 16-entrant draw scrolled inside a 672px column while
    // the desktop page had room to spare — the mid-page scrollbar. Nothing above
    // this was constraining it: the shell is `lg:max-w-none` and the game panel
    // is `lg:w-full lg:flex-1`. The cap was ours, and it was being applied to the
    // one piece of content that should never have been in the readable column.
    <div className="flex w-full flex-col gap-3 px-4 py-5">
      <Column>
        {/* The value used to sit in a bare `PointsAtStake` row above this, with no
            container — it is IN the banner now, which is the one place a game
            says what it is worth. Two homes for one number is how they drift. */}
        <ScoringStateBanner
          status={game.status}
          correctionsOpen={game.corrections_open}
          pointsTotal={game.points_total}
        />

        {/* No label row at all now.
            "BRACKET" named the surface on a screen that is visibly a bracket,
            and "TAP A COMPETITOR TO ADVANCE THEM" narrated an affordance the
            board already carries — the rows are buttons, the winner takes a
            check. Both were text explaining what was already visible, so the
            line is gone rather than reworded. */}
      </Column>

      <BracketBoard
        matches={matches}
        entrants={entrants}
        pointsDistribution={pointsDistribution}
        stakesFor={stakesFor}
        mustWin={mustWin}
        canPick={canEdit && !isLocked}
        onPick={handlePick}
      />

      <Column>
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
      </Column>
    </div>
  );
}
