import {
  configFor,
  scoringOf,
  type ScoringType,
  type StablefordConfig,
  type StablefordRubric,
} from "./stableford";

/**
 * THE WHOLE of a stroke game's `games.config`, read and written in one place.
 *
 * ── Why one module and not two settings that each know their own key ────────
 *
 * `save_game_config` writes `config` as a WHOLE-OBJECT replace:
 *
 *     config = COALESCE(NULLIF(p_payload->'config', 'null'::jsonb), config)
 *
 * An ABSENT `config` key preserves (migration 179 chose that over the
 * `modifiers` shape deliberately), but a PRESENT one replaces everything. So
 * the moment `config` holds two settings, a payload built from one of them
 * silently wipes the other — the MODIFIERS-MUST-ALWAYS-SEND hazard (P2)
 * arriving through a new door, and the existing "an unrelated save wiped the
 * scoring type" case in `games.saveConfig.scoringType.test.ts` is the same
 * failure one step earlier.
 *
 * A rule saying "remember to spread the other key" is the version of this that
 * gets forgotten. `writeStrokeConfig` takes the COMPLETE config as its input
 * type instead, so a caller cannot express a partial one — omitting `rollUp` is
 * a `tsc` error, not a wipe. Same move the required `rubric` argument makes in
 * `computeStrokeLeaderboard`, and for the same reason: the failure mode is an
 * omission, and only the compiler sees an absence.
 */
export interface StrokeGameConfig {
  /** Traditional or Stableford, and the rubric when Stableford. */
  scoring: { type: ScoringType; stableford: StablefordConfig | null };
  /** Whether the board ranks players or their teams. */
  rollUp: StrokeRollUp;
}

/**
 * How a stroke game's board reads.
 *
 * **This is a DISPLAY choice, not a scoring one**, which is what makes it safe
 * to change at any point in a round. Both sets of results are computed and
 * banked on every finalize regardless — `computeStrokePlayResults` writes the
 * `user` rows and the `team` rows in one atomic replace, unconditionally — so
 * this decides which of two already-existing answers the board shows, and
 * nothing about what the game is worth or who won it.
 *
 * That is why it carries no lock. `SCORING_TYPE_LOCKED` (179) exists because a
 * card rescored after the fact was played to a different rubric; nothing
 * analogous applies to choosing which table to look at.
 *
 * `individual` is the default and the resolution of anything unrecognised, so
 * every game that exists today is unaffected — the same safe direction
 * `scoringOf` takes for the scoring block.
 *
 * The vocabulary matches pick'em's `pickem_games.roll_up` on purpose (one word
 * per concept, CLAUDE.md's glossary rule), but the values are stroke's own:
 * pick'em's individual arm is `individual_matches`, and a stroke game has no
 * matches to pair.
 */
export type StrokeRollUp = "individual" | "team_totals";

export const DEFAULT_ROLL_UP: StrokeRollUp = "individual";

/** The board's roll-up, read off `games.config`. Anything unrecognised is
 *  `individual` — see the type's note on why that direction is the safe one. */
export function rollUpOf(config: unknown): StrokeRollUp {
  return (config as { rollUp?: unknown } | null | undefined)?.rollUp === "team_totals"
    ? "team_totals"
    : DEFAULT_ROLL_UP;
}

/** `games.config` → the complete stroke config. Delegates the scoring half to
 *  `scoringOf` rather than re-reading those keys, so there is one reader. */
export function readStrokeConfig(config: unknown): {
  scoring: { type: ScoringType; rubric: StablefordRubric | null };
  rollUp: StrokeRollUp;
} {
  return { scoring: scoringOf(config), rollUp: rollUpOf(config) };
}

/**
 * The complete `games.config` value to send. Takes the WHOLE config — see this
 * module's note: a partial input is the wipe, so it is not expressible.
 *
 * The scoring half delegates to `configFor`, which stays the write side of
 * `scoringOf`; this only adds the key that function has no business knowing
 * about.
 */
export function writeStrokeConfig(c: StrokeGameConfig): Record<string, unknown> {
  return {
    ...configFor(c.scoring.type, c.scoring.stableford),
    // Always written, including the default. The alternative — omit `individual`
    // and let a missing key mean it — makes "switch back to Individual"
    // unsaveable rather than a no-op, which is exactly the bug the `config: `
    // line in `strokeDraftToPayload` already carries a comment about for
    // `scoringType`.
    rollUp: c.rollUp,
  };
}
