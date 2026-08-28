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
  if (remaining === 0) return false;
  if (a.total === b.total) return false;
  return a.total > b.total ? a.total - b.total > b.upside : b.total - a.total > a.upside;
}
