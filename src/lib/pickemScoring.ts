/**
 * Pick'em's scoring — pure, client-safe (CLAUDE.md #8).
 *
 * The Run surface, the board (Phase 6) and the finalize write all have to agree
 * on what a sheet is worth, and three implementations of that would agree today
 * and drift on the first push.
 *
 * ── Nothing is snapshotted ─────────────────────────────────────────────────
 *
 * Every total here is derived from the picks and the current results, at read
 * time. Enter a result, change one, clear one — the next call returns the new
 * answer and nothing migrates. That is the same call `gloriousHoles` makes and
 * for the same reason: a stored total is a second version of the truth that
 * goes stale the moment anything upstream moves.
 */

export type SlateResult = "away" | "home" | "push" | "cancelled";

/** A contest, as scoring sees it. Structural so the router's row and a test
 *  fixture both satisfy it without importing each other's types. */
export interface ScoredSlateGame {
  id: string;
  /** Null until it has been played. */
  result?: SlateResult | null;
  /** Weighting — 1 unless the runner marked the game up. Absent reads as 1,
   *  never as 0: a missing multiplier must produce a normal game, never a
   *  worthless one (spec §2.3). */
  multiplier?: number | null;
}

export interface ScoredPick {
  slateGameId: string;
  pick: "away" | "home";
  /** Null when the game runs with confidence off — every correct pick is then
   *  worth 1 before the multiplier, never a stored 1 (migration 146). */
  confidence?: number | null;
}

/**
 * Is this contest finished, whatever the outcome was?
 *
 * Push and cancelled count. They are RESOLVED — one happened and nobody won,
 * the other never happened — and both stop counting as remaining. That is what
 * lets a clinch come forward correctly: there is less on the table, so less can
 * change.
 */
export function isResolved(g: ScoredSlateGame): boolean {
  return g.result != null;
}

/** Someone covered. The two outcomes that pay. */
export function paysOut(result: SlateResult | null | undefined): result is "away" | "home" {
  return result === "away" || result === "home";
}

/**
 * What ONE pick earned.
 *
 * Zero for a wrong pick, zero for a push, zero for a cancellation, and zero for
 * anything not yet played. Push and cancelled produce the same number by
 * design — they differ as FACTS, not as arithmetic, which is why the difference
 * lives on the screen and in the column rather than here.
 */
/**
 * What a stored rank is worth, on its own — never what the CALLER should use.
 *
 * `pick.confidence ?? 1`. Migration 146's column comment already says scoring
 * reads `COALESCE(confidence, 1)`; every call site here read `?? 0` instead,
 * which is #1216 — a wiped or never-ranked sheet scored zero where the
 * documented design (and the confidence-off path two lines below) says one.
 * A null rank now degrades to a flat, un-weighted pick — the mode this app
 * already ships for confidence off — instead of annihilating the pick.
 *
 * Deliberately ONE argument. `useConfidence` decides whether a rank applies
 * AT ALL, which is a property of the GAME right now — and it is NOT implied
 * by whether this pick happens to carry one: turning confidence off does not
 * null ranks already stored (`save_pickem_config`'s settings arm writes only
 * `pickem_games`), so a toggled-off game can still hold real numbers here. A
 * one-argument helper that also read `useConfidence` would have two branches
 * returning the same answer whenever confidence is genuinely off — dead
 * weight, and exactly the kind of parameter that later grows a real branch
 * behind it. Every call site keeps its own `useConfidence ? pickConfidence(p)
 * : 1`, which is what forces the flat score on a toggled-off game regardless
 * of what is still sitting in the column.
 */
export function pickConfidence(pick: ScoredPick): number {
  return pick.confidence ?? 1;
}

export function pickPoints(
  game: ScoredSlateGame,
  pick: ScoredPick,
  useConfidence: boolean
): number {
  if (!paysOut(game.result)) return 0;
  if (pick.pick !== game.result) return 0;
  const weight = game.multiplier ?? 1;
  // Confidence off: every correct pick is worth one, before weighting.
  const base = useConfidence ? pickConfidence(pick) : 1;
  return base * weight;
}

/** One person's running total over the results so far. */
export function sheetPoints(
  slate: ScoredSlateGame[],
  picks: ScoredPick[],
  useConfidence: boolean
): number {
  const byGame = new Map(slate.map((g) => [g.id, g]));
  return picks.reduce((sum, p) => {
    const g = byGame.get(p.slateGameId);
    return g ? sum + pickPoints(g, p, useConfidence) : sum;
  }, 0);
}

/**
 * How far through the slate we are — as a COUNT, never a position.
 *
 * "11 of 16 in", not "thru 11". There is no order to be eleven-deep into:
 * results land as games finish, a Thursday nighter then two on Friday then the
 * bulk on Saturday, and "thru" would assert a sequence the runner does not work
 * in and the data does not have.
 */
export function resolvedCount(slate: ScoredSlateGame[]): { resolved: number; total: number } {
  return { resolved: slate.filter(isResolved).length, total: slate.length };
}

/**
 * The most anyone still un-played could add to a sheet.
 *
 * The clinch input. Only unresolved games contribute — a push and a
 * cancellation have already yielded everything they are going to, which is
 * precisely why marking one can bring a clinch forward.
 *
 * With confidence ON the ceiling is the highest rank still outstanding on that
 * person's sheet, weighted; with it off, one per game.
 */
export function remainingUpside(
  slate: ScoredSlateGame[],
  picks: ScoredPick[],
  useConfidence: boolean
): number {
  const byGame = new Map(slate.map((g) => [g.id, g]));
  return picks.reduce((sum, p) => {
    const g = byGame.get(p.slateGameId);
    if (!g || isResolved(g)) return sum;
    const base = useConfidence ? pickConfidence(p) : 1;
    return sum + base * (g.multiplier ?? 1);
  }, 0);
}
