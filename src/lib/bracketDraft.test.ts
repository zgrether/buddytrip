import { describe, it, expect } from "vitest";
import {
  shufflePool,
  entrantCap,
  bracketFieldReady,
  MIN_BRACKET_FIELD,
  fieldMembers,
  applyField,
  shufflePairs,
  entrantLabel,
  pairMembers,
  unpairEntrant,
} from "./bracketDraft";
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

/**
 * The three questions, kept apart.
 *
 * These pin the model the setup rework is built on: the field is a SELECTION,
 * pairing is a separate operation over it, and seeding is a third. The tests
 * below exist mostly to stop the three quietly merging again — the previous
 * surface answered all three with one group builder, which is what produced the
 * "this group is full (max 4)" message on a field that was two people short.
 */

describe("fieldMembers", () => {
  it("is the PEOPLE in the field, flattened out of however they're grouped", () => {
    expect(fieldMembers([["a1", "a2"], ["b1"], ["b2", "b3"]])).toEqual(["a1", "a2", "b1", "b2", "b3"]);
  });

  it("an empty pool has an empty field", () => {
    expect(fieldMembers([])).toEqual([]);
  });
});

describe("applyField", () => {
  it("appends new members as SOLO entrants — it does not pair or sort them", () => {
    expect(applyField([], ["a1", "a2", "b1"])).toEqual([["a1"], ["a2"], ["b1"]]);
  });

  it("preserves existing pairs and their order when adding", () => {
    const pool = [["a1", "a2"], ["b1", "b2"]];
    expect(applyField(pool, ["a1", "a2", "b1", "b2", "a3"])).toEqual([["a1", "a2"], ["b1", "b2"], ["a3"]]);
  });

  it("removing one of a pair leaves the PARTNER in the field, alone", () => {
    // The partner did nothing wrong; dropping them too would be a second,
    // unasked-for removal.
    expect(applyField([["a1", "a2"], ["b1"]], ["a2", "b1"])).toEqual([["a2"], ["b1"]]);
  });

  it("drops an entrant only when it empties — an empty seed is unplayable", () => {
    expect(applyField([["a1"], ["b1"]], ["b1"])).toEqual([["b1"]]);
  });

  it("is idempotent — re-applying the same field changes nothing", () => {
    const pool = [["a1", "a2"], ["b1", "b2"]];
    expect(applyField(pool, fieldMembers(pool))).toEqual(pool);
  });
});

describe("shufflePairs", () => {
  const field = (ids: string[]) => ids.map((id) => [id]);

  it("pairs each team among itself — 8 become 4, 6 become 3, 4 become 2", () => {
    for (const [n, pairs] of [[8, 4], [6, 3], [4, 2]] as const) {
      const ids = Array.from({ length: n }, (_, i) => `a${i + 1}`);
      const teams = [{ id: "A", players: ids.map((id) => ({ id })) }];
      const out = shufflePairs(field(ids), teams, { random: seeded(7) });
      expect(out).toHaveLength(pairs);
      expect(out.every((e) => e.length === 2)).toBe(true);
      // Everyone in, nobody twice.
      expect(out.flat().sort()).toEqual([...ids].sort());
    }
  });

  it("never pairs across cup teams — a pair's points must have one home", () => {
    const out = shufflePairs(field(["a1", "a2", "a3", "a4", "b1", "b2"]), TEAMS, { random: seeded(3) });
    for (const pair of out) {
      expect(new Set(pair.map((id) => id[0])).size).toBe(1);
    }
  });

  it("leaves an odd member out as a SOLO entrant rather than dropping them", () => {
    const teams = [{ id: "A", players: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] }];
    const out = shufflePairs(field(["a1", "a2", "a3"]), teams, { random: seeded(11) });
    expect(out.flat().sort()).toEqual(["a1", "a2", "a3"]);
    expect(out.filter((e) => e.length === 1)).toHaveLength(1);
  });

  it("RE-pairs an already-paired field — it's an action, not a top-up", () => {
    const teams = [{ id: "A", players: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }] }];
    const out = shufflePairs([["a1", "a2"], ["a3", "a4"]], teams, { random: seeded(5) });
    expect(out).toHaveLength(2);
    expect(out.flat().sort()).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("keeps a member with NO team out of everyone else's pairs", () => {
    // "" is its own bucket, so an unassigned player can't be silently married
    // into a team whose points they'd then be scoring.
    const out = shufflePairs(field(["a1", "a2", "x1"]), TEAMS, { random: seeded(2) });
    const withX = out.find((e) => e.includes("x1"))!;
    expect(withX).toEqual(["x1"]);
  });
});

describe("entrantLabel", () => {
  const names = new Map([["a1", "Brad"], ["a2", "Zach"]]);

  it("puts a pair on ONE line", () => {
    expect(entrantLabel(["a1", "a2"], names)).toBe("Brad & Zach");
  });

  it("a single is just the name", () => {
    expect(entrantLabel(["a1"], names)).toBe("Brad");
  });

  it("an unknown id still renders something rather than blanking the row", () => {
    expect(entrantLabel(["a1", "ghost"], names)).toBe("Brad & Player");
  });
});

describe("pairMembers / unpairEntrant — the manual half of pairing", () => {
  it("pairs two solos, keeping the FIRST one's position", () => {
    expect(pairMembers([["a1"], ["a2"], ["a3"]], "a1", "a3")).toEqual([["a1", "a3"], ["a2"]]);
  });

  it("pairing someone already paired FREES their old partner rather than making a trio", () => {
    expect(pairMembers([["a1", "a2"], ["a3"]], "a1", "a3")).toEqual([["a1", "a3"], ["a2"]]);
  });

  it("is a no-op for the same person, or for someone not in the field", () => {
    const pool = [["a1"], ["a2"]];
    expect(pairMembers(pool, "a1", "a1")).toEqual(pool);
    expect(pairMembers(pool, "a1", "ghost")).toEqual(pool);
  });

  it("never loses or duplicates anyone", () => {
    const before = [["a1", "a2"], ["a3"], ["a4"]];
    const after = pairMembers(before, "a2", "a4");
    expect(fieldMembers(after).sort()).toEqual(fieldMembers(before).sort());
  });

  it("unpair splits a pair in place", () => {
    expect(unpairEntrant([["a1", "a2"], ["b1"]], 0)).toEqual([["a1"], ["a2"], ["b1"]]);
  });

  it("unpair leaves a solo (and an out-of-range index) untouched", () => {
    const pool = [["a1"], ["b1", "b2"]];
    expect(unpairEntrant(pool, 0)).toEqual(pool);
    expect(unpairEntrant(pool, 9)).toEqual(pool);
  });
});
