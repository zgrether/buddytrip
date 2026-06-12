/**
 * Course stroke-index correctness core (Slice C part 2, §3) — PURE, client-safe.
 *
 * Stroke index must be a valid permutation of 1..N (N = holes): each value used
 * exactly once, no gaps, no dupes. `strokeHoles` allocates handicap strokes to
 * the lowest-index holes, so a dup/gap silently mis-allocates EVERY stroke — the
 * highest-stakes correctness rule in the picker. These helpers (a) validate a
 * set and (b) implement swap-on-edit so an invalid set is impossible to enter.
 *
 * Used by the picker UI (swap + gate) and the server (re-validate on apply); no
 * DB / provider deps so both sides share the same rules and can't diverge.
 */

export type IndexEntry = number | null | undefined;

export interface IndexValidation {
  /** A complete, valid permutation of 1..N. */
  valid: boolean;
  /** 1-based hole numbers with no index set. */
  unsetHoles: number[];
  /** 1-based holes whose value duplicates another hole's. */
  duplicateHoles: number[];
  /** 1-based holes whose value is < 1 or > N. */
  outOfRangeHoles: number[];
}

/** Validate a stroke-index set against a permutation of 1..n. */
export function validateStrokeIndex(index: IndexEntry[], n: number): IndexValidation {
  const unsetHoles: number[] = [];
  const outOfRangeHoles: number[] = [];
  const holesByValue = new Map<number, number[]>();

  for (let i = 0; i < n; i++) {
    const v = index[i];
    if (v == null) {
      unsetHoles.push(i + 1);
      continue;
    }
    if (!Number.isInteger(v) || v < 1 || v > n) {
      outOfRangeHoles.push(i + 1);
      continue;
    }
    const holes = holesByValue.get(v) ?? [];
    holes.push(i + 1);
    holesByValue.set(v, holes);
  }

  const duplicateHoles: number[] = [];
  for (const holes of holesByValue.values()) {
    if (holes.length > 1) duplicateHoles.push(...holes);
  }
  duplicateHoles.sort((a, b) => a - b);

  const valid =
    unsetHoles.length === 0 && outOfRangeHoles.length === 0 && duplicateHoles.length === 0;
  return { valid, unsetHoles, duplicateHoles, outOfRangeHoles };
}

/**
 * Swap-on-edit (§3). Set hole `holeIdx` (0-based) to `newValue`; whichever hole
 * currently holds `newValue` takes this hole's previous index (which may be
 * null — still a clean swap). If no hole holds `newValue` yet, it's a plain
 * set. Never mutates the input — returns a fresh array.
 */
export function applyStrokeIndexSwap(
  index: IndexEntry[],
  holeIdx: number,
  newValue: number
): IndexEntry[] {
  const next = [...index];
  const prev = next[holeIdx] ?? null;
  const otherIdx = next.findIndex((v, i) => i !== holeIdx && v === newValue);
  next[holeIdx] = newValue;
  if (otherIdx !== -1) next[otherIdx] = prev;
  return next;
}

// ── Scorecard-schema contract (§0) ─────────────────────────────────────────
// Minimal shape of game_type_templates.scorecard_schema we read/patch. We patch
// units.metadata.{par,handicap_index} + labels/count/sections to the course's
// hole layout; everything else on the template is preserved verbatim.

export interface ScorecardUnits {
  type?: string;
  count?: number;
  ordered?: boolean;
  labels?: string[];
  metadata?: { par?: number[]; handicap_index?: number[]; [k: string]: unknown };
}
export interface ScorecardScoring {
  strategy?: string;
  direction?: string;
  sections?: { name: string; units: string[] }[];
}
export interface ScorecardSchema {
  units: ScorecardUnits;
  scoring?: ScorecardScoring;
  [k: string]: unknown;
}

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/**
 * Build the per-game scorecard_schema snapshot (§0 contract): clone the template
 * and overwrite the hole layout (count/labels/sections) + metadata.par +
 * metadata.handicap_index with the applied course's data. Front/back sections
 * follow the 1..9 / 10..N split; a 9-hole course has a single Front section.
 */
export function buildScorecardSchema(
  template: ScorecardSchema,
  par: number[],
  handicapIndex: number[] | null | undefined,
  holeCount: number
): ScorecardSchema {
  const next = JSON.parse(JSON.stringify(template)) as ScorecardSchema;
  const labels = range(1, holeCount);
  // A course without a real index (stroke index off) snapshots a sequential
  // 1..N index of the right length — net falls back to hole order; it never
  // leaves a stale 18-long template index on a 9-hole game.
  const index = handicapIndex?.length ? handicapIndex : Array.from({ length: holeCount }, (_, i) => i + 1);

  next.units = {
    ...next.units,
    count: holeCount,
    labels,
    metadata: { ...(next.units.metadata ?? {}), par, handicap_index: index },
  };

  if (next.scoring) {
    const frontName = next.scoring.sections?.[0]?.name ?? "Front 9";
    const backName = next.scoring.sections?.[1]?.name ?? "Back 9";
    next.scoring = {
      ...next.scoring,
      sections:
        holeCount > 9
          ? [
              { name: frontName, units: range(1, 9) },
              { name: backName, units: range(10, holeCount) },
            ]
          : [{ name: frontName, units: labels }],
    };
  }

  return next;
}
