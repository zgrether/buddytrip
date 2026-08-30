import type { ScoredPick, ScoredSlateGame } from "./pickemScoring";
import {
  buildBoardRows,
  matchStanding,
  matchesWonByTeam,
  orderByTotal,
  sideStanding,
  tiedWithPrevious,
  type TeamStanding,
} from "./pickemBoard";
import { liveMatchPointsPerMatch } from "./pointsDistribution";
import { placementPointsByTeam, placementsFrom } from "./placementGroups";

/**
 * What a finished pick'em game pays the cup — pure, client-safe (CLAUDE.md #8).
 *
 * ── IT COMPOSES; IT DOES NOT COMPUTE ───────────────────────────────────────
 *
 * Every figure below comes from a function the board already uses:
 * `sideStanding` for a team's total, `matchStanding` + `matchesWonByTeam` for
 * who won a match and by how much, `liveMatchPointsPerMatch` for the divisor,
 * `orderByTotal` + `tiedWithPrevious` + `placementPointsByTeam` for a points
 * cup's payout.
 *
 * Not one of them is reimplemented here, and that is the point rather than a
 * tidiness preference: a second implementation of "what did this game pay"
 * would agree with the board today and drift on the first change to either.
 * The live figure and the persisted one are the same call.
 *
 * ── Three resolutions, one per shape ───────────────────────────────────────
 *
 * `individual_matches` — the game's points split across the valid matches, each
 *   match paying its own share to whoever won it, halved matches splitting.
 *
 * `simple` — the app's existing word, borrowed rather than coined. Non-golf's
 *   Simple format is "choose the winner": higher total takes the whole value,
 *   equal totals split it. Pick'em's only difference is that the winner is
 *   DERIVED from the totals instead of chosen by a person, which is not a
 *   difference the cup can see.
 *
 * `placement` — a points cup: the teams finish in order and each place pays,
 *   with ties averaging the award across the places they span.
 *
 * ── Unresolved games score zero, exactly as cancelled ones do ──────────────
 *
 * A runner may finalize with anything from none to all of the slate resolved.
 * An unplayed contest pays nobody, which is arithmetically identical to a
 * cancellation — so finalizing early is the same act as voiding the rest, and
 * a postponed Tuesday game should not hold the cup open.
 *
 * The COUNT comes back so the caller can say so before it happens. It is a
 * warning and never a refusal: the runner is allowed to mean it.
 *
 * ── Why every match is settled here ────────────────────────────────────────
 *
 * `matchesWonByTeam` pays only a SETTLED match — decided, or with nothing left
 * to play. That is right on a live board, where an undecided match has not been
 * won by anybody yet.
 *
 * At finalize there is nothing left by definition, so the rows are built with
 * `remaining: 0`. Without that, a game finalized with contests outstanding
 * would pay nothing for the matches those contests were in — silently, and only
 * for some of them.
 */

export type PickemResolution = "individual_matches" | "simple" | "placement";

export interface PickemFinalizeGame extends ScoredSlateGame {
  id: string;
}

export interface PickemFinalizeMatch {
  sideAId: string | null;
  sideBId: string | null;
  /** This match's own value, when the runner overrode the even share. */
  pointValue: number | null;
}

export interface PickemFinalizeInput {
  slate: PickemFinalizeGame[];
  /** Every sheet, keyed by user. */
  sheets: Record<string, ScoredPick[]>;
  matches: PickemFinalizeMatch[];
  teams: { id: string; memberIds: string[] }[];
  useConfidence: boolean;
  rollUp: "team_totals" | "individual_matches";
  /** The COMPETITION is a points cup — overrides `rollUp`, which is inert there. */
  pointsMode: boolean;
  /** `games.points_total`. Null is a game worth nothing, which pays nothing. */
  pointsTotal: number | null;
  /** `effectiveDistribution(...)` — the authored split, or winner-takes-all. */
  distribution: number[];
}

