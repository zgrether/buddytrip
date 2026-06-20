/**
 * Shared match-play logic (Slice B, singles). The ONE implementation of net
 * allocation and match state — used by both the live strip (client) and the
 * server result computation, so they can never diverge (CLAUDE.md pattern #8).
 *
 * No React, no DB. Net is DERIVED here; gross (`score_entries.value`) is never
 * overwritten (engine decision #16).
 */

export type HoleResult = "W" | "L" | "H"; // A vs B on NET; decided holes only, play order

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

/** gross − strokes received on that hole. */
export function netForHole(gross: number, hole: number, n: number, strokeIndex?: number[]): number {
  return gross - (strokeHoles(n, strokeIndex).has(hole) ? 1 : 0);
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
): HoleResult[] {
  const setA = strokeHoles(strokesA, strokeIndex, holeCount);
  const setB = strokeHoles(strokesB, strokeIndex, holeCount);
  const out: HoleResult[] = [];
  for (let h = 1; h <= holeCount; h++) {
    const ga = grossA[String(h)];
    const gb = grossB[String(h)];
    if (ga == null || gb == null) continue; // undecided — still to play
    const na = ga - (setA.has(h) ? 1 : 0);
    const nb = gb - (setB.has(h) ? 1 : 0);
    out.push(na < nb ? "W" : na > nb ? "L" : "H");
  }
  return out;
}

/**
 * Walk decided holes and FREEZE the official result at the close-out hole —
 * anything after (a "Play it out" hole) is ignored, so a closed 3&2 can't
 * recompute to nonsense when the trailing player wins 17 & 18.
 */
export function matchState(decided: HoleResult[], holeCount = HOLES): MatchState {
  let diff = 0;
  let played = 0;
  for (const r of decided) {
    played++;
    if (r === "W") diff++;
    else if (r === "L") diff--;
    const holesLeft = holeCount - played;
    const up = Math.abs(diff);
    if (holesLeft > 0 && up > holesLeft) return finalize(played, diff, holesLeft, true, true);
    if (holesLeft === 0) break;
  }
  const holesLeft = holeCount - played;
  return finalize(played, diff, holesLeft, holesLeft === 0, false);
}

function finalize(
  played: number,
  diff: number,
  holesLeft: number,
  over: boolean,
  closedEarly: boolean
): MatchState {
  const up = Math.abs(diff);
  const dormie = !over && up === holesLeft && diff !== 0; // up by exactly the holes remaining
  let margin: string | null = null;
  if (closedEarly) margin = `${up}&${holesLeft}`; // "3&2"
  else if (over && up) margin = `${up} UP`; // won through 18
  else if (over) margin = "AS"; // halved through 18
  return {
    thru: played,
    diff,
    up,
    holesLeft,
    over,
    closed: closedEarly,
    dormie,
    leader: diff > 0 ? "A" : diff < 0 ? "B" : null,
    margin,
  };
}
