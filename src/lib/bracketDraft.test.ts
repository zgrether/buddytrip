import { describe, it, expect } from "vitest";
import { shufflePool, entrantCap, bracketFieldReady, MIN_BRACKET_FIELD } from "./bracketDraft";
import type { BracketConfig } from "./configDraft";

const CFG: BracketConfig = { elimination: "single", entrants: "partners", seeding: "manual", consolation: false };

/** Two teams of four. */
const TEAMS = [
  { id: "A", players: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }] },
  { id: "B", players: [{ id: "b1" }, { id: "b2" }, { id: "b3" }, { id: "b4" }] },
];
const teamOf = (e: string[]) => e[0][0].toUpperCase();

/** Deterministic "random" so the shuffle is testable — a fixed cycle, not a stub
 *  that returns one value (which would make Fisher-Yates a no-op and hide bugs). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("entrantCap", () => {
  it("is the members-per-entrant the picker closes at", () => {
    expect(entrantCap({ ...CFG, entrants: "singles" })).toBe(1);
    expect(entrantCap({ ...CFG, entrants: "partners" })).toBe(2);
  });
});

describe("shufflePool — randomising the seeding IS reordering the pool", () => {
  it("keeps every entrant, exactly once", () => {
    const pool = [["a1"], ["a2"], ["b1"], ["b2"], ["b3"]];
    const out = shufflePool(pool, TEAMS, { avoidTeammates: false, random: seeded(7) });
    expect(out.flat().sort()).toEqual(["a1", "a2", "b1", "b2", "b3"]);
  });

  it("drops empty slots — an empty seed is an entrant nobody can play", () => {
    const out = shufflePool([["a1"], [], ["b1"]], TEAMS, { avoidTeammates: false, random: seeded(3) });
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.length > 0)).toBe(true);
  });

  it("keeps pairs intact — it reorders entrants, never their members", () => {
    const pool = [["a1", "a2"], ["b1", "b2"]];
    const out = shufflePool(pool, TEAMS, { avoidTeammates: false, random: seeded(11) });
    expect(out.map((e) => [...e].sort())).toEqual(expect.arrayContaining([["a1", "a2"], ["b1", "b2"]]));
  });

  it("does not mutate the input", () => {
    const pool = [["a1"], ["b1"], ["a2"]];
    const before = JSON.stringify(pool);
    shufflePool(pool, TEAMS, { avoidTeammates: false, random: seeded(5) });
    expect(JSON.stringify(pool)).toBe(before);
  });

  it("a field too small to play comes back as-is", () => {
    expect(shufflePool([["a1"]], TEAMS, { avoidTeammates: false, random: seeded(1) })).toEqual([["a1"]]);
    expect(shufflePool([], TEAMS, { avoidTeammates: false, random: seeded(1) })).toEqual([]);
  });

  it("actually reorders — it is not an accidental identity", () => {
    const pool = [["a1"], ["a2"], ["a3"], ["a4"], ["b1"], ["b2"], ["b3"], ["b4"]];
    const orders = new Set(
      [1, 2, 3, 4, 5].map((s) => shufflePool(pool, TEAMS, { avoidTeammates: false, random: seeded(s) }).flat().join(",")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("shufflePool — spreading teammates", () => {
  it("a balanced field alternates teams, so no round-1 pair is same-team", () => {
    // Round 1 pairs seeds via the bracket order; alternating teams by seed is the
    // strongest thing the pool order can do about it.
    const pool = [["a1"], ["a2"], ["a3"], ["a4"], ["b1"], ["b2"], ["b3"], ["b4"]];
    for (const s of [1, 2, 3, 9, 42]) {
      const out = shufflePool(pool, TEAMS, { avoidTeammates: true, random: seeded(s) });
      const teams = out.map(teamOf);
      for (let i = 1; i < teams.length; i++) expect(teams[i]).not.toBe(teams[i - 1]);
    }
  });

  it("an UNBALANCED field cannot avoid every repeat, and does not pretend to", () => {
    // Five from A, one from B: four A-adjacencies are forced. The guarantee is
    // "as spread as the field allows", not "never".
    const pool = [["a1"], ["a2"], ["a3"], ["a4"], ["b1"]];
    const out = shufflePool(pool, [{ id: "A", players: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }] }, { id: "B", players: [{ id: "b1" }] }], {
      avoidTeammates: true,
      random: seeded(4),
    });
    expect(out).toHaveLength(5);
    // B is placed somewhere in the middle rather than stacked at an end.
    expect(out.flat()).toContain("b1");
  });

  it("still keeps every entrant exactly once", () => {
    const pool = [["a1"], ["a2"], ["b1"], ["b2"], ["b3"]];
    const out = shufflePool(pool, TEAMS, { avoidTeammates: true, random: seeded(8) });
    expect(out.flat().sort()).toEqual(["a1", "a2", "b1", "b2", "b3"]);
  });

  it("an entrant on no team is still placed, not dropped", () => {
    const out = shufflePool([["x1"], ["a1"], ["b1"]], TEAMS, { avoidTeammates: true, random: seeded(6) });
    expect(out.flat().sort()).toEqual(["a1", "b1", "x1"]);
  });
});

/**
 * The go-live field gate (#917) — the CLIENT half.
 *
 * Phase 2c made Bracket selectable without requiring the setup to have
 * happened, so scoring could be enabled on an empty draw and the crew would
 * arrive at a game with nothing to play. Migration 117 refuses it server-side;
 * this is the second opinion that stops the Save bar offering the action at all.
 *
 * The predicate answers for every non-golf format, not just brackets, so the
 * call site is one `&&` rather than a conditional — a conditional is what gets
 * accidentally skipped.
 */
describe("bracketFieldReady", () => {
  it("a NON-bracket game has no field to be short of", () => {
    expect(bracketFieldReady(false, [])).toBe(true);
    expect(bracketFieldReady(false, [["a1"]])).toBe(true);
  });

  it("refuses an empty field and a one-entrant one", () => {
    // One entrant has nobody to play — `buildDraw(1)` produces no match, so a
    // live one-entrant bracket would show an empty draw.
    expect(bracketFieldReady(true, [])).toBe(false);
    expect(bracketFieldReady(true, [["a1"]])).toBe(false);
  });

  it("two entrants is enough — the smallest field with a game in it", () => {
    expect(bracketFieldReady(true, [["a1"], ["b1"]])).toBe(true);
  });

  it("counts FILLED entrants — an empty slot the builder left behind isn't one", () => {
    // The builder leaves an empty group when a partner is removed. Counting it
    // would let a bracket go live one entrant short of what the draw will hold,
    // and the payload drops those slots anyway.
    expect(bracketFieldReady(true, [["a1"], []])).toBe(false);
    expect(bracketFieldReady(true, [["a1"], [], ["b1"]])).toBe(true);
  });

  it("partners count as ONE entrant each, not two players", () => {
    // The field is entrants, not people: one pair is one competitor.
    expect(bracketFieldReady(true, [["a1", "a2"]])).toBe(false);
    expect(bracketFieldReady(true, [["a1", "a2"], ["b1", "b2"]])).toBe(true);
  });

  it("agrees with the constant the SQL copy is written against", () => {
    // The number lives here, in migration 117, and in `bracketPlaceCapacity`.
    // The SQL can't import it, so this pins the TypeScript side to one value.
    expect(MIN_BRACKET_FIELD).toBe(2);
  });
});
