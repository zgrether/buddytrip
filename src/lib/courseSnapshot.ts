/**
 * buildCourseSnapshot — the ONE pure "apply a course to a game" derivation.
 *
 * Applying a course SNAPSHOTS its par[] + stroke index (+ the selected tee's
 * yards/ratings) into the game's `scorecard_schema`, freezing the course facts the
 * round was set up with. That derivation used to live inline in the server's
 * `games.applyCourse`; it's lifted here so BOTH sides run the same function:
 *
 *  - `games.applyCourse` (server) — the existing immediate-apply path.
 *  - the settings draft (client) — draft-then-save pre-computes the snapshot and
 *    hands it to `save_game_config` ready-to-write (spec §2.2 Design A: the client
 *    pre-computes every derived value; the plpgsql only writes).
 *
 * Keeping it pure + client-safe (no tRPC/DB — the caller supplies the course row)
 * is what stops the drafted snapshot and the server-applied one from drifting —
 * the same shared-pure-fn discipline as strokePlay/matchPlay (CLAUDE.md #8).
 */

import {
  buildScorecardSchema,
  composeTwoNines,
  validateStrokeIndex,
  type SnapshotTee,
  type ScorecardSchema,
} from "./courseIndex";
import { getGameTypeDefinition } from "./gameTypes";

/** The `courses` row fields the snapshot needs (a subset of `courses.getById`). */
export interface CourseSnapshotInput {
  hole_count: number;
  par: number[];
  handicap_index: number[] | null;
  /** Index-off course → snapshot par only (buildScorecardSchema fills a sequential
   *  index; net falls back to hole order). Defaults to true. */
  has_stroke_index?: boolean | null;
  tee_sets?: SnapshotTee[] | null;
}

export type CourseSnapshotResult =
  | { ok: true; schema: ScorecardSchema }
  /** The course's stroke index isn't a valid permutation — refuse to snapshot it. */
  | { ok: false; reason: "bad_index" }
  /** The game's format has no scorecard schema to snapshot onto. */
  | { ok: false; reason: "no_base_schema" };

/**
 * Build the scorecard snapshot for `courseRow` applied to a `gameTypeId` game.
 *
 * The SELECTED tee (by name, else the first) is snapshotted — not a hardcoded
 * default — which is what keeps displayed yardage honest to the round's setup.
 * An index-on course is validated as defense in depth before snapshotting.
 */
export function buildCourseSnapshot(
  courseRow: CourseSnapshotInput,
  gameTypeId: string,
  teeSetName?: string | null
): CourseSnapshotResult {
  const holeCount = courseRow.hole_count;
  const par = courseRow.par;
  const hasIndex = courseRow.has_stroke_index ?? true;

  // Resolve the configured tee: the requested name, else the first tee.
  const teeSets = courseRow.tee_sets ?? [];
  const selectedTee =
    (teeSetName ? teeSets.find((t) => t.name === teeSetName) : undefined) ?? teeSets[0] ?? null;

  const handicapIndex = hasIndex ? courseRow.handicap_index : null;
  if (hasIndex && !validateStrokeIndex(handicapIndex ?? [], holeCount).valid) {
    return { ok: false, reason: "bad_index" };
  }

  // Base scorecard comes from the format definition in code (W-PERF-01) —
  // buildScorecardSchema deep-clones it, so sharing the const is safe.
  const baseSchema = getGameTypeDefinition(gameTypeId)?.scorecardSchema ?? null;
  if (!baseSchema?.units) return { ok: false, reason: "no_base_schema" };

  return { ok: true, schema: buildScorecardSchema(baseSchema, par, handicapIndex, holeCount, selectedTee) };
}

// ── Two-nines compose (the back-nine half of the same contract) ───────────────

/** The state `buildComposedCourseSnapshot` composes a back nine ONTO: the game's
 *  current snapshot (the front nine's frozen facts) plus whether it already
 *  carries a back ref (a composed 18 being SWAPPED vs a lone 9 taking its first
 *  back). */
export interface ComposeSnapshotInput {
  /** `games.scorecard_schema` as it stands — the front's snapshotted par/index/tee. */
  frontSchema: ScorecardSchema | null;
  /** `games.back_course_id != null` — true ⟺ this is a back-nine SWAP. */
  hasBackRef: boolean;
  /** The back nine's `courses` row. */
  backCourse: CourseSnapshotInput;
}

