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
import { useOpenCorrection } from "@/hooks/useGameCorrection";
import { useGameFinalize } from "@/hooks/useGameFinalize";
import { PointsAtStake } from "./PointsAtStake";
import type { ScoringModel } from "@/lib/gameTypes";
import { isMatchesGame } from "@/lib/resultStrategy";
import { MatchesScoreboard, type MatchScoreRow } from "./MatchesScoreboard";
import { PickemFinalizePrompt } from "./pickem/PickemFinalizePrompt";

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
  order,
  onReorder,
  tiedWithPrev,
  onToggleTie,
  result,
  onPick,
  placements,
  matches,
  onMatchResultPick,
  canEdit,
  onPosted,
}: {
  tripId: string;
  competitionId: string;
  game: GameRow;
  teams: LBTeamLite[];
  scoringModel: ScoringModel;
  /**
   * ── CONTROLLED result entry ───────────────────────────────────────────────
   * This component used to own the outcome selection as local state, seeded from
   * `initialOrder`/`initialResult`. It doesn't any more, because the header
   * PROJECTION is drawn by the parent and a projection cannot react to state it
   * cannot see — picking a winner moved these buttons and nothing else.
   *
   * The parent (`NonGolfGameView`) holds the state, derives the projection from
   * it the way golf does, and hands the postable payload back down as
   * `placements`. Nothing here writes on selection; `onPick`/`onReorder` are
   * pure state lifts and the commit is still the explicit CTA below.
   */
  /** Finishing order for the placement editor. */
  order: string[];
  onReorder: (next: string[]) => void;
  /** Teams tied with the row above. */
  tiedWithPrev: ReadonlySet<string>;
  onToggleTie: (teamId: string) => void;
  /** Declared outcome for the match control — a team id (that side won), "tie",
   *  or "" for nothing picked yet. */
  result: string;
  onPick: (next: string) => void;
  /** Exactly what `commit` posts, built by the parent so the projection it
   *  previews and the result this saves are one array. `null` = nothing declared
   *  yet, which is also what disables the finalize CTA. Ignored under Matches —
   *  `games.finish`'s Matches arm reads `game_matches.result` directly and
   *  takes no per-format input (see `commitMatches` below). */
  placements: { entityId: string; position: number }[] | null;
  /** Matches ONLY (170) — player-resolved paired matches, each carrying its
   *  own declared result. Empty for every other format. */
  matches: MatchScoreRow[];
  /** Matches ONLY — declares one match's result. WRITES DIRECTLY (its own
   *  mutation, `matches.setResult`) rather than staging into `placements` —
   *  there is no single "the outcome" for a page with N independent match
   *  results to stage. */
  onMatchResultPick: (matchId: string, result: "a_win" | "b_win" | "halve") => void;
  canEdit: boolean;
  /** Posted successfully — the page navigates back to the leaderboard. */
  onPosted: () => void;
}) {
  const utils = trpc.useUtils();
  // Matches (170) decides FIRST — before winLoseTie is even consulted. Its
  // shape is a match-play cup with exactly two sides too (so it would
  // otherwise satisfy `winLoseTie`'s own condition), but its result entry is
  // per-match, not a single declared outcome for the whole game — the two
  // are mutually exclusive branches of the SAME "how does this game's result
  // arrive" question `resolveResultStrategy` already answers server-side.
  const isMatches = isMatchesGame(game.game_type_id, game.competition_format);
  // Head-to-head win/lose/tie is a manual match-play game with exactly two sides;
  // anything else (points model, >2 teams) keeps the finishing-order editor.
  const winLoseTie = !isMatches && scoringModel === "match_play" && teams.length === 2;
  const dist = game.points_distribution?.type === "placement" ? game.points_distribution.values : [];

  const [error, setError] = useState<string | null>(null);
  // Matches' pre-commit confirm (§ build spec, mirroring pick'em's
  // `PickemFinalizePrompt` — see that file's header for why this is asked AT
  // THE TAP rather than shown as a standing banner). Only relevant when
  // `isMatches`; every other branch finalizes straight from `commit` below.
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const matchesUndecidedCount = matches.filter((m) => m.result == null).length;

  const { correct: handleCorrect, isPending: correctPending } = useOpenCorrection(
    tripId,
    game.id,
    competitionId,
    setError
  );
  const { finalize, isPending: busy } = useGameFinalize({
    tripId,
    gameId: game.id,
    competitionId,
    // Non-golf had NO self-refresh: it relied on the optimistic `markLocked` and
    // never revalidated its own row. Added so all four agree — invisible in the
    // happy path (the optimistic value is what the server returns), and the
    // difference when they disagree.
    refreshSelf: () => void utils.games.getById.invalidate({ tripId, gameId: game.id }),
    onExit: onPosted,
    // Non-golf shows the server's message INLINE beside the button that failed,
    // rather than relying only on the global toast. Kept.
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to post"),
  });

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

  async function commit() {
    setError(null);
    if (isMatches) {
      // Asked at the moment of the tap, not shown as a standing banner — see
      // `PickemFinalizePrompt`'s own header for the full reasoning, reused
      // here rather than re-argued. An undecided match's points stay unpaid
      // (Phase 0 §3); that is permitted, so this is a confirm, not a refusal.
      if (matchesUndecidedCount > 0) {
        setConfirmFinalize(true);
        return;
      }
      await finalizeMatches();
      return;
    }
    // The parent built this from the same state the header just previewed, so
    // what gets posted is definitionally what was shown. It used to be rebuilt
    // here, which is a second place the win/tie→position mapping could drift.
    if (!placements) return;
    // The shared aftermath — optimistic lock, self-refresh, the three board
    // invalidations, the exit. Non-golf's copy was the one missing a step
    // (`games.getById` was never revalidated), which is the argument for it
    // living in one place. `placements` is the only per-format input
    // `games.finish` takes — the golf formats compute their result server-side.
    await finalize(placements);
  }

  /** Matches' actual finalize call — no `placements` (the Matches arm of
   *  `games.finish` ignores that input; it reads `game_matches.result`
   *  directly, same as every other engine strategy). Split from `commit` so
   *  the confirm prompt's "yes, finalize anyway" has something to call that
   *  skips straight past the undecided-count gate it already agreed to. */
  async function finalizeMatches() {
    setConfirmFinalize(false);
    await finalize();
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
      <ScoringStateBanner
        status={game.status}
        correctionsOpen={game.corrections_open}
        pointsTotal={game.points_total as number | null}
      />
      {/* `canEdit` now reaches the outcome rows themselves. It used to be
          expressed by handing them a no-op `onPick`, which leaves three
          live-looking, focusable controls that silently do nothing for a member. */}
      {isMatches ? (
        <MatchesScoreboard
          matches={matches}
          onPick={onMatchResultPick}
          canEdit={editable}
        />
      ) : winLoseTie ? (
        <NonGolfMatchControl
          teams={teams}
          result={result}
          onPick={onPick}
          canEdit={editable}
        />
      ) : (
        <ManualPlacementEditor
          order={order}
          dist={dist}
          teamById={teamById}
          canEdit={editable}
          onReorder={onReorder}
          tiedWithPrev={tiedWithPrev}
          onToggleTie={onToggleTie}
        />
      )}

      {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}

      {/* The SAME lifecycle CTAs golf renders. Non-golf carried its own single
          button, which is why it looked and behaved differently: one bright
          warning-toned control the moment a game was posted, with no muted
          "Correct a score" step and no explicit correcting state. `gameLifecycle`
          decides which of the three is offered; this component only renders it,
          so the two can no longer drift.
          `allComplete` for non-golf means "an outcome has been chosen", which is
          now exactly "the parent could build a postable payload" — the placement
          editor always carries an order, so only the win/lose/tie control can be
          genuinely unanswered. Reading `placements` rather than re-testing
          `winLoseTie && result` keeps the CTA's enablement and the commit's own
          guard on ONE value, so the button cannot be live for a state that
          `commit` would refuse.

          Matches reads a DIFFERENT truth for the same prop: not "has an outcome
          been chosen" (placements is meaningless here — the Matches arm of
          `games.finish` ignores it) but "is there at least one paired match to
          finalize" — deliberately NOT "has every match been decided", because
          undecided is PERMITTED (Phase 0 §3), just confirmed first (above). An
          empty pairing grid still refuses — there is nothing for a tap on this
          button to mean. */}
      <GameLifecycleActions
        canEdit={canEdit}
        status={game.status}
        correctionsOpen={game.corrections_open}
        allComplete={isMatches ? matches.length > 0 : !!placements}
        finalizePending={busy}
        correctPending={correctPending}
        onFinalize={commit}
        onCorrect={handleCorrect}
      />

      {confirmFinalize && (
        <PickemFinalizePrompt
          title={`${matchesUndecidedCount} match${matchesUndecidedCount === 1 ? "" : "es"} ${matchesUndecidedCount === 1 ? "has" : "have"} no result`}
          message={`${matchesUndecidedCount === 1 ? "Its" : "Their"} points stay unpaid until entered — this is reversible, and you can still correct it after.`}
          // Names the ACT and its consequence, not a shrug — same rule this
          // component's own header states, and the same reason pick'em's
          // caller says "Void and save results" rather than "anyway".
          confirmLabel="Save with points unpaid"
          pendingLabel="Saving results…"
          cancelLabel="Keep entering results"
          pending={busy}
          onConfirm={finalizeMatches}
          onCancel={() => setConfirmFinalize(false)}
        />
      )}
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
