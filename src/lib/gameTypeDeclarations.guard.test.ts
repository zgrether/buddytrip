import { describe, it, expect } from "vitest";
import {
  GAME_TYPE_LIST,
  type GameTypeDefinition,
  type ResultKind,
  type GameContainer,
} from "./gameTypes";

/**
 * EVERY FORMAT DECLARES EVERY PROPERTY (PR 1 of the composable-competitions plan).
 *
 * ── What this guards that `tsc` does not ───────────────────────────────────
 *
 * The compiler already refuses a format missing `resultKinds`, `teamDependent`
 * or `allowedContainers` — adding the fields produced ten errors naming ten
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
const CONTAINERS: GameContainer[] = ["side_game", "head_to_head", "points_race"];

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
  set("allowedContainers", d.allowedContainers, CONTAINERS);
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
    "%s declares all three, with legal non-empty values",
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
      allowedContainers: [] as GameContainer[],
    } as GameTypeDefinition;
    expect(declarationFaults(stub)).toEqual([
      "resultKinds is empty",
      "allowedContainers is empty",
    ]);
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
  it("rack is the one format that can never be a side game (rulings 12, 27)", () => {
    const rack = GAME_TYPE_LIST.find((d) => d.id === "gtt_rack_n_stack")!;
    expect(rack.allowedContainers).toEqual(["head_to_head"]);
    // And it is the ONLY one — stated as the exact set, so a second format
    // quietly losing `side_game` fails here rather than passing a `some` check.
    const noSideGame = GAME_TYPE_LIST.filter((d) => !d.allowedContainers.includes("side_game"));
    expect(noSideGame.map((d) => d.id)).toEqual(["gtt_rack_n_stack"]);
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
