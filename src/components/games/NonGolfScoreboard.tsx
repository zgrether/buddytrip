"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import {
  ManualPlacementEditor,
  type GameRow,
  type LBTeamLite,
} from "@/components/competition/CompetitionGamesPanel";
import { OutcomeChoiceRow } from "./OutcomeChoiceRow";
import { GameLifecycleActions } from "./GameLifecycleActions";
import { ScoringStateBanner } from "./ScoringStateBanner";
import { gameLockState } from "@/lib/gameLifecycle";
import { useOpenCorrection, useMarkGameLocked } from "@/hooks/useGameCorrection";
import { PointsAtStake } from "./PointsAtStake";
import type { ScoringModel } from "@/lib/gameTypes";
import { placementsFrom } from "@/lib/placementGroups";

/**
 * NonGolfScoreboard — the scoring-mode body of the non-golf scoreboard page
 * (W-NONGOLF lifecycle surface). This is the **promoted post-results modal**: the
 * old `RunSheet` body, lifted out of the modal to become the live board you land
 * on from the leaderboard. It owns its own post like the modal did (the non-golf
 * world keeps tRPC in the surface — these aren't the pure golf scorecard
 * components), branching the result editor on the competition's `scoring_model`:
 *  - **match_play** (head-to-head, 2 teams): the declared-outcome control
 *    (Part 3 gives it Team-A-vs-B framing + points-in-play).
 *  - **points** / >2 teams: the finishing-order placement editor (#430).
 *
 * Posting feeds `games.finish` — the ONE finalize for every format — as its
 * manual (`result_strategy: null`) arm: winner→pos 1 / tie→both pos 1 /
 * placement order, no second points mechanism. It used to call `games.post`, a
 * separate procedure that ran the same dispatch and the same lock; that fork is
 * gone. The user-facing verb here stays "Post" — non-golf results are posted,
 * and the procedure name is not the UI copy. Members get the read-only board;
 * the post CTA is owner/delegate-only (the server enforces it too).
 */
