import { describe, it, expect } from "vitest";
import {
  GAME_TYPE_DEFINITIONS,
  GAME_TYPE_LIST,
  canBeSideGame,
  canPlayInTeamlessRace,
  isGameTypeForScoringModel,
  teamlessRaceAdmits,
  type GameTypeDefinition,
  type ResultKind,
} from "./gameTypes";
import { BROADCAST_TABLES, type BroadcastTable } from "./broadcastTables";

/**
 * EVERY FORMAT DECLARES EVERY PROPERTY (PR 1 of the composable-competitions plan).
 *
 * ── What this guards that `tsc` does not ───────────────────────────────────
 *
 * The compiler already refuses a format missing `resultKinds`, `teamDependent`
 * or `allowedContainers` (deleted in PR 9e) — adding the fields produced ten errors naming ten
 * formats, which is the presence check done for free. **A runtime test that
 * only re-asserts presence would be inert**: it could never fail on a tree that
 * compiles, and it would look exactly like protection.
 *
 * So this checks the three things the type system permits and the model does
 * not:
 *
 *   1. An EMPTY array. `resultKinds: []` type-checks and means "this format
 *      produces no result at all" — the plan's principle 3 exactly, empty
 *      rendering as unknown. `[]` is truthy, so a consumer branching on the
 *      array would sail past it.
 *   2. A DUPLICATE entry. `["ranked", "ranked"]` type-checks and would make a
 *      "declares both kinds" test pass for a format that declares one twice.
 *   3. A format silently absent from the catalog — the scan finding nothing,
 *      which is the failure mode of every guard in this repo that was later
 *      found inert.
 *
 * ── The red proof is in the file, not run once by hand ─────────────────────
 *
 * `rejects a format that declares nothing` below feeds a stub through the SAME
 * validator the real formats go through. If it ever goes green, the validator
 * has stopped being able to fail and the `it.each` above it proves nothing.
 */

const RESULT_KINDS: ResultKind[] = ["head_to_head", "ranked"];
/**
 * No container check: `allowedContainers` was deleted in PR 9e. Its
 * `head_to_head` half was never read, and its `points_race` half said the same
 * as `compatibleScoringModels` for all ten formats once PR 5 landed — so the
 * scoring-model list is the one source, and its invariant (rack) is asserted
 * over the real catalog further down, through the add-game filter's own rule.
 */
/**
 * `scoreTables` (#1432): any broadcasting table EXCEPT `games`. `tsc` already
 * refuses a table outside `BROADCAST_TABLES`; `games` is in that list (its
 * lifecycle broadcasts) but holds no scores, and the type cannot say so.
 */
const SCORE_TABLES: readonly BroadcastTable[] = BROADCAST_TABLES.filter((t) => t !== "games");

/** Every problem with one format's declarations. Empty array = declared well. */
function declarationFaults(d: GameTypeDefinition): string[] {
  const faults: string[] = [];
  const set = <T>(label: string, vals: T[], legal: readonly T[]) => {
    if (!Array.isArray(vals)) { faults.push(`${label} is not an array`); return; }
    if (vals.length === 0) faults.push(`${label} is empty`);
    if (new Set(vals).size !== vals.length) faults.push(`${label} has duplicates`);
    for (const v of vals) if (!legal.includes(v)) faults.push(`${label} has illegal value ${String(v)}`);
  };
  set("resultKinds", d.resultKinds, RESULT_KINDS);
  set("scoreTables", d.scoreTables, SCORE_TABLES);
  if (typeof d.teamDependent !== "boolean") faults.push("teamDependent is not a boolean");
  return faults;
}

