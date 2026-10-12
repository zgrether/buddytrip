import { describe, it, expect } from "vitest";
import { computeOwnStanding } from "./ownStanding";
import { projectGame, type GameProjectionData, type LiveProjectionInput } from "./liveProjection";

/**
 * Your own standing on your live card (#1599), per format, from hand-built game
 * data: the same shape the board's projection pass hands in. Each case pins the
 * exact value, and the cases that matter most are the ones a plausible wrong
 * build passes elsewhere: the viewer on side B (a build that reads side A's lead
 * is right for half the field), a delegate who isn't playing, and a game that
 * can't project but still has a standing.
 */

const VIEWER = "me";
const part = (user_id: string, play_group_id: string | null = null, handicap_strokes = 0) => ({ user_id, play_group_id, handicap_strokes });
const gross = (m: Record<string, Record<string, number>>) => new Map(Object.entries(m));

const base = (over: Partial<GameProjectionData> = {}): GameProjectionData => ({
  schema: { units: { count: 3 } },
  modifiers: null,
  matches: [],
  parts: [],
  playGroups: [],
  gross: new Map(),
  outcomes: [],
  userTeam: new Map(),
  ...over,
});

const MATCH: LiveProjectionInput = { id: "g", gameTypeId: "gtt_match_play", pointsTotal: 2, isPerMatch: true };

describe("golf match play", () => {
  // The opponent wins holes 1 and 2.
  const twoDown = (viewerSide: "a" | "b") =>
    base({
      schema: { units: { count: 18 } },
      matches: [
        viewerSide === "a"
          ? { id: "m1", side_a: { type: "user", id: VIEWER }, side_b: { type: "user", id: "opp" } }
          : { id: "m1", side_a: { type: "user", id: "opp" }, side_b: { type: "user", id: VIEWER } },
      ],
      parts: [part(VIEWER), part("opp")],
      gross: gross({ [VIEWER]: { "1": 5, "2": 5 }, opp: { "1": 4, "2": 4 } }),
    });

  it("reads the lead from the VIEWER's side — 2 down on side B is -2, not +2", () => {
    expect(computeOwnStanding(MATCH, twoDown("b"), VIEWER)).toEqual({ kind: "match", lead: -2, thru: 2, over: false, margin: null });
  });

  it("and on side A too (the case a side-A-only build also passes)", () => {
    expect(computeOwnStanding(MATCH, twoDown("a"), VIEWER)).toEqual({ kind: "match", lead: -2, thru: 2, over: false, margin: null });
  });

  it("closed out: over, with matchState's own margin (2 down with 1 to play on a 3-hole round)", () => {
    const short = { ...twoDown("b"), schema: { units: { count: 3 } } };
    expect(computeOwnStanding(MATCH, short, VIEWER)).toEqual({ kind: "match", lead: -2, thru: 2, over: true, margin: "2&1" });
  });

  it("a 2v2 side is the viewer's through their play group", () => {
    const data = base({
      matches: [{ id: "m1", side_a: { type: "play_group", id: "pgA" }, side_b: { type: "play_group", id: "pgB" } }],
      parts: [part(VIEWER, "pgB"), part("partner", "pgB"), part("x", "pgA"), part("y", "pgA")],
      playGroups: [{ id: "pgA", handicap_strokes: 0 }, { id: "pgB", handicap_strokes: 0 }],
      gross: gross({ pgA: { "1": 5 }, pgB: { "1": 4 } }),
    });
    expect(computeOwnStanding(MATCH, data, VIEWER)).toEqual({ kind: "match", lead: 1, thru: 1, over: false, margin: null });
  });

  it("an outcome-mode match reads its recorded holes", () => {
    const data = base({
      matches: [{ id: "m1", side_a: { type: "user", id: "opp" }, side_b: { type: "user", id: VIEWER } }],
      parts: [part(VIEWER), part("opp")],
      outcomes: [{ match_id: "m1", hole_number: 1, result: "side_b" }],
    });
    expect(computeOwnStanding({ ...MATCH, outcomeMode: true }, data, VIEWER)).toEqual({ kind: "match", lead: 1, thru: 1, over: false, margin: null });
  });

  it("paired but nothing played yet is Not started", () => {
    const data = base({
      matches: [{ id: "m1", side_a: { type: "user", id: VIEWER }, side_b: { type: "user", id: "opp" } }],
      parts: [part(VIEWER), part("opp")],
    });
    expect(computeOwnStanding(MATCH, data, VIEWER)).toEqual({ kind: "not_started" });
  });

  it("a game that pays nothing can't PROJECT, but its player still has a standing", () => {
    const unpaid: LiveProjectionInput = { ...MATCH, pointsTotal: null, isPerMatch: false };
    expect(projectGame(unpaid, twoDown("a"))).toEqual({ kind: "cannot", reason: "no_points" });
    expect(computeOwnStanding(unpaid, twoDown("a"), VIEWER)).toMatchObject({ kind: "match", lead: -2 });
  });

  it("running the game without playing in it: no standing", () => {
    expect(computeOwnStanding(MATCH, twoDown("a"), "delegate")).toBeNull();
  });

  it("in the game but on no paired match: no standing", () => {
    const data = twoDown("a");
    data.parts.push(part("bench"));
    expect(computeOwnStanding(MATCH, data, "bench")).toBeNull();
  });
});

