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

import { buildScorecardSchema, validateStrokeIndex, type SnapshotTee, type ScorecardSchema } from "./courseIndex";
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
