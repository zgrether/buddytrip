import { describe, it, expect } from "vitest";
import { projectGame, type GameProjectionData, type LiveProjectionInput } from "./liveProjection";

/**
 * PR 9c-1, verify-first: a TEAMLESS race's projection is keyed by PERSON.
 *
 * A teamless race is a points competition with no teams (PR 7); its units are
 * people, and the finalize pays a side's person (`matchAwards.ts`, `personOf`).
 * The projection resolved every side through `team_assignments` only — empty
 * in a teamless race — so every match was unpayable, the arm returned `{}`,
 * and the board then filled each person with `?? 0`: a race that is being
 * played, projecting nobody anything.
 *
 * The fixture is this file's sibling's first match-play case, recast as a
 * teamless race: no `userTeam`, no cup teams, a points competition.
 */

const part = (user_id: string) => ({ user_id, play_group_id: null, handicap_strokes: 0 });

const teamlessData = (): GameProjectionData => ({
  schema: { units: { count: 2 } },
  modifiers: null,
  matches: [
    { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" } }, // alice sweeps
    { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" } }, // level after 1
  ],
  parts: [part("alice"), part("bob"), part("carol"), part("dave")],
  playGroups: [],
  gross: new Map(
    Object.entries<Record<string, number>>({
      alice: { "1": 4, "2": 4 },
      bob: { "1": 5, "2": 5 },
      carol: { "1": 4 },
      dave: { "1": 4 },
    })
  ),
  outcomes: [],
  userTeam: new Map(),
  cupTeamIds: [],
  pointsMode: true,
  // What the board hands in for a points competition with no teams.
  teamless: true,
});

describe("teamless race — golf match play projects to PEOPLE", () => {
  it("each side's person is credited, as the finalize pays them", () => {
    const input: LiveProjectionInput = { id: "g1", gameTypeId: "gtt_match_play", pointsTotal: 4, isPerMatch: true };
    // match 1: alice up → alice 2. match 2: level and started → carol 1, dave 1.
    expect(projectGame(input, teamlessData())).toEqual({
      kind: "projected",
      byTeam: { alice: 2, carol: 1, dave: 1 },
    });
  });
});

describe("teamless race — non-golf Matches projects to PEOPLE", () => {
  it("a decided match credits its winner's person", () => {
    const input: LiveProjectionInput = {
      id: "g2",
      gameTypeId: "gtt_generic_card",
      competitionFormat: "matches",
      pointsTotal: 4,
      isPerMatch: true,
    };
    const data = teamlessData();
    data.matches = [
      { id: "m1", side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" }, result: "a_win" },
      { id: "m2", side_a: { type: "user", id: "carol" }, side_b: { type: "user", id: "dave" }, result: "halve" },
    ];
    expect(projectGame(input, data)).toEqual({
      kind: "projected",
      byTeam: { alice: 2, carol: 1, dave: 1 },
    });
  });
});
