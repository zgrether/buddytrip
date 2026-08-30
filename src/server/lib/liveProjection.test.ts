import { describe, it, expect } from "vitest";
import { projectGame, type GameProjectionData, type LiveProjectionInput } from "./liveProjection";

/**
 * Live projection mapping (leaderboard grid Phase 2, Path A). The pure rollups
 * (rollupMatchPlay / computeRack) have their own tests; this covers what THIS
 * layer adds — building each match's current standing (buildDecided → matchState),
 * resolving each side to its team, and dispatching by format — so the board pill
 * can't drift from the game page's projection.
 */

const gross = (m: Record<string, Record<string, number>>): Map<string, Record<string, number>> =>
  new Map(Object.entries(m));
const userTeam = (m: Record<string, string>): Map<string, string> => new Map(Object.entries(m));
const part = (user_id: string) => ({ user_id, play_group_id: null, handicap_strokes: 0 });

describe("projectGame — match play", () => {
  it("sums each match's current standing to per-team COMPETITION points (leader full, all-square halved)", () => {
    // #1031: pointsTotal 4 ÷ 2 assigned matches, no overrides → even share 2/match.
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play", pointsTotal: 4, isPerMatch: true };
    const data: GameProjectionData = {
      schema: { units: { count: 2 } }, // 2-hole round, no course index → sequential fallback
      modifiers: null,
      matches: [
        { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" } }, // alice sweeps → blue
        { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" } }, // 1 hole halved → all-square
      ],
      parts: [part("alice"), part("bob"), part("carol"), part("dave")],
      playGroups: [],
      gross: gross({
        alice: { "1": 4, "2": 4 },
        bob: { "1": 5, "2": 5 },
        carol: { "1": 4 }, // only hole 1 in → started, all-square
        dave: { "1": 4 },
      }),
      outcomes: [],
      userTeam: userTeam({ alice: "blue", bob: "red", carol: "blue", dave: "red" }),
    };
    // match 1: blue up → blue +2. match 2: all-square started → blue +1, red +1.
    expect(projectGame(input, data)).toEqual({ blue: 3, red: 1 });
  });

  it("A2b — a match's point_value OVERRIDES the even-share pointsPerMatch in the projection", () => {
    // #1031: pointsTotal 6, one match overridden at 4 → the other's even share =
    // (6 − 4) ÷ (2 − 1) = 2, same as the old hardcoded pointsPerMatch.
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play", pointsTotal: 6, isPerMatch: true };
    const data: GameProjectionData = {
      schema: { units: { count: 2 } },
      modifiers: null,
      matches: [
        // alice sweeps → blue; this match "counts double" (override 4), not the even 2.
        { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" }, point_value: 4 },
        // carol sweeps → blue at the even share (no override).
        { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" }, point_value: null },
      ],
      parts: [part("alice"), part("bob"), part("carol"), part("dave")],
      playGroups: [],
      gross: gross({
        alice: { "1": 4, "2": 4 },
        bob: { "1": 5, "2": 5 },
        carol: { "1": 4, "2": 4 },
        dave: { "1": 5, "2": 5 },
      }),
      outcomes: [],
      userTeam: userTeam({ alice: "blue", bob: "red", carol: "blue", dave: "red" }),
    };
    // blue = 4 (overridden match) + 2 (even-share match) = 6.
    expect(projectGame(input, data)).toEqual({ blue: 6 });
  });

  it("B3 — outcome-mode games project from match_hole_outcomes, not gross scores (same result as the score-mode sweep/halve test)", () => {
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play", pointsTotal: 4, isPerMatch: true, outcomeMode: true };
    const data: GameProjectionData = {
      schema: { units: { count: 2 } },
      modifiers: null,
      matches: [
        { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" } }, // alice sweeps → blue
        { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" } }, // 1 hole halved → all-square
      ],
      parts: [part("alice"), part("bob"), part("carol"), part("dave")],
      playGroups: [],
      gross: new Map(), // deliberately empty — outcome mode must not read gross at all
      outcomes: [
        { match_id: "m1", hole_number: 1, result: "side_a" },
        { match_id: "m1", hole_number: 2, result: "side_a" },
        { match_id: "m2", hole_number: 1, result: "halved" },
      ],
      userTeam: userTeam({ alice: "blue", bob: "red", carol: "blue", dave: "red" }),
    };
    expect(projectGame(input, data)).toEqual({ blue: 3, red: 1 });
  });

  it("an unpaired match (a side missing) contributes nothing", () => {
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play", pointsTotal: 4, isPerMatch: true };
    const data: GameProjectionData = {
      schema: { units: { count: 2 } },
      modifiers: null,
      matches: [{ id: "m1", side_a: { type: "user", id: "alice" }, side_b: null }],
      parts: [part("alice")],
      playGroups: [],
      gross: gross({ alice: { "1": 4, "2": 4 } }),
      outcomes: [],
      userTeam: userTeam({ alice: "blue" }),
    };
    expect(projectGame(input, data)).toEqual({});
  });
});

describe("projectGame — rack", () => {
  it("returns per-team COMPETITION points = projected slots × per-slot value (per_match)", () => {
    // #1031: pointsTotal 6 ÷ slotCount 2 (min(2 t1, 2 t2)) → per-slot value 3.
    const input: LiveProjectionInput = { id: "g2", gameTypeId: "gtt_rack_n_stack", pointsTotal: 6, isPerMatch: true };
    const data: GameProjectionData = {
      schema: { units: { metadata: { par: [4, 4], handicap_index: [1, 2] } } },
      modifiers: null,
      matches: [],
      parts: [part("p1"), part("p2"), part("p3"), part("p4")],
      playGroups: [],
      gross: gross({
        p1: { "1": 3, "2": 3 }, // team t1 — lowest
        p3: { "1": 4, "2": 4 }, // team t1
        p4: { "1": 4, "2": 4 }, // team t2
        p2: { "1": 5, "2": 5 }, // team t2 — highest
      }),
      outcomes: [],
      userTeam: userTeam({ p1: "t1", p3: "t1", p2: "t2", p4: "t2" }),
    };
    // rank-paired: (p1<p4) → t1, (p3<p2) → t1 → t1 sweeps both slots = 2 slots.
    // × per_match (3, points-per-slot) → 6 competition points (NOT raw 2).
    expect(projectGame(input, data)).toEqual({ t1: 6, t2: 0 });
  });

  it("a legacy rack with no per_match value (0) falls back to ×1 (raw slots)", () => {
    const input: LiveProjectionInput = { id: "g2", gameTypeId: "gtt_rack_n_stack", pointsTotal: null, isPerMatch: false };
    const data: GameProjectionData = {
      schema: { units: { metadata: { par: [4, 4], handicap_index: [1, 2] } } },
      modifiers: null,
      matches: [],
      parts: [part("p1"), part("p2"), part("p3"), part("p4")],
      playGroups: [],
      gross: gross({
        p1: { "1": 3, "2": 3 },
        p3: { "1": 4, "2": 4 },
        p4: { "1": 4, "2": 4 },
        p2: { "1": 5, "2": 5 },
      }),
      outcomes: [],
      userTeam: userTeam({ p1: "t1", p3: "t1", p2: "t2", p4: "t2" }),
    };
    expect(projectGame(input, data)).toEqual({ t1: 2, t2: 0 });
  });
});

describe("projectGame — Matches", () => {
  it("sums only DECIDED matches — an undecided one contributes nothing, not a partial credit", () => {
    // pointsTotal 12 ÷ 3 assigned matches, no overrides → even share 4/match.
    const input: LiveProjectionInput = {
      id: "g4",
      gameTypeId: "gtt_generic_card",
      competitionFormat: "matches",
      pointsTotal: 12,
      isPerMatch: true,
    };
    const data: GameProjectionData = {
      schema: null,
      modifiers: null,
      matches: [
        { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" }, result: "a_win" },
        { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" }, result: "halve" },
        { id: "m3", side_a: { type: "user", id: "erin" }, side_b: { type: "user", id: "finn" }, result: null }, // undecided
      ],
      parts: [],
      playGroups: [],
      gross: new Map(),
      outcomes: [],
      userTeam: userTeam({ alice: "blue", bob: "red", carol: "blue", dave: "red", erin: "blue", finn: "red" }),
    };
    // m1: blue +4. m2 halved: blue +2, red +2. m3 undecided: nothing (NOT +2 each,
    // which is what a "credit the leader" mistake copied from golf would do).
    expect(projectGame(input, data)).toEqual({ blue: 6, red: 2 });
  });

  it("a per-match point_value override wins over the even share, same as the persisted write", () => {
    const input: LiveProjectionInput = {
      id: "g5",
      gameTypeId: "gtt_generic_card",
      competitionFormat: "matches",
      pointsTotal: 10,
      isPerMatch: true,
    };
    const data: GameProjectionData = {
      schema: null,
      modifiers: null,
      matches: [
        { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" }, result: "a_win", point_value: 6 },
        { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" }, result: "b_win" }, // even share
      ],
      parts: [],
      playGroups: [],
      gross: new Map(),
      outcomes: [],
      userTeam: userTeam({ alice: "blue", bob: "red", carol: "blue", dave: "red" }),
    };
    // even share = (10 - 6) / 1 non-overridden match = 4.
    expect(projectGame(input, data)).toEqual({ blue: 6, red: 4 });
  });

  it("gameTypeId is a generic non-golf shape shared with other formats — competitionFormat is what decides this is Matches", () => {
    // Same gtt_generic_card game type, but NOT a Matches game (no competitionFormat) —
    // must fall through to null, not be mistaken for one just because the shape matches.
    const input: LiveProjectionInput = { id: "g6", gameTypeId: "gtt_generic_card", pointsTotal: 10, isPerMatch: true };
    const data: GameProjectionData = {
      schema: null,
      modifiers: null,
      matches: [{ id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" }, result: "a_win" }],
      parts: [],
      playGroups: [],
      gross: new Map(),
      outcomes: [],
      userTeam: userTeam({ alice: "blue", bob: "red" }),
    };
    expect(projectGame(input, data)).toBeNull();
  });
});

describe("projectGame — no projection", () => {
  it("returns null for a format without a live projection (stroke play)", () => {
    const input: LiveProjectionInput = { id: "g3", gameTypeId: "gtt_stroke_play", pointsTotal: null, isPerMatch: false };
    const data: GameProjectionData = {
      schema: null,
      modifiers: null,
      matches: [],
      parts: [],
      playGroups: [],
      gross: new Map(),
      outcomes: [],
      userTeam: new Map(),
    };
    expect(projectGame(input, data)).toBeNull();
  });
});
