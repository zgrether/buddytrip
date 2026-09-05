/**
 * Shared match-play logic (Slice B, singles). The ONE implementation of net
 * allocation and match state — used by both the live strip (client) and the
 * server result computation, so they can never diverge (CLAUDE.md pattern #8).
 *
 * No React, no DB. Net is DERIVED here; gross (`score_entries.value`) is never
 * overwritten (engine decision #16).
 *
 * Glorious Finishing Holes: `matchState` weights each hole's win/loss by
 * `holeWeight` (2× on the last N holes) and compares the lead to the WEIGHTED
 * remaining swing (`remainingSwing`) for close-out/dormie — see `gloriousHoles.ts`.
 * With no glorious config every weight is 1 and this is exactly standard match play.
 */
/* `holeWeight` is no longer imported here: the engine takes a weight FUNCTION
   and `toUnitWeight` is the one place golf's config becomes one. */
import { remainingSwing, toUnitWeight, NO_GLORIOUS, type Weighting } from "./gloriousHoles";

export type HoleResult = "W" | "L" | "H"; // A vs B on NET; decided holes only, play order

/**
 * A decided hole = its NUMBER + the A-perspective outcome. The number is
 * load-bearing for glorious weighting (the weight depends on WHICH hole it is), so
 * `buildDecided` carries it rather than emitting bare outcomes in play order — a
 * gap-tolerant shape (undecided holes are simply absent, so position ≠ hole number).
 */
export interface DecidedHole {
  hole: number;
  result: HoleResult;
}

/**
 * Has this match had any scores entered? (W-GAMEPAGE-01 §11.) A hole is decided
 * only when both sides' grosses are in (see `buildDecided`), so a non-empty
 * `decided` list IS the "scores exist" signal the destructive-edit guard keys on
 * — removing a scored match clears entered scores, so it must confirm first.
 * Pure + named so the guard and its test share one definition.
 */
export function matchHasScores(decided: DecidedHole[]): boolean {
  return decided.length > 0;
}

export interface MatchState {
  thru: number; // decided holes counted toward the official result
  diff: number; // + = A up, − = B up (frozen at close-out)
  up: number;
  holesLeft: number;
  over: boolean;
  closed: boolean; // decided early (before the last hole)
  dormie: boolean;
  leader: "A" | "B" | null;
  margin: string | null; // "3&2" | "2 UP" | "AS" | null (in progress)
}

const HOLES = 18;

/**
 * Holes where a player receiving `n` strokes gets one. With a course stroke
 * index, the `n` hardest; otherwise the sequential fallback (holes 1..n).
 *
 * The hole count is whatever the round actually is — NOT a hardcoded 18. It's
 * defined by the stroke index when present (a 9-hole course has a 9-length
 * index), else the caller's `holeCount`, else the 18-hole default. The old
 * `=== 18` gate silently rejected a valid 9-hole index and fell back to
 * board-order holes 1..n (the "pips on 1..n" bug); deriving the count from the
 * index makes a 9-hole (or any-length) course allocate against its real index.
 */
export function strokeHoles(n: number, strokeIndex?: number[], holeCount?: number): Set<number> {
  if (n <= 0) return new Set();
  const H = strokeIndex?.length || holeCount || HOLES;
  if (strokeIndex && strokeIndex.length === H) {
    return new Set(
      [...Array(H)]
        .map((_, i) => i + 1)
        .filter((h) => ((strokeIndex[h - 1] - 1) % H) < n)
    );
  }
  return new Set([...Array(Math.min(n, H))].map((_, i) => i + 1));
}

/**
 * Build the decided `HoleResult[]` (A's perspective, hole order) from both
 * sides' gross-per-hole maps + each side's handicap strokes. A hole is decided
 * ONLY when both grosses exist (Slice A allows partial/out-of-order entry);
 * undecided holes are excluded and count as still-to-play.
 */
export function buildDecided(
  grossA: Record<string, number | null | undefined>,
  grossB: Record<string, number | null | undefined>,
  strokesA: number,
  strokesB: number,
  strokeIndex?: number[],
  holeCount = HOLES
): DecidedHole[] {
  const setA = strokeHoles(strokesA, strokeIndex, holeCount);
  const setB = strokeHoles(strokesB, strokeIndex, holeCount);
  const out: DecidedHole[] = [];
  for (let h = 1; h <= holeCount; h++) {
    const ga = grossA[String(h)];
    const gb = grossB[String(h)];
    if (ga == null || gb == null) continue; // undecided — still to play
    const na = ga - (setA.has(h) ? 1 : 0);
    const nb = gb - (setB.has(h) ? 1 : 0);
    out.push({ hole: h, result: na < nb ? "W" : na > nb ? "L" : "H" });
  }
  return out;
}

