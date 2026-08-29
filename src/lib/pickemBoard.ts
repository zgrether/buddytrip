import {
  isResolved,
  paysOut,
  pickPoints,
  type ScoredPick,
  type ScoredSlateGame,
  type SlateResult,
} from "@/lib/pickemScoring";

/**
 * The board's arithmetic — pure, client-safe, and derived from nothing but the
 * picks and the results.
 *
 * **Nothing here is stored.** No snapshots, no cached totals, no materialised
 * standings. Enter a result, change one, clear one, and the next call returns
 * the new answer. That is the same call `pickemScoring` makes and the same one
 * `gloriousHoles` makes: a stored total is a second version of the truth that
 * goes stale the moment anything upstream moves.
 */

// ── The three kinds of zero ─────────────────────────────────────────────────

/**
 * A row can produce a zero swing for FOUR different reasons, and three of them
 * are facts the reader needs told apart. Rendering `—` for all of them is the
 * thing this type exists to prevent.
 *
 *   both      both picked the winner, and their ranks cancelled exactly.
 *             Something happened; it just netted out.
 *   neither   both were wrong. Also something happening.
 *   push      the game happened and nobody covered.
 *   cancelled the game never happened at all.
 *
 * `push` and `cancelled` produce identical arithmetic (nobody scores) and are
 * different facts — one is a result, the other is an absence. A display that
 * collapsed them would be telling the reader a game was played when it was not.
 */
export type ZeroKind = "both" | "neither" | "push" | "cancelled";

export interface BoardRow {
  slateGameId: string;
  /** Null until played. */
  result: SlateResult | null;
  multiplier: number;
  /** What each side picked, and at what rank. */
  aPick: "away" | "home";
  bPick: "away" | "home";
  aConfidence: number | null;
  bConfidence: number | null;
  /** Points each actually banked on this game. */
  aPoints: number;
  bPoints: number;
  /**
   * Positive = A gained, negative = B gained, 0 = nobody moved.
   *
   * The design point of the detail view. Both taking Alabama is not noise: one
   * at 16 and one at 3 is a 13-point swing on a game they agreed about.
   * Confidence allocation IS the game, and only a swing column shows it.
   */
  swing: number;
  /** Why the swing is zero, when it is. Null when the row moved someone. */
  zeroKind: ZeroKind | null;
  /** For an UNPLAYED row: what each side stands to gain. */
  upsideA: number;
  upsideB: number;
}

/**
 * What each side stands to gain on a game nobody has played yet.
 *
 * ── Agreement collapses the stake ──────────────────────────────────────────
 *
 * If both picked the SAME side, only one of them can end up ahead, and only by
 * the DIFFERENCE in their ranks — they either both bank or both miss. Reporting
 * each side's full rank would overstate what is actually on the table, which is
 * the number the reader uses to judge whether a match is still live.
 *
 * Disagreeing, the full rank is genuinely at stake for whoever is right.
 */
export function upsideFor(
  aPick: "away" | "home",
  bPick: "away" | "home",
  aBase: number,
  bBase: number,
  multiplier: number
): { upsideA: number; upsideB: number } {
  const w = multiplier;
  if (aPick === bPick) {
    const d = (aBase - bBase) * w;
    return { upsideA: Math.max(0, d), upsideB: Math.max(0, -d) };
  }
  return { upsideA: aBase * w, upsideB: bBase * w };
}

/** Why a played row moved nobody. */
function zeroKindFor(
  result: SlateResult,
  aHit: boolean,
  bHit: boolean
): ZeroKind {
  if (result === "push") return "push";
  if (result === "cancelled") return "cancelled";
  return aHit && bHit ? "both" : "neither";
}

/**
 * One row per slate game, for a head-to-head match.
 *
 * `useConfidence` off means every correct pick is worth 1 before weighting —
 * `confidence` is null on such a game (migration 146 forbids a stored 1), so
 * reading it would score everyone zero.
 */
export function buildBoardRows(
  slate: ScoredSlateGame[],
  aPicks: ScoredPick[],
  bPicks: ScoredPick[],
  useConfidence: boolean
): BoardRow[] {
  const aBy = new Map(aPicks.map((p) => [p.slateGameId, p]));
  const bBy = new Map(bPicks.map((p) => [p.slateGameId, p]));

  return slate.map((g) => {
    const a = aBy.get(g.id);
    const b = bBy.get(g.id);
    // A non-submitter scores from defaults and appears normally — home, and the
    // slate's own order as their ranking. Absent picks are the same case.
    const aPick = a?.pick ?? "home";
    const bPick = b?.pick ?? "home";
    const mult = g.multiplier ?? 1;
    const aBase = useConfidence ? (a?.confidence ?? 0) : 1;
    const bBase = useConfidence ? (b?.confidence ?? 0) : 1;

    const aPoints = a ? pickPoints(g, a, useConfidence) : 0;
    const bPoints = b ? pickPoints(g, b, useConfidence) : 0;
    const swing = aPoints - bPoints;

    const zeroKind =
      isResolved(g) && swing === 0
        ? zeroKindFor(g.result as SlateResult, paysOut(g.result) && aPick === g.result, paysOut(g.result) && bPick === g.result)
        : null;

    const { upsideA, upsideB } = isResolved(g)
      ? { upsideA: 0, upsideB: 0 }
      : upsideFor(aPick, bPick, aBase, bBase, mult);

    return {
      slateGameId: g.id,
      result: g.result ?? null,
      multiplier: mult,
      aPick,
      bPick,
      aConfidence: a?.confidence ?? null,
      bConfidence: b?.confidence ?? null,
      aPoints,
      bPoints,
      swing,
      zeroKind,
      upsideA,
      upsideB,
    };
  });
}

