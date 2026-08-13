import { describe, it, expect } from "vitest";
import {
  configToNonGolfDraft,
  nonGolfDraftToPayload,
  nonGolfDraftsEqual,
  type NonGolfConfigDraft,
  type BracketConfig,
} from "./configDraft";

/**
 * The bracket POOL as a draft slice — the last piece of the bracket that was
 * still authored outside the one atomic Save.
 *
 * The pool is `string[][]` in seed order, deliberately the same shape as rack's
 * `groups`, so `RackGroupBuilder` drives both and there is no second person
 * picker. The DRAW is not drafted at all: it is a pure function of the entrant
 * count and the consolation flag, so it is computed at payload time rather than
 * stored where the two could drift.
 */

const BRACKET: BracketConfig = {
  elimination: "single",
  entrants: "partners",
  seeding: "manual",
  consolation: false,
};

const TEAMS = { u1: "tA", u2: "tA", u3: "tB", u4: "tB", u5: "tA", u6: "tB" };

function draft(over: Partial<NonGolfConfigDraft> = {}): NonGolfConfigDraft {
  return {
    ...configToNonGolfDraft({ name: "Cornhole", competition_format: "bracket" }, []),
    bracketConfig: BRACKET,
    pointsTotal: 8,
    ...over,
  };
}
const payload = (d: NonGolfConfigDraft) => nonGolfDraftToPayload(d, undefined, { teamByUser: TEAMS });

describe("the pool rides the atomic Save", () => {
  it("emits entrants in SEED order — index 0 is seed 1", () => {
    const p = payload(draft({ bracketEntrants: [["u1", "u2"], ["u3", "u4"]] }));
    expect(p.bracketEntrants).toEqual([
      { seed: 1, teamId: "tA", userIds: ["u1", "u2"] },
      { seed: 2, teamId: "tB", userIds: ["u3", "u4"] },
    ]);
  });

  it("emits the DRAW alongside, never alone", () => {
    const p = payload(draft({ bracketEntrants: [["u1"], ["u2"], ["u3"]] }));
    // The RPC gates its whole pool+draw block on `bracketEntrants`, so a draw
    // without a pool would be silently ignored — the worst of the outcomes.
    expect(p.bracketEntrants).toHaveLength(3);
    expect(p.bracketDraw!.filter((m) => m.round === 1)).toHaveLength(2);
  });

  it("the draw follows the consolation flag", () => {
    const pool = [["u1"], ["u2"], ["u3"], ["u4"]];
    expect(payload(draft({ bracketEntrants: pool })).bracketDraw!.some((m) => m.bracket === "consolation")).toBe(false);
    expect(
      payload(draft({ bracketEntrants: pool, bracketConfig: { ...BRACKET, consolation: true } }))
        .bracketDraw!.some((m) => m.bracket === "consolation")
    ).toBe(true);
  });

  it("an entrant's team comes from its members — that is what stops a pair spanning two", () => {
    const p = payload(draft({ bracketEntrants: [["u1", "u5"]] }));
    expect(p.bracketEntrants![0].teamId).toBe("tA");
  });
});

describe("the keys are OMITTED unless the pool is real", () => {
  // Presence is what triggers the RPC's rebuild, so a save that isn't about the
  // pool must not carry it — otherwise a rename rebuilds the draw. Every case
  // here has NO baseline, which is what "there is nothing to compare, so don't
  // touch it" looks like; the clear cases below are the same shapes WITH one.
  it("a non-bracket game sends neither key", () => {
    const p = payload(draft({ competitionFormat: "head_to_head", bracketEntrants: [["u1"], ["u2"]] }));
    expect(p).not.toHaveProperty("bracketEntrants");
    expect(p).not.toHaveProperty("bracketDraw");
  });

  it("a bracket with an EMPTY pool sends neither key", () => {
    const p = payload(draft({ bracketEntrants: [] }));
    expect(p).not.toHaveProperty("bracketEntrants");
    expect(p).not.toHaveProperty("bracketDraw");
  });

  it("empty entrant slots are dropped, not sent as empty seeds", () => {
    // The builder leaves an empty group behind when a partner is removed; an
    // empty seed would be an entrant nobody can play.
    const p = payload(draft({ bracketEntrants: [["u1"], [], ["u2"]] }));
    expect(p.bracketEntrants).toEqual([
      { seed: 1, teamId: "tA", userIds: ["u1"] },
      { seed: 2, teamId: "tA", userIds: ["u2"] },
    ]);
  });
});