export type ComposeSnapshotResult =
  | { ok: true; schema: ScorecardSchema }
  /** No front snapshot to compose onto (no course applied yet). */
  | { ok: false; reason: "no_front" }
  /** A real 18 with no back ref doesn't take a back nine. */
  | { ok: false; reason: "not_two_nines" }
  /** The back course isn't 9 holes. */
  | { ok: false; reason: "back_not_nine" }
  /** The back's stroke index isn't a valid permutation of 1..9. */
  | { ok: false; reason: "bad_back_index" }
  | { ok: false; reason: "no_base_schema" };

/**
 * Compose a back nine onto an existing front — the ONE pure two-nines derivation.
 *
 * Lifted VERBATIM out of the server's `games.setBackNine` (the same de-interleave
 * → `composeTwoNines` → `buildScorecardSchema` chain, the same tee-inheritance
 * fallback) so BOTH sides run it, exactly like `buildCourseSnapshot`:
 *
 *  - `games.setBackNine` (server) — the immediate-apply path.
 *  - the settings draft (client) — draft-then-save pre-computes the composed 18
 *    and hands it to `save_game_config` ready-to-write.
 *
 * The composed tee NAME stays the FRONT's (the round is played off one tee set);
 * `backTeeSetName` only picks which of the back course's tees supplies the back-9
 * yardages, inheriting the front's tee name when the back course has one by that
 * name and falling back to its first tee when it doesn't (the UI surfaces that).
 */
export function buildComposedCourseSnapshot(
  input: ComposeSnapshotInput,
  gameTypeId: string,
  backTeeSetName?: string | null
): ComposeSnapshotResult {
  const { frontSchema, hasBackRef, backCourse } = input;
  const frontMeta = frontSchema?.units?.metadata;
  const frontCount = frontSchema?.units?.count ?? frontMeta?.par?.length ?? 0;

  // Only a two-nines game takes a back: a 9-hole front composing its first, or an
  // already-composed 18 swapping it. A real 18 (count 18, no back ref) is refused.
  if (!frontMeta?.par?.length) return { ok: false, reason: "no_front" };
  if (frontCount === 18 && !hasBackRef) return { ok: false, reason: "not_two_nines" };

  if (backCourse.hole_count !== 9) return { ok: false, reason: "back_not_nine" };
  const backHasIndex = (backCourse.has_stroke_index ?? true) && Array.isArray(backCourse.handicap_index);
  if (backHasIndex && !validateStrokeIndex(backCourse.handicap_index ?? [], 9).valid) {
    return { ok: false, reason: "bad_back_index" };
  }

  // Back-nine tee INHERITS the front's tee NAME (pin #3); an explicit override
  // wins; else the back's first tee.
  const backTees = backCourse.tee_sets ?? [];
  const frontTeeName = frontMeta.tee?.name?.trim();
  const backTee =
    (backTeeSetName ? backTees.find((t) => t.name === backTeeSetName) : undefined) ??
    (frontTeeName ? backTees.find((t) => (t.name ?? "").trim() === frontTeeName) : undefined) ??
    backTees[0] ??
    null;

  // Recover the FRONT's ORIGINAL 1..9 index from the snapshot. On a first compose
  // the schema IS a 9-hole front (index already 1..9). On a SWAP it's the
  // previously-composed 18, whose first 9 values are the INTERLEAVED odd ranks
  // (2·s−1) — de-interleave them ((v+1)/2) so the re-compose is correct against
  // the new back. (par/yards just slice; only the index interleaves.)
  const frontIdx9: number[] | null = frontMeta.handicap_index?.length
    ? frontCount === 18
      ? frontMeta.handicap_index.slice(0, 9).map((v) => (v + 1) / 2)
      : frontMeta.handicap_index.slice(0, 9)
    : null;

  const composed = composeTwoNines(
    { par: frontMeta.par.slice(0, 9), index: frontIdx9, yards: frontMeta.tee?.yards?.slice(0, 9) ?? null },
    { par: backCourse.par, index: backHasIndex ? (backCourse.handicap_index ?? null) : null, yards: backTee?.yards ?? null }
  );
  const composedTee: SnapshotTee | null = frontMeta.tee
    ? { ...frontMeta.tee, yards: composed.yards }
    : backTee
      ? { ...backTee, yards: composed.yards }
      : null;

  const baseSchema = getGameTypeDefinition(gameTypeId)?.scorecardSchema ?? null;
  if (!baseSchema?.units) return { ok: false, reason: "no_base_schema" };

  return {
    ok: true,
    schema: buildScorecardSchema(baseSchema, composed.par, composed.index, 18, composedTee, backTee?.name ?? null),
  };
}