export interface MatchStanding {
  aTotal: number;
  bTotal: number;
  /** Positive = A ahead. */
  margin: number;
  /** Slate games with no result yet. */
  remaining: number;
  /** The most the TRAILING side can still add. */
  trailingUpside: number;
  /**
   * The lead exceeds everything the trailing side can still score.
   *
   * Pick'em's dormie, and the moment worth surfacing. False once nothing is
   * left — a finished match is decided, not clinched, and calling it clinched
   * would put a live-sounding word on a settled result.
   */
  clinched: boolean;
}

export function matchStanding(rows: BoardRow[]): MatchStanding {
  let aTotal = 0;
  let bTotal = 0;
  let remaining = 0;
  let upsideA = 0;
  let upsideB = 0;

  for (const r of rows) {
    aTotal += r.aPoints;
    bTotal += r.bPoints;
    if (r.result == null) {
      remaining += 1;
      upsideA += r.upsideA;
      upsideB += r.upsideB;
    }
  }

  const margin = aTotal - bTotal;
  // The TRAILING side's ceiling is what decides it — a leader's own upside is
  // irrelevant to whether they are safe.
  const trailingUpside = margin > 0 ? upsideB : margin < 0 ? upsideA : Math.max(upsideA, upsideB);

  return {
    aTotal,
    bTotal,
    margin,
    remaining,
    trailingUpside,
    clinched: remaining > 0 && margin !== 0 && Math.abs(margin) > trailingUpside,
  };
}

// ── Team totals ─────────────────────────────────────────────────────────────

export interface SideStanding {
  total: number;
  /** The most this side can still add across every unplayed game. */
  upside: number;
}

/** One side's total and ceiling — every sheet on it summed. */
export function sideStanding(
  slate: ScoredSlateGame[],
  sheets: ScoredPick[][],
  useConfidence: boolean
): SideStanding {
  const byGame = new Map(slate.map((g) => [g.id, g]));
  let total = 0;
  let upside = 0;

  for (const sheet of sheets) {
    for (const p of sheet) {
      const g = byGame.get(p.slateGameId);
      if (!g) continue;
      if (isResolved(g)) {
        total += pickPoints(g, p, useConfidence);
      } else {
        const base = useConfidence ? (p.confidence ?? 0) : 1;
        upside += base * (g.multiplier ?? 1);
      }
    }
  }
  return { total, upside };
}

/**
 * Has one side put it beyond the other?
 *
 * Same shape as a match's clinch and for the same reason: a lead bigger than
 * everything the other side can still score. A push or a cancellation removes
 * its own contribution from that ceiling, which is how a zero-scoring outcome
 * brings a clinch forward.
 */
export function sideClinched(a: SideStanding, b: SideStanding, remaining: number): boolean {
  // The two-team case of `leaderClinched`, kept as its own name because the
  // match roll-up genuinely has two sides and reads better saying so. It
  // DELEGATES rather than duplicating: this function's tests then double as
  // proof that generalising to N did not change what two teams do.
  return leaderClinched(
    [
      { id: "a", standing: a },
      { id: "b", standing: b },
    ],
    remaining
  );
}

/** A team and its standing, for the N-team ordering points mode is. */
export interface TeamStanding {
  id: string;
  standing: SideStanding;
}

/**
 * The sole leader, or null when the top is tied.
 *
 * Null on a tie rather than picking one arbitrarily: at two teams a tie is
 * visible in the numbers, but at four an arbitrary highlight is a claim the
 * board would be making on its own.
 */
export function leaderId(standings: readonly TeamStanding[]): string | null {
  let best: TeamStanding | null = null;
  let tied = false;
  for (const s of standings) {
    if (!best || s.standing.total > best.standing.total) {
      best = s;
      tied = false;
    } else if (s.standing.total === best.standing.total) {
      tied = true;
    }
  }
  return best && !tied ? best.id : null;
}