/**
 * ── THE PERSISTED ROWS ARE A DIFFERENT SHAPE PER RESOLUTION, AND THAT IS THE
 *    LEADERBOARD'S RULE RATHER THAN THIS MODULE'S PREFERENCE ────────────────
 *
 * `computeCompetitionLeaderboard` reads a `game_results` row two ways, and which
 * one it uses is decided by the game, not by the row:
 *
 *   POSITION + a distribution, ranked `low_wins`  — every placement format
 *   RAW_SCORE as points already decided, `high_wins` — match play, and a bracket
 *
 * A points cup writes POSITIONS so the payout stays DERIVED: change the split
 * (or the game's total) afterwards and the board re-derives, which is the rule
 * migration 119's header states for the bracket and the reason it does not
 * collapse entrants to teams at write time. Snapshotting the points instead
 * would freeze a payout to whatever the schedule said on the evening somebody
 * pressed Save.
 *
 * The other two resolutions have no schedule to defer to — the points ARE the
 * result of the contest (this match paid 3, that one paid 3) — so they write the
 * figure and the board passes it through as its own synthetic distribution,
 * exactly as match play's per-match award already does.
 *
 * `awards` is populated either way, because the SCREEN wants points in both
 * cases: a runner about to finalize is asking what this will pay, and "3rd
 * place" is not an answer to that question.
 */
export type PickemFinalizeWrite =
  | { kind: "points"; rows: { entityId: string; points: number }[] }
  | { kind: "placements"; rows: { entityId: string; position: number }[] };

export interface PickemFinalizeResult {
  resolution: PickemResolution;
  /** Team id → points. Teams that earned nothing are present with 0, so the
   *  written results describe every team rather than only the winners. */
  awards: Map<string, number>;
  /** What to persist, in the shape the leaderboard reads it back — see above. */
  write: PickemFinalizeWrite;
  /** Slate games with no result. They scored nothing for everyone. */
  unresolved: number;
}

/** Every team, in the `points` write shape. Teams on zero are INCLUDED: the
 *  results table should describe the whole field, and an absent row is how
 *  "earned nothing" becomes indistinguishable from "was not in this game". */
function pointsWrite(awards: Map<string, number>): PickemFinalizeWrite {
  return {
    kind: "points",
    rows: [...awards.entries()].map(([entityId, points]) => ({ entityId, points })),
  };
}

/**
 * Which resolution this game uses.
 *
 * `pointsMode` is read FIRST and alone: `roll_up` is still SET in a points cup
 * and means nothing there, so a cup carrying `individual_matches` would
 * otherwise be paid as match play. Resolved in one place rather than by adding
 * `!pointsMode &&` at each site — the version where every caller remembers the
 * override is the version where one of them does not.
 */
export function pickemResolution(o: {
  rollUp: "team_totals" | "individual_matches";
  pointsMode: boolean;
}): PickemResolution {
  if (o.pointsMode) return "placement";
  return o.rollUp === "individual_matches" ? "individual_matches" : "simple";
}

/** Each team's total — every sheet on it, summed by the board's own function. */
function teamStandings(input: PickemFinalizeInput): TeamStanding[] {
  return input.teams.map((t) => ({
    id: t.id,
    standing: sideStanding(
      input.slate,
      t.memberIds.map((uid) => input.sheets[uid] ?? []),
      input.useConfidence
    ),
  }));
}