describe("non-golf Matches", () => {
  const MATCHES: LiveProjectionInput = { id: "g", gameTypeId: "gtt_generic_yard", competitionFormat: "matches", pointsTotal: 2, isPerMatch: true };
  const withResult = (result: "a_win" | "b_win" | "halve" | null) =>
    base({
      matches: [{ id: "m1", side_a: { type: "user", id: "opp" }, side_b: { type: "user", id: VIEWER }, result }],
      parts: [part(VIEWER), part("opp")],
    });

  it("won, lost, tied, or not decided — from the viewer's side", () => {
    expect(computeOwnStanding(MATCHES, withResult("b_win"), VIEWER)).toEqual({ kind: "result", result: "won" });
    expect(computeOwnStanding(MATCHES, withResult("a_win"), VIEWER)).toEqual({ kind: "result", result: "lost" });
    expect(computeOwnStanding(MATCHES, withResult("halve"), VIEWER)).toEqual({ kind: "result", result: "tied" });
    expect(computeOwnStanding(MATCHES, withResult(null), VIEWER)).toEqual({ kind: "result", result: "pending" });
  });
});

describe("rack, skins, stroke play, scramble", () => {
  const course = { units: { count: 3, labels: ["1", "2", "3"], metadata: { par: [4, 4, 4], handicap_index: [1, 2, 3] } } };

  it("rack: your net to par", () => {
    const data = base({ schema: course, parts: [part(VIEWER)], gross: gross({ [VIEWER]: { "1": 5, "2": 4 } }) });
    expect(computeOwnStanding({ id: "g", gameTypeId: "gtt_rack_n_stack", pointsTotal: 2, isPerMatch: true }, data, VIEWER)).toEqual({
      kind: "to_par",
      toPar: 1,
      thru: "2",
    });
  });

  it("skins: your skins, thru the GROUP's recorded holes (a carried pot counts double)", () => {
    const data = base({
      schema: course,
      parts: [part(VIEWER, "g1"), part("opp", "g1")],
      skins: {
        g1: [
          { hole: 1, result: "tied", winnerId: null },
          { hole: 2, result: "won", winnerId: VIEWER },
          { hole: 3, result: "won", winnerId: "opp" },
        ],
      },
    });
    expect(computeOwnStanding({ id: "g", gameTypeId: "gtt_skins", pointsTotal: null, isPerMatch: false }, data, VIEWER)).toEqual({
      kind: "skins",
      skins: 2,
      thru: "F",
    });
  });

  it("skins: in the game but in no grouping is outside the field", () => {
    const data = base({ parts: [part(VIEWER, null)] });
    expect(computeOwnStanding({ id: "g", gameTypeId: "gtt_skins", pointsTotal: null, isPerMatch: false }, data, VIEWER)).toBeNull();
  });

  const STROKE: LiveProjectionInput = { id: "g", gameTypeId: "gtt_stroke_play", pointsTotal: null, isPerMatch: false };
  const strokeData = base({ schema: course, parts: [part(VIEWER)], gross: gross({ [VIEWER]: { "1": 5, "2": 3 } }) });

  it("stroke play: to par — and it can't project (round_incomplete) while you still have one", () => {
    expect(projectGame(STROKE, strokeData)).toEqual({ kind: "cannot", reason: "round_incomplete" });
    expect(computeOwnStanding(STROKE, strokeData, VIEWER)).toEqual({ kind: "to_par", toPar: 0, thru: "2" });
  });

  it("stroke play under Stableford: POINTS, not to par", () => {
    // Rubric: birdie 3, par 2, bogey 1. A bogey then a birdie is 1 + 3 = 4.
    const config = { scoringType: "stableford", stableford: { ceiling: -1, floor: 1, points: [3, 2, 1] } };
    expect(computeOwnStanding(STROKE, { ...strokeData, config }, VIEWER)).toEqual({ kind: "points", points: 4, thru: "2" });
  });

  it("stroke play: your handicap strokes net the score, as the finalize nets it", () => {
    // One stroke falls on hole 1 (index 1): the 5 nets to a 4.
    const data = base({ schema: course, parts: [part(VIEWER, null, 1)], gross: gross({ [VIEWER]: { "1": 5 } }) });
    expect(computeOwnStanding(STROKE, data, VIEWER)).toEqual({ kind: "to_par", toPar: 0, thru: "1" });
  });

  it("scramble: your GROUP's score", () => {
    const data = base({
      schema: course,
      parts: [part(VIEWER, "team1"), part("mate", "team1")],
      playGroups: [{ id: "team1", handicap_strokes: 0 }],
      gross: gross({ team1: { "1": 3 } }),
    });
    expect(computeOwnStanding({ id: "g", gameTypeId: "gtt_scramble", pointsTotal: null, isPerMatch: false }, data, VIEWER)).toEqual({
      kind: "to_par",
      toPar: -1,
      thru: "1",
    });
  });
});