/**
 * Emptying the pool is a CHANGE, and the RPC only acts on what it is told about.
 * `ClearPairingsPrompt` promises "the entrants you've built will be removed", so
 * the save has to actually say so — an omitted key preserves, which would leave
 * the prompt lying and the pool on disk.
 */
describe("clearing the pool is SENT, not omitted", () => {
  const withPool = (over: Partial<NonGolfConfigDraft> = {}) =>
    draft({ bracketEntrants: [["u1", "u2"], ["u3", "u4"]], ...over });
  const clear = (d: NonGolfConfigDraft, base: NonGolfConfigDraft) =>
    nonGolfDraftToPayload(d, base, { teamByUser: TEAMS });

  it("switching the format AWAY from bracket clears the persisted field", () => {
    const p = clear(withPool({ competitionFormat: "head_to_head", bracketEntrants: [] }), withPool());
    expect(p.bracketEntrants).toEqual([]);
    expect(p.bracketDraw).toEqual([]);
  });

  it("emptying the pool while STILL a bracket clears it too (partners → singles)", () => {
    const p = clear(withPool({ bracketEntrants: [] }), withPool());
    expect(p.bracketEntrants).toEqual([]);
    expect(p.bracketDraw).toEqual([]);
  });

  it("a format switch with the pool still in the draft does NOT clear — it just stops sending", () => {
    // The view empties the entrants slice as part of the switch; if something
    // ever stops doing that, this must not silently delete the field anyway.
    const p = clear(withPool({ competitionFormat: "best_of_n" }), withPool());
    expect(p.bracketEntrants).toEqual([]);
    expect(p.bracketDraw).toEqual([]);
  });

  it("a baseline that never had a pool sends nothing — there is nothing to clear", () => {
    const empty = draft({ bracketEntrants: [] });
    const p = clear(draft({ competitionFormat: "head_to_head", bracketEntrants: [] }), empty);
    expect(p).not.toHaveProperty("bracketEntrants");
    expect(p).not.toHaveProperty("bracketDraw");
  });

  it("a rename on a bracket re-sends the SAME pool — never an accidental clear", () => {
    // The RPC's own dirty-compare then finds no difference and writes nothing.
    const p = clear(withPool({ name: "Renamed" }), withPool());
    expect(p.bracketEntrants).toHaveLength(2);
    expect(p.bracketDraw!.length).toBeGreaterThan(0);
  });
});

describe("dirtiness", () => {
  it("a reordered pool IS a change — seed order is the draw position", () => {
    const a = draft({ bracketEntrants: [["u1"], ["u2"]] });
    const b = draft({ bracketEntrants: [["u2"], ["u1"]] });
    expect(nonGolfDraftsEqual(a, b)).toBe(false);
  });

  it("an identical pool is not a change", () => {
    expect(nonGolfDraftsEqual(draft({ bracketEntrants: [["u1", "u2"]] }), draft({ bracketEntrants: [["u1", "u2"]] }))).toBe(true);
  });

  it("a non-bracket page is unaffected by the new slice", () => {
    const a = configToNonGolfDraft({ name: "Cards" }, []);
    expect(a.bracketEntrants).toEqual([]);
    expect(nonGolfDraftsEqual(a, configToNonGolfDraft({ name: "Cards" }, []))).toBe(true);
  });
});

describe("round-trip", () => {
  it("persisted entrants seed the draft, so an untouched page is not dirty", () => {
    const pool = [["u1", "u2"], ["u3", "u4"]];
    const seeded = configToNonGolfDraft({ name: "C", competition_format: "bracket" }, [], pool);
    expect(nonGolfDraftsEqual(seeded, configToNonGolfDraft({ name: "C", competition_format: "bracket" }, [], pool))).toBe(true);
  });

  it("the draft holds a COPY — mutating the source pool can't reach it", () => {
    const pool = [["u1"]];
    const seeded = configToNonGolfDraft({ name: "C", competition_format: "bracket" }, [], pool);
    pool[0].push("u2");
    expect(seeded.bracketEntrants).toEqual([["u1"]]);
  });
});
