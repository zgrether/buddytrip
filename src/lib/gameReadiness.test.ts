import { describe, it, expect } from "vitest";
import {
  gameSetupReasons,
  goLiveGate,
  isSetUp,
  pairedMemberIds,
  pairedPlayersOffTeam,
  setupReasonLine,
  type SetupInput,
  type SetupReasonCode,
} from "./gameReadiness";
import { teamPlaceCapacity } from "./placeCapacity";
import { SETUP_REASON_WORD } from "./vocabulary";

/**
 * The shared readiness rule (Needs attention, 2026-10-21). Each case asserts the
 * exact code list, not "has a reason", so a build that fires the wrong reason, or
 * an extra one, fails. The database half of the rule is held by
 * `gameReadinessParity.test.ts`.
 *
 * Ported from `isConfigured`'s Matches cases (Phase 0 §2), whose adversarial
 * point still stands: a Matches game must not fall through to the points arm,
 * because a fresh non-golf game always has a points sentinel.
 */

const base: SetupInput = {
  gameTypeId: "gtt_generic_yard",
  competitionFormat: null,
  inCompetition: true,
  cupHasTeams: true,
  pointsTotal: 8,
  pointsDistribution: null,
  matchesTotal: 0,
  matchesPaired: 0,
  pairedPlayersOffTeam: 0,
  groupedPlayers: 0,
  bracketEntrants: 0,
  placeCapacity: teamPlaceCapacity(2),
  slateGames: 0,
};
const codes = (over: Partial<SetupInput>): SetupReasonCode[] => gameSetupReasons({ ...base, ...over }).map((r) => r.code);

describe("match play and the Matches format", () => {
  const matches = { competitionFormat: "matches" };

  it("no matches at all: matches_none, even with points set", () => {
    expect(codes({ ...matches, matchesTotal: 0 })).toEqual(["matches_none"]);
  });
  it("some unpaired: matches_unpaired, carrying how many", () => {
    expect(gameSetupReasons({ ...base, ...matches, matchesTotal: 4, matchesPaired: 3 })).toEqual([
      { code: "matches_unpaired", unpaired: 1 },
    ]);
  });
  it("every match paired: nothing", () => {
    expect(codes({ ...matches, matchesTotal: 4, matchesPaired: 4 })).toEqual([]);
  });
  it("a paired player on no team, in a cup with teams: player_not_on_team", () => {
    expect(codes({ ...matches, matchesTotal: 2, matchesPaired: 2, pairedPlayersOffTeam: 1 })).toEqual(["player_not_on_team"]);
  });
  it("the same player in a teamless tournament: nothing (Zach's ruling 1)", () => {
    expect(codes({ ...matches, matchesTotal: 2, matchesPaired: 2, pairedPlayersOffTeam: 1, cupHasTeams: false })).toEqual([]);
  });
  it("golf match play takes the same rule by game type", () => {
    expect(codes({ gameTypeId: "gtt_match_play", matchesTotal: 3, matchesPaired: 2 })).toEqual(["matches_unpaired"]);
  });
  it("a cup game with every match paired but no points: points_missing (the database refuses it)", () => {
    expect(codes({ ...matches, matchesTotal: 2, matchesPaired: 2, pointsTotal: 0 })).toEqual(["points_missing"]);
  });
  it("a SIDE game with every match paired needs no points", () => {
    expect(codes({ ...matches, matchesTotal: 2, matchesPaired: 2, pointsTotal: null, inCompetition: false })).toEqual([]);
  });
  it("the Matches descriptor on an engine type does not take this arm", () => {
    expect(codes({ gameTypeId: "gtt_stroke_play", competitionFormat: "matches", groupedPlayers: 3 })).toEqual([]);
  });
  it("the same game type with no descriptor is a general game: points decide", () => {
    expect(codes({})).toEqual([]);
    expect(codes({ pointsTotal: 0 })).toEqual(["points_missing"]);
  });
});