describe("pick'em", () => {
  const PICKEM: LiveProjectionInput = { id: "g", gameTypeId: "gtt_pickem", pointsTotal: null, isPerMatch: false };
  const pickem = (picks: { user_id: string; slate_game_id: string; pick: string; confidence: number | null }[]) => ({
    clock: { picksOpenedAt: "2026-10-01T00:00:00Z", picksDeadline: null, picksLockedAt: "2026-10-02T00:00:00Z" },
    cfg: { roll_up: null, use_confidence: true },
    slate: [
      { id: "s1", multiplier: 1, result: "home" },
      { id: "s2", multiplier: 1, result: null },
    ],
    picks,
  });

  it("your sheet's points and how many results are in — your sheet only", () => {
    const data = base({
      parts: [part(VIEWER), part("rival")],
      pickem: pickem([
        { user_id: VIEWER, slate_game_id: "s1", pick: "home", confidence: 3 },
        { user_id: "rival", slate_game_id: "s1", pick: "home", confidence: 9 },
      ]),
    });
    expect(computeOwnStanding(PICKEM, data, VIEWER)).toEqual({ kind: "pickem", points: 3, resolved: 1, total: 2 });
  });

  it("entered with no sheet is NOTHING (null), not 0", () => {
    const data = base({ parts: [part(VIEWER)], pickem: pickem([]) });
    expect(computeOwnStanding(PICKEM, data, VIEWER)).toEqual({ kind: "pickem", points: null, resolved: 1, total: 2 });
  });

  it("not entered and no sheet: not playing", () => {
    const data = base({ parts: [part("rival")], pickem: pickem([]) });
    expect(computeOwnStanding(PICKEM, data, VIEWER)).toBeNull();
  });
});
