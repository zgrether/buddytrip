import { teeColor } from "@/lib/courseService";

/**
 * Multi-tee scorecard yardage rows (Spec 5b) — DISPLAY ONLY. The game still runs
 * off the ONE chosen tee (scoring / structure / handicaps all key off the snapshot
 * as before); this just assembles the *reference* yardage rows the scorecard shows
 * for every tee.
 *
 * The data is already there: `courses.tee_sets` stores each tee's per-hole yardage
 * (migration 059). par + stroke index are course-level (identical across tees), so
 * only yardage varies — one row per tee. Colors are derived from the tee NAME via
 * the shared `teeColor()` helper (the app's tee-color convention; not stored).
 *
 * Pure + client-safe (no React / tRPC / DB) so it's unit-testable and shared by
 * every scorecard consumer through the hook that fetches the course record(s).
 */

/** A stored tee (a `courses.tee_sets` element — only the fields we render). */
export interface RawTee {
  name: string;
  yards: (number | null)[];
}

/** One assembled tee row for the scorecard. */
export interface TeeRow {
  name: string;
  /** Display color from the tee name (identity palette, e.g. Blue → blue). */
  color: string;
  /** Per-hole yardage across the full round (holeCount long; null where absent). */
  yards: (number | null)[];
  /** Sum of present yardages — drives the hardest→easiest order + the Total cell. */
  total: number;
  /** The tee actually in play (matches the game's snapshot tee) — brighter + never hidable. */
  isChosen: boolean;
  /** Shown by default: the chosen tee + its immediate neighbors (one each side). */
  defaultVisible: boolean;
}

const sum = (ys: (number | null)[]) => ys.reduce((a: number, y) => a + (y ?? 0), 0);

/** Front-9 slice of a tee's yards, padded to 9 (mirrors composeTwoNines' f9). */
function nine(ys: (number | null)[] | undefined): (number | null)[] {
  return (ys ?? []).slice(0, 9).concat(Array<number | null>(9).fill(null)).slice(0, 9);
}

/**
 * Assemble the tee rows for a game's course.
 *
 * - Single course → each tee's yards as-is (clipped to holeCount).
 * - Combined two-nines (backTees present) → the tee LIST is the FRONT course's
 *   tees; each is composed front-9 ⊕ back-9, matching the back tee BY NAME with a
 *   first-tee fallback — exactly the inheritance `setBackNine` uses. (par/index are
 *   already course-level; only yardage is composed here.)
 *
 * Rows are ordered longest→shortest total (back tees first, "behind"→"in front").
 * `defaultVisible` = the chosen tee + one neighbor each side, clamped at the ends
 * (no phantom neighbor). If no tee matches the chosen name, none is marked chosen
 * and the first (longest) row anchors the default window.
 */
export function buildTeeRows(opts: {
  chosenTeeName: string | null;
  holeCount: number;
  frontTees: RawTee[];
  backTees?: RawTee[] | null;
}): TeeRow[] {
  const { chosenTeeName, holeCount, frontTees, backTees } = opts;
  if (!frontTees?.length) return [];

  const chosen = (chosenTeeName ?? "").trim().toLowerCase();
  const composed: { name: string; yards: (number | null)[] }[] = frontTees.map((ft) => {
    if (backTees && backTees.length > 0) {
      const bt =
        backTees.find((b) => b.name.trim().toLowerCase() === ft.name.trim().toLowerCase()) ??
        backTees[0];
      return { name: ft.name, yards: [...nine(ft.yards), ...nine(bt?.yards)] };
    }
    return { name: ft.name, yards: (ft.yards ?? []).slice(0, holeCount) };
  });

  const rows: TeeRow[] = composed.map((t) => ({
    name: t.name,
    color: teeColor(t.name),
    yards: t.yards,
    total: sum(t.yards),
    isChosen: !!chosen && t.name.trim().toLowerCase() === chosen,
    defaultVisible: false,
  }));

  // Longest → shortest (back → front). Stable enough for equal totals (rare).
  rows.sort((a, b) => b.total - a.total);

  // Default window: chosen ± 1 neighbor, clamped. Anchor on the chosen row, else
  // the first (longest) row so a course with an unrecognized chosen name still
  // shows a sensible default set.
  const anchor = Math.max(0, rows.findIndex((r) => r.isChosen));
  for (let i = anchor - 1; i <= anchor + 1; i++) {
    if (i >= 0 && i < rows.length) rows[i].defaultVisible = true;
  }
  return rows;
}