/** One hole's recorded outcome (`match_hole_outcomes`) — the storage shape for
 *  hole-outcome-entry mode (Refactor B). `side_a`/`side_b` name the MATCH's sides
 *  directly (not a player id) — there is no gross, no handicap, no stroke index:
 *  the outcome IS the decision (a concession and a 3-net-stroke win are the same
 *  row — the app never distinguishes them). */
export type HoleOutcomeResult = "side_a" | "side_b" | "halved";
export interface HoleOutcomeRow {
  hole: number;
  result: HoleOutcomeResult;
}

/**
 * Bottom-control state machine for hole-OUTCOME entry (Match-Play Parity item 1).
 * Pure so the local-until-OK commit contract is testable without a DOM. Encodes:
 * a hole is COMMITTED only via OK — tapping a choice sets a local pick and never
 * writes; OK is available only when that local pick DIFFERS from what's committed
 * (`dirty`). While selecting (dirty) or empty (nothing committed), the bottom is
 * the `commit` bar; once committed and settled it swaps to `finish`/`next`
 * (mirroring stroke's post-confirm advance), matching `ScoreEntryView`.
 *
 *   committed=undef, local=undef   → commit  (canOk:false, canReset:false)  ← nothing auto-commits
 *   committed=undef, local=side_a  → commit  (canOk:true,  canReset:true)   ← OK will write once
 *   committed=side_a, local=undef  → next/finish/none (canReset:true)       ← settled, but clearable
 *   committed=side_a, local=side_b → commit  (canOk:true,  canReset:true)   ← a correction to OK
 *   committed=side_a, local=side_a → next/finish/none (canReset:true)       ← same pick, not dirty
 *
 * ── `canReset` IS NOT COMMIT-ONLY, and that was the bug ─────────────────────
 *
 * The settled rows above used to return `canReset: false`, so a committed hole
 * offered no way back: the Reset control lives on the commit bar, and a settled
 * hole does not show one. The only route to clearing a hole was to tap a
 * DIFFERENT outcome first — going dirty brings the commit bar back — and then
 * Reset. You had to select a wrong answer to reach the undo, which is why this
 * read as "there is no way to un-score a hole in match play": every recovery
 * ran through recording something false.
 *
 * The mutation was never missing (`matchOutcomes.deleteOutcome` has existed
 * since the entry mode shipped, with the same posted-game guard as writing) and
 * neither was the button. Only its reachability.
 *
 * Reset stays SECONDARY in the settled state — Next/Finish remains the primary,
 * because advancing is what happens on every hole and clearing is what happens
 * twice a trip. Making the commit bar persist on settled holes would have been
 * the smaller diff and would have traded the every-hole path for the rare one.
 */
export type OutcomeBottomKind = "commit" | "finish" | "next" | "none";
export interface OutcomeBottomState {
  kind: OutcomeBottomKind;
  /** commit-kind only: OK enabled ⟺ there's a new pick to commit (dirty). */
  canOk: boolean;
  /**
   * Is there anything to clear? True whenever a local pick OR a committed
   * outcome exists — in EVERY kind, not just `commit`.
   *
   * What it means differs by kind, which is why the two call sites label the
   * button differently: on the commit bar it discards a pick you have not
   * written yet ("Reset"), and on a settled hole it deletes a result that is
   * already in the database ("Clear hole"). Same predicate, two consequences.
   */
  canReset: boolean;
}
export function outcomeBottomState(args: {
  committed: HoleOutcomeResult | undefined;
  localPick: HoleOutcomeResult | undefined;
  canFinish: boolean;
  isLastHole: boolean;
}): OutcomeBottomState {
  const { committed, localPick, canFinish, isLastHole } = args;
  const dirty = localPick !== undefined && localPick !== committed;
  if (dirty || committed === undefined) {
    return { kind: "commit", canOk: dirty, canReset: (localPick ?? committed) !== undefined };
  }
  const kind: OutcomeBottomKind = canFinish ? "finish" : isLastHole ? "none" : "next";
  // Reachable only when `committed !== undefined` (the `dirty || committed ===
  // undefined` branch above took every other case), so there is always a stored
  // result to clear here. Written as the predicate rather than `true` so it
  // still reads correctly if the branch above ever changes.
  return { kind, canOk: false, canReset: committed !== undefined };
}

/**
 * Build the decided `DecidedHole[]` (A's perspective, hole order) directly from
 * recorded hole outcomes — the hole-outcome-entry counterpart to `buildDecided`
 * (which derives outcomes from gross scores + handicaps). No scores, no strokes:
 * each outcome row already IS the decision, so this is pure reshaping + sorting.
 * Gap-tolerant, same contract as `buildDecided`: a hole with no row is simply
 * absent (still to play), never a distinguished "cleared" state.
 */