describe("declared format properties", () => {
  it("finds the formats at all — a scan over nothing proves nothing", () => {
    // The guard's own premise. Every assertion below iterates this list, so an
    // empty or truncated one would report coverage it does not have.
    expect(GAME_TYPE_LIST.length).toBeGreaterThanOrEqual(10);
    const ids = GAME_TYPE_LIST.map((d) => d.id);
    // Named explicitly rather than counted: a format RENAMED out of the catalog
    // would keep the count and lose the coverage.
    for (const id of ["gtt_stroke_play", "gtt_match_play", "gtt_rack_n_stack", "gtt_pickem", "gtt_manual"]) {
      expect(ids, `${id} missing from the catalog`).toContain(id);
    }
  });

  it.each(GAME_TYPE_LIST.map((d) => [d.id, d] as const))(
    "%s declares every property, with legal non-empty values",
    (_id, d) => {
      expect(declarationFaults(d)).toEqual([]);
    }
  );

  /**
   * THE RED PROOF. A stub that type-checks — every field present, correct
   * types — and is still a lie: it produces no result kind and fits no
   * container. Cast because the point is a value the COMPILER accepts.
   */
  it("rejects a format that declares nothing — the validator can fail", () => {
    const stub = {
      ...GAME_TYPE_LIST[0],
      id: "gtt_stub",
      resultKinds: [] as ResultKind[],
      scoreTables: [] as BroadcastTable[],
    } as GameTypeDefinition;
    expect(declarationFaults(stub)).toEqual([
      "resultKinds is empty",
      "scoreTables is empty",
    ]);
  });

  it("rejects `games` as a score table — it broadcasts, but holds no scores (#1432)", () => {
    const stub = {
      ...GAME_TYPE_LIST[0],
      id: "gtt_stub",
      scoreTables: ["games", "game_results"] as BroadcastTable[],
    } as GameTypeDefinition;
    expect(declarationFaults(stub)).toContain("scoreTables has illegal value games");
  });

  it("every format declares game_results — the finalize writes it for all of them", () => {
    // `games.finish` is the one finalize (CLAUDE.md #8) and every arm writes
    // `game_results`; a format omitting it has declared a set that is wrong.
    for (const d of GAME_TYPE_LIST) {
      expect(d.scoreTables, d.id).toContain("game_results");
    }
  });

  it("rejects a duplicate entry — `both kinds` must mean two kinds", () => {
    const stub = {
      ...GAME_TYPE_LIST[0],
      id: "gtt_stub",
      resultKinds: ["ranked", "ranked"] as ResultKind[],
    } as GameTypeDefinition;
    expect(declarationFaults(stub)).toContain("resultKinds has duplicates");
  });

  /**
   * The model's own invariants, asserted over the real catalog rather than
   * restated in prose. Each is a ruling that would otherwise live only here.
   */
  /**
   * This used to assert `allowedContainers` was `["head_to_head"]` under a name
   * about SIDE games — which `allowedContainers` stopped deciding in PR 7. The
   * name claimed a path the assertion did not take. Both facts now, each read
   * from the field that actually decides it.
   */
  it("rack lives in a head-to-head cup only: never a points tournament, never a side game (rulings 12, 27)", () => {
    const rack = GAME_TYPE_LIST.find((d) => d.id === "gtt_rack_n_stack")!;
    expect(isGameTypeForScoringModel(rack, "points")).toBe(false);
    expect(canBeSideGame(rack.id)).toBe(false);
  });

  /**
   * THE GUARD NO CURRENT FORMAT CAN TRIP, made visible. A tournament of
   * individuals refuses a format that records per-person results but does not
   * fit a points competition. No catalog entry is both today — every per-person
   * format fits points — so the check decides nothing on the real catalog, and a
   * guard nothing can see fail is one a tidy-up deletes unnoticed (Zach, #1600).
   * A synthetic declaration is the only way to exercise it; the control beside it
   * proves the same declaration IS admitted once points is allowed, so the
   * refusal is the scoring-model check and nothing else.
   */
  it("refuses a per-person format that is barred from points tournaments", () => {
    const barred = { recordsPerPersonResults: true, compatibleScoringModels: ["match_play"] as GameTypeDefinition["compatibleScoringModels"] };
    expect(teamlessRaceAdmits(barred)).toBe(false);
    expect(teamlessRaceAdmits({ ...barred, compatibleScoringModels: ["match_play", "points"] })).toBe(true);
    expect(teamlessRaceAdmits({ ...barred, compatibleScoringModels: null })).toBe(true);
  });

  /** And it is the ONLY one: every other format may be played in a points
   *  tournament. Stated as the set, so a format losing it is named here. */
  it("rack is the only format barred from a points tournament", () => {
    expect(GAME_TYPE_LIST.filter((d) => !isGameTypeForScoringModel(d, "points")).map((d) => d.id)).toEqual(["gtt_rack_n_stack"]);
  });

  /**
   * EXACTLY the formats that record a result with no competition — stated as the
   * set, so a format gaining `side_game` without the engine to back it fails here
   * rather than passing a `some` check. PR 6 is the first reader and offers
   * *side game* from this list, so a false entry is a screen offering a game that
   * would finish with nothing recorded.
   *
   * Why each other format is out (2026-09-27, PR 6's verify-first pass):
   *  - rack — by ruling (12, 27): its two sides ARE the cup's two teams;
   *  - scramble — groups are seeded only from a cup's teams, and the groupings
   *    row is hidden;
   *  - pick'em — the finalize has nobody to award without a cup, writes nothing;
   *  - the generic types (card, yard, bar, manual) — placements rank the cup's
   *    teams and Matches pays team points; only a bracket records a winner, and
   *    the declaration is per type, not per competition_format. PR 7.
   */
  it("side games are exactly stroke play, match play and skins", () => {
    const sideGame = GAME_TYPE_LIST.filter((d) => canBeSideGame(d.id));
    expect(sideGame.map((d) => d.id).sort()).toEqual(["gtt_match_play", "gtt_skins", "gtt_stroke_play"]);
  });

  /**
   * PR 7 ruling 1: a TEAMLESS race admits the same three, for the same reason —
   * each records a result per person, and a race with no teams has only people
   * to pay. Stated as the exact set, like the side-game set above, and read
   * through the helper the create door and the picker use.
   */
  it("a teamless race holds exactly stroke play, match play and skins", () => {
    const teamless = GAME_TYPE_LIST.filter((d) => canPlayInTeamlessRace(d.id));
    expect(teamless.map((d) => d.id).sort()).toEqual(["gtt_match_play", "gtt_skins", "gtt_stroke_play"]);
  });

  /**
   * ONE declaration, not two lists (ruling 1). The helpers must both rest on
   * `recordsPerPersonResults`: a format that flips it moves in or out of BOTH.
   * Checked per format by flipping it on a copy, which a helper reading anything
   * else (a hard-coded list, the old `side_game` container) cannot follow.
   */
  it("side game and teamless race both follow recordsPerPersonResults, per format", () => {
    for (const d of GAME_TYPE_LIST) {
      const flipped = { ...d, recordsPerPersonResults: !d.recordsPerPersonResults };
      const orig = GAME_TYPE_DEFINITIONS[d.id];
      try {
        GAME_TYPE_DEFINITIONS[d.id] = flipped;
        expect(canBeSideGame(d.id), `${d.id}: canBeSideGame ignores the declaration`).toBe(flipped.recordsPerPersonResults);
        if (!flipped.recordsPerPersonResults) {
          expect(canPlayInTeamlessRace(d.id), `${d.id}: teamless admits a format with no per-person writer`).toBe(false);
        }
      } finally {
        GAME_TYPE_DEFINITIONS[d.id] = orig;
      }
    }
  });

  it("pick'em is the engine format declaring both kinds (ruling: roll_up pins it)", () => {
    const pickem = GAME_TYPE_LIST.find((d) => d.id === "gtt_pickem")!;
    expect([...pickem.resultKinds].sort()).toEqual(["head_to_head", "ranked"]);
  });

  it("individually scored ranked formats are not team-dependent (ruling 18)", () => {
    const independent = GAME_TYPE_LIST.filter((d) => !d.teamDependent).map((d) => d.id).sort();
    // The exact set. `teamDependent` gates whether a correction may re-attribute
    // a past result, so a format joining or leaving this list is a change to
    // what PR 8 is allowed to rewrite — it should never happen silently.
    expect(independent).toEqual(["gtt_skins", "gtt_stroke_play"]);
  });

  it("scramble is ranked AND team-dependent — the pair that stops direction being derivable", () => {
    const scramble = GAME_TYPE_LIST.find((d) => d.id === "gtt_scramble")!;
    expect(scramble.resultKinds).toEqual(["ranked"]);
    expect(scramble.teamDependent).toBe(true);
  });
});