describe("grouped formats, brackets, points, splits, slates", () => {
  it("stroke play with nobody grouped: groups_none", () => {
    expect(codes({ gameTypeId: "gtt_stroke_play", groupedPlayers: 0 })).toEqual(["groups_none"]);
  });
  it("a bracket with one entrant: bracket_field", () => {
    expect(codes({ competitionFormat: "bracket", bracketEntrants: 1 })).toEqual(["bracket_field"]);
    expect(codes({ competitionFormat: "bracket", bracketEntrants: 2 })).toEqual([]);
  });
  it("structure first, then points", () => {
    expect(codes({ gameTypeId: "gtt_stroke_play", pointsTotal: 0 })).toEqual(["groups_none", "points_missing"]);
  });
  it("a side game in the general arm needs points set at all", () => {
    expect(codes({ inCompetition: false, pointsTotal: null })).toEqual(["points_missing"]);
    expect(codes({ inCompetition: false, pointsTotal: 0 })).toEqual([]);
  });
  it("three places over two teams: too_many_places, with the settings sentence", () => {
    const r = gameSetupReasons({ ...base, pointsDistribution: { type: "placement", values: [5, 2, 1] } });
    expect(r).toEqual([{ code: "too_many_places", line: "3 places, but only 2 teams can finish." }]);
  });
  it("pick'em: only its slate", () => {
    expect(codes({ gameTypeId: "gtt_pickem", slateGames: 0, pointsTotal: 0 })).toEqual(["slate_empty"]);
    expect(codes({ gameTypeId: "gtt_pickem", slateGames: 3, pointsTotal: 0 })).toEqual([]);
  });
});

describe("what a reason blocks", () => {
  it("the Game State gate names the first go-live reason, and can skip the points term", () => {
    const reasons = gameSetupReasons({ ...base, gameTypeId: "gtt_stroke_play", groupedPlayers: 2, pointsTotal: 0 });
    expect(goLiveGate(reasons)).toEqual({ ready: false, blockedReason: SETUP_REASON_WORD.points_missing.blocked });
    expect(goLiveGate(reasons, { skip: ["points_missing"] })).toEqual({ ready: true, blockedReason: null });
  });
  it("a split that blocks Save does not make the game unconfigured", () => {
    const reasons = gameSetupReasons({ ...base, pointsDistribution: { type: "placement", values: [5, 2, 1] } });
    expect(isSetUp(reasons)).toBe(true);
    expect(goLiveGate(reasons).ready).toBe(true);
  });
  it("an empty slate does", () => {
    expect(isSetUp(gameSetupReasons({ ...base, gameTypeId: "gtt_pickem", slateGames: 0 }))).toBe(false);
  });
  it("the board's line counts unpaired matches", () => {
    expect(setupReasonLine({ code: "matches_unpaired", unpaired: 2 })).toBe("2 matches not paired");
    expect(setupReasonLine({ code: "matches_unpaired", unpaired: 1 })).toBe("1 match not paired");
  });
});

describe("who is in a paired match", () => {
  it("a play group side counts its members; an unpaired match counts nobody", () => {
    const rows = [
      { side_a: { type: "user", id: "u1" }, side_b: { type: "play_group", id: "g1" } },
      { side_a: { type: "user", id: "u9" }, side_b: { type: "user", id: null } },
    ];
    const parts = [
      { user_id: "u2", play_group_id: "g1" },
      { user_id: "u3", play_group_id: "g1" },
    ];
    expect(pairedMemberIds(rows, parts).sort()).toEqual(["u1", "u2", "u3"]);
  });
  it("a draft counts only filled matches' players on no team", () => {
    const teamed = new Set(["a", "b"]);
    expect(pairedPlayersOffTeam([{ a: ["a"], b: ["x"], playersPerSide: 1 }], teamed)).toBe(1);
    expect(pairedPlayersOffTeam([{ a: ["x"], b: [], playersPerSide: 1 }], teamed)).toBe(0);
  });
});