export function buildDecidedFromOutcomes(rows: HoleOutcomeRow[]): DecidedHole[] {
  return rows
    .slice()
    .sort((a, b) => a.hole - b.hole)
    .map((r) => ({
      hole: r.hole,
      result: r.result === "side_a" ? "W" : r.result === "side_b" ? "L" : "H",
    }));
}

/** Hole numbers 1..holeCount not present in the decided set — the genuinely
 *  unplayed holes (gap-tolerant: an undecided mid-round hole counts as unplayed). */
function unplayedHoles(holeCount: number, played: Set<number>): number[] {
  const out: number[] = [];
  for (let h = 1; h <= holeCount; h++) if (!played.has(h)) out.push(h);
  return out;
}

/**
 * Walk decided holes and FREEZE the official result at the close-out hole —
 * anything after (a "Play it out" hole) is ignored, so a closed 3&2 can't
 * recompute to nonsense when the trailing player wins 17 & 18.
 *
 * WEIGHTED per UNIT: each unit's win/loss counts for `weightOf(unit)`, and
 * close-out/dormie compare the lead to the WEIGHTED swing over the unplayed units —
 * NOT raw units left (§4). So a 4-up lead with 3 glorious holes (swing 6) stays live;
 * 7-up is closed. With `NO_GLORIOUS` every weight is 1 and this is byte-for-byte
 * standard match play.
 *
 * ── THE WEIGHT IS PASSED IN, NOT LOOKED UP ────────────────────────────────
 *
 * `weighting` takes golf's `GloriousConfig` (as it always has — every existing
 * caller is untouched) OR a bare `UnitWeight` function. That second form is what
 * makes this engine format-agnostic, and it removed three of golf's assumptions
 * from it in one change: `holeWeight` returns the literal `1 | 2`, selects
 * POSITIONALLY (`hole > 18 − n`, a trailing window), and measures against a
 * hardcoded 18 — so on a shorter unit count it is silently inert.
 *
 * All three blocked pick'em, whose weights are 1..4, chosen PER GAME rather than
 * by position, over a slate that is not 18 long. A pick'em match with confidence
 * off IS match play — game for hole, both-right-or-both-wrong for halved,
 * multiplier for glorious — and this is the line that lets it say so with the
 * same engine rather than a second one that resembles it.
 */
export function matchState(
  decided: DecidedHole[],
  holeCount = HOLES,
  weighting: Weighting = NO_GLORIOUS
): MatchState {
  const weightOf = toUnitWeight(weighting);
  const played = new Set<number>();
  let diff = 0;
  let count = 0;
  for (const { hole, result } of decided) {
    count++;
    played.add(hole);
    const w = weightOf(hole);
    if (result === "W") diff += w;
    else if (result === "L") diff -= w;
    const holesLeftRaw = holeCount - count; // raw units still to play (margin Y)
    const swingLeft = remainingSwing(unplayedHoles(holeCount, played), weightOf); // weighted (§4)
    const up = Math.abs(diff);
    if (holesLeftRaw > 0 && up > swingLeft) return finalize(count, diff, holesLeftRaw, swingLeft, true, true);
    if (holesLeftRaw === 0) break;
  }
  const holesLeftRaw = holeCount - count;
  const swingLeft = remainingSwing(unplayedHoles(holeCount, played), weightOf);
  return finalize(count, diff, holesLeftRaw, swingLeft, holesLeftRaw === 0, false);
}

function finalize(
  played: number,
  diff: number,
  holesLeftRaw: number,
  swingLeft: number,
  over: boolean,
  closedEarly: boolean
): MatchState {
  const up = Math.abs(diff);
  // Dormie / close-out are against the WEIGHTED remaining swing (§4), not raw holes.
  const dormie = !over && up === swingLeft && diff !== 0; // up by exactly the swing left
  let margin: string | null = null;
  // Margin string: X = the WEIGHTED lead, Y = RAW holes-to-play. Under glorious the
  // weighted lead can EXCEED the raw holes remaining, so "4&2" (or even "6&2") is a
  // LEGAL, correct margin — it means 4 up weighted with 2 holes physically left, and
  // the match closed because the weighted swing left was smaller than the lead. This
  // "X > Y is legal" is intentional; do NOT "fix" it to look like standard match play.
  if (closedEarly) margin = `${up}&${holesLeftRaw}`; // "3&2" (raw) / "6&2" (glorious)
  else if (over && up) margin = `${up} UP`; // won through the last hole
  else if (over) margin = "AS"; // halved through the last hole
  return {
    thru: played,
    diff,
    up,
    holesLeft: holesLeftRaw, // raw holes-to-play (kept raw — the margin's Y and the display count)
    over,
    closed: closedEarly,
    dormie,
    leader: diff > 0 ? "A" : diff < 0 ? "B" : null,
    margin,
  };
}