export function NonGolfScoreboard({
  tripId,
  competitionId,
  game,
  teams,
  scoringModel,
  initialOrder,
  initialResult,
  canEdit,
  onPosted,
}: {
  tripId: string;
  competitionId: string;
  game: GameRow;
  teams: LBTeamLite[];
  scoringModel: ScoringModel;
  /** Seed order for the placement editor (posted cells when correcting, else roster). */
  initialOrder: string[];
  /** Seed declared outcome for the match control — a team id (that side won) or
   *  "tie", derived from the posted cells (a draw = both at place 1). */
  initialResult?: string;
  canEdit: boolean;
  /** Posted successfully — the page navigates back to the leaderboard. */
  onPosted: () => void;
}) {
  const utils = trpc.useUtils();
  // Head-to-head win/lose/tie is a manual match-play game with exactly two sides;
  // anything else (points model, >2 teams) keeps the finishing-order editor.
  const winLoseTie = scoringModel === "match_play" && teams.length === 2;
  const dist = game.points_distribution?.type === "placement" ? game.points_distribution.values : [];

  const [order, setOrder] = useState<string[]>(initialOrder.length ? initialOrder : teams.map((t) => t.id));
  // Teams tied with the row ABOVE. Non-golf produces genuine ties (cornhole,
  // euchre) and a drag list expresses a strict sequence, so the tie is a separate
  // explicit toggle rather than a second meaning overloaded onto the drop target.
  // `placementPoints` already pools and splits the shared places, so the game's
  // total is preserved by construction — there is nothing to validate here.
  const [tiedWithPrev, setTiedWithPrev] = useState<ReadonlySet<string>>(new Set());
  // Start with NO outcome selected on a fresh game so nothing reads as
  // pre-decided (and the Post button stays disabled until the user picks).
  // When correcting a posted game, seed from the recorded outcome.
  const [result, setResult] = useState<string>(() => initialResult ?? "");
  const [error, setError] = useState<string | null>(null);

  const finishGame = trpc.games.finish.useMutation();
  const { correct: handleCorrect, isPending: correctPending } = useOpenCorrection(
    tripId,
    game.id,
    competitionId,
    setError
  );
  const markLocked = useMarkGameLocked(tripId, game.id);
  const busy = finishGame.isPending;

  /**
   * Editable = the role MAY edit AND the game's lifecycle allows it right now.
   *
   * `canEdit` alone is a ROLE answer. An owner on a posted game still had live
   * placement buttons: the highlight moved, nothing was saved, and the next render
   * put it back — worse than a disabled control, because it looked like the change
   * had taken. Members were already correct, purely because they fail the role
   * half.
   *
   * `gameLockState` is the same shared predicate `GameLifecycleActions` reads, so
   * the buttons and the CTA beneath them can't disagree about whether this game is
   * open: pre-finalize → editable, LOCKED (complete, corrections closed) → not,
   * CORRECTING (complete, corrections open) → editable again.
   *
   * No permission changed — `canEdit` arrives exactly as before and is only ANDed
   * with lifecycle state.
   */
  const { isLocked } = gameLockState({
    status: game.status,
    correctionsOpen: game.corrections_open,
  });
  const editable = canEdit && !isLocked;

  /**
   * Reopening a posted game for editing — the step non-golf never had — now runs
   * through the SHARED `useOpenCorrection`, which is where the invalidation set
   * (#10: `faceBootstrap` too, not just the game row) and the optimistic flip
   * both live. This view's private copy is gone; see the hook for why the flip
   * is safe and why the rollback is a refetch rather than a snapshot.
   */

  function teamById(id: string) {
    return teams.find((t) => t.id === id);
  }
  function toggleTie(teamId: string) {
    setTiedWithPrev((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  async function commit() {
    setError(null);
    try {
      const placements = winLoseTie
        ? result === "tie"
          ? teams.map((t) => ({ entityId: t.id, position: 1 }))
          : teams.map((t) => ({ entityId: t.id, position: t.id === result ? 1 : 2 }))
        // Tied teams share a position — `writeManualResults` has never required
        // positions to be unique, and the leaderboard reads `position` as the
        // standing value, so equal positions arrive at `placementPoints` as a
        // real tie group and are paid the pooled share.
        : placementsFrom(order, tiedWithPrev);
      await finishGame.mutateAsync({ tripId, gameId: game.id, placements });
      // The symmetric half of `useOpenCorrection`'s optimistic flip. `game` here
      // is a prop, but it is read from the same `games.getById` entry one level
      // up (`NonGolfGameView`), so this is the same cache and the same window.
      markLocked();
      utils.games.listByTrip.invalidate({ tripId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      // The Live face seeds its board from faceBootstrap — invalidate it so the
      // posted result lands without a hard refresh (CLAUDE.md #10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-5">
      {/* What the game is worth — the board has always shown this and the game
          surface never did, so the person deciding whether this matters couldn't
          see it. `points_total` is the SAME field the board's "N PTS" reads, via
          the same formatter, so the two numbers agree by construction. */}
      <div className="flex justify-end">
        <PointsAtStake value={Number(game.points_total ?? 0)} />
      </div>

      {/* Non-golf had NO lifecycle banner and no state label of any kind — the
          only tell that a posted game had been re-opened was the placement
          controls becoming live again (#833). Same shared component, same words
          and tone as the other three formats. Reads the same two columns the
          `gameLockState` call above already uses. */}
      <ScoringStateBanner status={game.status} correctionsOpen={game.corrections_open} />
      {/* `canEdit` now reaches the outcome rows themselves. It used to be
          expressed by handing them a no-op `onPick`, which leaves three
          live-looking, focusable controls that silently do nothing for a member. */}
      {winLoseTie ? (
        <NonGolfMatchControl
          teams={teams}
          result={result}
          onPick={setResult}
          canEdit={editable}
        />
      ) : (
        <ManualPlacementEditor
          order={order}
          dist={dist}
          teamById={teamById}
          canEdit={editable}
          onReorder={setOrder}
          tiedWithPrev={tiedWithPrev}
          onToggleTie={toggleTie}
        />
      )}

      {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}

      {/* The SAME lifecycle CTAs golf renders. Non-golf carried its own single
          button, which is why it looked and behaved differently: one bright
          warning-toned control the moment a game was posted, with no muted
          "Correct a score" step and no explicit correcting state. `gameLifecycle`
          decides which of the three is offered; this component only renders it,
          so the two can no longer drift.
          `allComplete` for non-golf means "an outcome has been chosen" — the
          placement editor always carries an order, so only the win/lose/tie
          control can be genuinely unanswered. That replaces the old inline
          `disabled={winLoseTie && !result}`. */}
      <GameLifecycleActions
        canEdit={canEdit}
        status={game.status}
        correctionsOpen={game.corrections_open}
        allComplete={!winLoseTie || !!result}
        finalizeLabel="Save results"
        finalizePendingLabel="Saving results…"
        finalizePending={busy}
        correctPending={correctPending}
        onFinalize={commit}
        onCorrect={handleCorrect}
      />
    </div>
  );
}

/**
 * NonGolfMatchControl — the declared-outcome control for a non-golf head-to-head,
 * using the SAME three-choice entry as golf's hole-outcome entry (the shared
 * `OutcomeChoiceRow`): Team A / Halved / Team B, tap-to-select, team-colored with
 * a ✓ and the other rows dimmed. It stops at SELECTION — nothing posts on tap;
 * the board's "Save results" button below commits. Starts unselected (nothing
 * pre-decided) and the outcome feeds the existing path (a team id = that side
 * won; "tie" = halved/split).
 */
function NonGolfMatchControl({
  teams, result, onPick, canEdit,
}: {
  teams: LBTeamLite[]; result: string; onPick: (r: string) => void; canEdit: boolean;
}) {
  const [a, b] = teams;
  const aId = a?.id ?? "";
  const bId = b?.id ?? "";
  const anySelected = result !== "";

  return (
    <div role="radiogroup" aria-label="Match outcome" className="flex flex-col" style={{ gap: 9 }}>
      <OutcomeChoiceRow
        selected={result === aId}
        dim={anySelected && result !== aId}
        color={a?.color}
        avatarName={a?.name}
        label={a?.name ?? "Team A"}
        onClick={() => onPick(aId)}
        disabled={!canEdit}
        testId={`match-win-${aId}`}
      />
      <OutcomeChoiceRow
        selected={result === "tie"}
        dim={anySelected && result !== "tie"}
        neutral
        label="Halved"
        onClick={() => onPick("tie")}
        disabled={!canEdit}
        testId="match-draw"
      />
      <OutcomeChoiceRow
        selected={result === bId}
        dim={anySelected && result !== bId}
        color={b?.color}
        avatarName={b?.name}
        label={b?.name ?? "Team B"}
        onClick={() => onPick(bId)}
        disabled={!canEdit}
        testId={`match-win-${bId}`}
      />
    </div>
  );
}
