import { gameLockState } from "@/lib/gameLifecycle";

/**
 * Is the cup FINISHED, as opposed to merely decided?
 *
 * These are two different states and the whole clinch-celebration feature turns
 * on telling them apart:
 *
 *   - **Clinched, games remaining** — mathematically decided, play continues.
 *     Someone can dominate through three days and clinch before Sunday, and
 *     Sunday still gets played. A celebration here reads as "this is over, why
 *     are we still standing on a tee box."
 *   - **Clinched and complete** — decided AND nothing left to play. The terminal
 *     screen of the whole event, and the only place the celebration belongs.
 *
 * ── The rule (spec option (c)): nothing underway, nothing half-done ──────────
 *
 * A game OBSTRUCTS completion when it is not locked and is either live or
 * part-scored. Stated as code below; stated in English here:
 *
 *   - locked (finalized, not reopened) ......... done, no obstruction
 *   - has scores but isn't locked .............. HALF-DONE, obstructs
 *   - scoring enabled but no scores yet ........ UNDERWAY, obstructs
 *   - never armed, never started ............... not part of the event yet
 *
 * That last line is the point of the rule. Requiring *every* game to be locked
 * (the obvious reading) fails silently in a real scenario: someone adds a sixth
 * game, the crew plays five, the cup clinches, and the celebration never fires
 * with nothing on screen explaining why. Firing as soon as any game is
 * unfinished-but-unstarted has the opposite failure — it celebrates while a
 * genuinely-still-to-play game sits waiting. Reading "is anything actually
 * going on right now" is the only version that matches the situation.
 *
 * A game reopened for a correction (#867's `IN REVIEW`) is `complete +
 * corrections_open`, so `isLocked` is false while `started` is true — it
 * obstructs, and it should: the cup is back in doubt, don't throw confetti.
 *
 * ── Why `gameLockState` and not a local `status === "complete"` ─────────────
 *
 * CLAUDE.md #24: golf's lock state has ONE home. Seven separate incidents came
 * from formats each re-deriving this pair. A new consumer re-deriving it is the
 * eighth, so this reads the shared predicate even though the expression is two
 * fields long.
 */

/** The per-game fields this predicate reads — a structural subset of `LBGame`,
 *  so the leaderboard payload satisfies it without a cast. */
export interface CupCompletionGame {
  status: string;
  /** Complete + reopened for a correction. Absent reads as "not in review". */
  correctionsOpen?: boolean;
  /** ≥1 score entry exists. Absent reads as "not started". */
  started?: boolean;
  /** Scoring is armed. Absent reads as "not armed". */
  scoringEnabled?: boolean;
}

/** A game that is live, or part-scored and not finalized — the cup can't be
 *  over while one of these exists. */
export function obstructsCompletion(game: CupCompletionGame): boolean {
  const { isLocked } = gameLockState({
    status: game.status,
    correctionsOpen: game.correctionsOpen === true,
  });
  if (isLocked) return false;
  return game.started === true || game.scoringEnabled === true;
}

/**
 * The celebration gate: the cup is decided AND nothing is left in play.
 *
 * `hasClincher` comes from the caller's EXISTING clinch derivation
 * (`pointsToClinch[team] <= 0`, `CompetitionLeaderboard`) — this never
 * re-derives clinch, per the spec and CLAUDE.md #8.
 *
 * The `some(locked)` floor is not decoration. `winThreshold(0, true)` returns
 * `0`, so on a cup with ZERO games a defending team's `pointsToClinch` is
 * `0 - 0 = 0`, which satisfies `<= 0` — a brand-new cup with a defending team
 * and no games set up reads as "clinched" today. That is pre-existing (the
 * banner already shows there) and out of scope to change, but it must not
 * light up a trophy: with no games, nothing obstructs either, so without this
 * floor an empty cup would celebrate itself. Requiring at least one FINALIZED
 * game is the honest statement of "this cup was actually played."
 */
export function isCupComplete(games: CupCompletionGame[], hasClincher: boolean): boolean {
  if (!hasClincher) return false;
  const anyFinalized = games.some(
    (g) => gameLockState({ status: g.status, correctionsOpen: g.correctionsOpen === true }).isLocked,
  );
  if (!anyFinalized) return false;
  return !games.some(obstructsCompletion);
}

/**
 * How many games have NOT reached a final, locked result yet — the count the
 * hero's "clinched, games remain" line names. Broader than
 * `obstructsCompletion`'s set on purpose: a game nobody has armed yet still
 * genuinely REMAINS to be played, even though it isn't obstructing completion
 * (a never-started game doesn't block the cup from being decided, but it does
 * count toward "how many are left"). Same `gameLockState` reasoning as
 * `obstructsCompletion` above — one predicate, not a re-derived `status`
 * check per caller.
 */
export function gamesRemaining(games: CupCompletionGame[]): number {
  return games.filter(
    (g) => !gameLockState({ status: g.status, correctionsOpen: g.correctionsOpen === true }).isLocked,
  ).length;
}