/**
 * Has the leader put it beyond EVERY other team?
 *
 * ── Why this replaces a binary predicate ───────────────────────────────────
 *
 * The rule is the same one match play uses — a lead bigger than what the other
 * side can still score — but "the other side" stops being a single thing at
 * three teams. Clinching against the second-placed team says nothing about the
 * third, whose upside may be larger from further back.
 *
 * So it is ALL, not the runner-up: the leader has clinched only when no other
 * team can reach them. Checking only the nearest challenger is the version that
 * looks right at two teams and is wrong at four, which is exactly the class of
 * bug `const [x, y] = standings` was.
 */
export function leaderClinched(standings: readonly TeamStanding[], remaining: number): boolean {
  if (remaining === 0) return false;
  const lead = leaderId(standings);
  if (lead == null) return false;
  const leader = standings.find((s) => s.id === lead)!;
  return standings.every(
    (s) => s.id === lead || leader.standing.total - s.standing.total > s.standing.upside
  );
}

/**
 * Standings in finishing order — highest total first.
 *
 * Points mode PAYS by position, so the order is the result rather than a
 * presentation choice. Roster order is what the two-team board shows today; it
 * is invisible there because two cards side by side read as a comparison, and
 * wrong the moment a third card makes the column a ranking.
 *
 * Ties keep their relative input order, which is what makes the payout's own
 * tie handling (averaged across the tied places) the single place ties are
 * resolved rather than something the sort quietly pre-empts.
 */
export function orderByTotal<T extends { standing: SideStanding }>(
  standings: readonly T[]
): T[] {
  return [...standings].sort((a, b) => b.standing.total - a.standing.total);
}

/**
 * Which teams are tied with the one above them, in finishing order.
 *
 * The shape `placementPointsByTeam` wants — it takes an order plus the set of
 * entities that share the previous one's place, and averages the payout across
 * a tied group. Derived here rather than at the call site so the board and the
 * payout cannot disagree about what a tie is.
 */
export function tiedWithPrevious(ordered: readonly TeamStanding[]): Set<string> {
  const tied = new Set<string>();
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].standing.total === ordered[i - 1].standing.total) {
      tied.add(ordered[i].id);
    }
  }
  return tied;
}

/**
 * One match's contribution to the cup, in the shape the tally needs.
 *
 * Team ids rather than user ids: a match is between two PEOPLE, but the points
 * it pays go to the teams they are on, and a side belonging to nobody's team
 * pays nobody.
 */
export interface MatchTallyRow {
  aTeamId: string | null;
  bTeamId: string | null;
  /** From `matchStanding` — positive means side A leads. */
  margin: number;
  remaining: number;
  clinched: boolean;
}

/**
 * The running tally under `individual_matches`: matches each team has WON.
 *
 * ── Settled, not finished ──────────────────────────────────────────────────
 *
 * A match counts once its winner can no longer change — `remaining === 0` OR
 * `clinched`. Those are two ways of saying the same thing and `matchStanding`
 * deliberately reports them separately (`clinched` is false at zero remaining,
 * because a finished match is DECIDED rather than clinched), so the tally has
 * to ask for both or it would drop every completed match.
 *
 * Counting only finished matches would leave the tally at 0 – 0 for most of a
 * Saturday and then jump at the end, which is the opposite of what a live board
 * is for. Counting UNFINISHED ones would be a projection, and projections do
 * not belong in a figure labelled as points earned.
 *
 * ── Matches, not points — and that is the second version of this ──────────
 *
 * It first returned CUP POINTS, multiplying each settled match by the shared
 * divisor. With a 6-point game over 7 matches that renders "0 – 2.57", which is
 * 18/7: an artifact of the divisor rather than a number anybody thinks in, and
 * two decimal places of precision nobody uses.
 *
 * Counting MATCHES fixes it at the source rather than by rounding. It is exact,
 * it is the unit match play is actually scored in, and a halved match makes it
 * "3½ – 2½" — a scoreline a golfer reads without translating.
 *
 * It also removes a derivation rather than relocating one. The cup points are
 * this × `liveMatchPointsPerMatch`, which is the divisor the pairing surface
 * already states; so "what did this game pay" is now two existing shared
 * functions composed, and there is no bespoke payment maths here for a future
 * server-side finalize to disagree with.
 *
 * A halved match gives each side ½, which is why the return is fractional
 * despite being a count.
 */
export function matchesWonByTeam(rows: readonly MatchTallyRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (teamId: string | null, amount: number) => {
    if (teamId == null) return;
    out.set(teamId, (out.get(teamId) ?? 0) + amount);
  };

  for (const r of rows) {
    const settled = r.remaining === 0 || r.clinched;
    if (!settled) continue;
    // A side off both rosters banks nothing, and its opponent still wins the
    // match — the win comes from the game, not from the loser's roster.
    if (r.margin === 0) {
      add(r.aTeamId, 0.5);
      add(r.bTeamId, 0.5);
    } else if (r.margin > 0) {
      add(r.aTeamId, 1);
    } else {
      add(r.bTeamId, 1);
    }
  }
  return out;
}