export function pickemFinalize(input: PickemFinalizeInput): PickemFinalizeResult {
  const resolution = pickemResolution(input);
  const unresolved = input.slate.filter((g) => g.result == null).length;

  // Every team present, so a team that earned nothing is written as 0 rather
  // than omitted — "earned nothing" and "was not in this game" are different
  // facts and the results table should not conflate them.
  const awards = new Map<string, number>(input.teams.map((t) => [t.id, 0]));
  const add = (teamId: string | null, amount: number) => {
    if (teamId == null || !awards.has(teamId)) return;
    awards.set(teamId, (awards.get(teamId) ?? 0) + amount);
  };

  const teamOf = (userId: string): string | null =>
    input.teams.find((t) => t.memberIds.includes(userId))?.id ?? null;

  if (resolution === "individual_matches") {
    /**
     * The even share, from the ONE function that owns the divisor (#1068).
     * Never re-derived: a divisor computed from the roster rather than from the
     * paired matches is the exact bug #1101 removed.
     */
    const perMatch = liveMatchPointsPerMatch(input.pointsTotal, input.matches);

    for (const m of input.matches) {
      if (!m.sideAId || !m.sideBId) continue;
      const st = matchStanding(
        buildBoardRows(
          input.slate,
          input.sheets[m.sideAId] ?? [],
          input.sheets[m.sideBId] ?? [],
          input.useConfidence
        )
      );
      /**
       * `matchesWonByTeam` on ONE match, then scaled by that match's value.
       *
       * Running the shared function per match rather than over all of them is
       * what lets a per-match override pay its own figure — total wins times an
       * average would be wrong the moment one match is worth something else.
       * It still decides WHO won and by how much; nothing here re-derives that.
       *
       * `remaining: 0` because finalize closes the slate — see the header.
       */
      const won = matchesWonByTeam([
        {
          aTeamId: teamOf(m.sideAId),
          bTeamId: teamOf(m.sideBId),
          margin: st.margin,
          remaining: 0,
          clinched: st.clinched,
        },
      ]);
      const value = m.pointValue ?? perMatch;
      for (const [teamId, share] of won) add(teamId, share * value);
    }
    return { resolution, awards, write: pointsWrite(awards), unresolved };
  }

  const standings = teamStandings(input);

  if (resolution === "placement") {
    const ordered = orderByTotal(standings);
    const order = ordered.map((s) => s.id);
    const tied = tiedWithPrevious(ordered);
    /**
     * ONE order and ONE tie set, feeding both answers.
     *
     * `placementsFrom` is what `games.finish` is already handed by the entered
     * and the derived arms, and `placementPointsByTeam` is what the entry
     * screen previews with — both from these two values, so the row that gets
     * written and the number the runner was shown cannot come apart.
     */
    for (const [teamId, pts] of placementPointsByTeam(order, tied, input.distribution)) {
      add(teamId, pts);
    }
    return {
      resolution,
      awards,
      write: { kind: "placements", rows: placementsFrom(order, tied) },
      unresolved,
    };
  }

  /**
   * SIMPLE — the higher total takes the whole value, equal totals split it.
   *
   * The app's existing word, used rather than a new one: non-golf's Simple
   * format resolves exactly this way, and the only difference here is that the
   * winner is derived from the totals instead of chosen by a person. That is
   * not a difference the cup can see, so it is not a difference worth a name.
   *
   * A tie splits between EVERY team on the top total, not just two. Two is the
   * common shape and the one the copy is written for, but nothing about the
   * resolution needs it, and hard-coding a pair is how "either side" language
   * gets into a four-team cup.
   */
  const value = input.pointsTotal ?? 0;
  if (value > 0 && standings.length > 0) {
    const best = Math.max(...standings.map((s) => s.standing.total));
    const winners = standings.filter((s) => s.standing.total === best);
    for (const w of winners) add(w.id, value / winners.length);
  }
  return { resolution, awards, write: pointsWrite(awards), unresolved };
}

/**
 * Should finalizing STOP and ask first?
 *
 * ── Asked at the tap, not printed above it ─────────────────────────────────
 *
 * This used to be a standing banner over the finalize button. Two problems, and
 * the second is the real one: a block of colour that has been on screen all
 * session stops being read, AND it was telling a runner entering results to keep
 * entering results. "2 games have no result" is not news to the person whose job
 * that is — it is only information at the moment they try to stop early.
 *
 * ── The FIRST finalize only ────────────────────────────────────────────────
 *
 * `canFinalize` and `canRelock` are mutually exclusive, so keying on the first
 * scopes this to the original decision. A re-lock is somebody returning to a
 * state they already chose — they reopened, made their corrections, and are
 * closing it again — and asking the same question a second time is friction on a
 * decision that has already been taken.
 */
export function confirmUnresolvedFinalize(o: {
  unresolved: number;
  /** `gameLifecycle(...).canFinalize` — the FIRST finalize, never the re-lock. */
  canFinalize: boolean;
}): boolean {
  return o.canFinalize && o.unresolved > 0;
}

/**
 * What the runner is told when it does.
 *
 * Null when there is nothing to warn about. A WARNING and never a refusal —
 * a postponed Tuesday game should not hold the cup open, and the runner is
 * allowed to mean it.
 *
 * It names the COUNT and the CONSEQUENCE, because "are you sure" without either
 * is a dialog people learn to confirm without reading.
 *
 * ── It says VOIDED now, because that is what happens ──────────────────────
 *
 * This used to read "they'll score nothing for everyone" — true, and it
 * described an ARITHMETIC outcome for contests that were left in no state at
 * all. Finalizing now WRITES the void, so the sentence names the act the runner
 * is authorising rather than its side effect. The difference matters at the one
 * moment this is read: "scores nothing" sounds like something that could still
 * change, and "voided" is a decision.
 *
 * Singular is handled because a slate with one unresolved game is the likely
 * case, not the edge one.
 */
export function unresolvedWarning(unresolved: number): string | null {
  if (unresolved <= 0) return null;
  return unresolved === 1
    ? "1 game has no result. It will be voided, and no points assigned for correct picks."
    : `${unresolved} games have no result. They will be voided, and no points assigned for correct picks.`;
}
