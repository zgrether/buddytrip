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
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play_singles", pointsPerMatch: 2 };
    const data: GameProjectionData = {
      schema: { units: { count: 2 } }, // 2-hole round, no course index → sequential fallback
      modifiers: null,
      matches: [
        { side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" } }, // alice sweeps → blue
        { side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" } }, // 1 hole halved → all-square
      ],
      parts: [part("alice"), part("bob"), part("carol"), part("dave")],
      playGroups: [],
      gross: gross({
        alice: { "1": 4, "2": 4 },
        bob: { "1": 5, "2": 5 },
        carol: { "1": 4 }, // only hole 1 in → started, all-square
        dave: { "1": 4 },
      }),
      userTeam: userTeam({ alice: "blue", bob: "red", carol: "blue", dave: "red" }),
    };
    // match 1: blue up → blue +2. match 2: all-square started → blue +1, red +1.
    expect(projectGame(input, data)).toEqual({ blue: 3, red: 1 });
  });

  it("an unpaired match (a side missing) contributes nothing", () => {
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play_singles", pointsPerMatch: 2 };
    const data: GameProjectionData = {
      schema: { units: { count: 2 } },
      modifiers: null,
      matches: [{ side_a: { type: "user", id: "alice" }, side_b: null }],
      parts: [part("alice")],
      playGroups: [],
      gross: gross({ alice: { "1": 4, "2": 4 } }),
      userTeam: userTeam({ alice: "blue" }),
    };
    expect(projectGame(input, data)).toEqual({});
  });
});

describe("projectGame — rack", () => {
  it("returns per-team COMPETITION points = projected slots × per-slot value (per_match)", () => {
    const input: LiveProjectionInput = { id: "g2", gameTypeId: "gtt_rack_n_stack", pointsPerMatch: 3 };
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
      userTeam: userTeam({ p1: "t1", p3: "t1", p2: "t2", p4: "t2" }),
    };
    // rank-paired: (p1<p4) → t1, (p3<p2) → t1 → t1 sweeps both slots = 2 slots.
    // × per_match (3, points-per-slot) → 6 competition points (NOT raw 2).
    expect(projectGame(input, data)).toEqual({ t1: 6, t2: 0 });
  });

  it("a legacy rack with no per_match value (0) falls back to ×1 (raw slots)", () => {
    const input: LiveProjectionInput = { id: "g2", gameTypeId: "gtt_rack_n_stack", pointsPerMatch: 0 };
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
      userTeam: userTeam({ p1: "t1", p3: "t1", p2: "t2", p4: "t2" }),
    };
    expect(projectGame(input, data)).toEqual({ t1: 2, t2: 0 });
  });
});

describe("projectGame — no projection", () => {
  it("returns null for a format without a live projection (stroke play)", () => {
    const input: LiveProjectionInput = { id: "g3", gameTypeId: "gtt_stroke_play", pointsPerMatch: 0 };
    const data: GameProjectionData = {
      schema: null,
      modifiers: null,
      matches: [],
      parts: [],
      playGroups: [],
      gross: new Map(),
      userTeam: new Map(),
    };
    expect(projectGame(input, data)).toBeNull();
  });
});
