import { describe, it, expect } from "vitest";
import { teamsInGame, type SideRef } from "@/lib/matchAwards";

/**
 * PR 5: which teams a match game writes a result row for. A 0 means played and
 * lost; a missing row means wasn't in it (empty is not unknown).
 */

const TEAM: Record<string, string> = { ann: "blue", bob: "blue", cat: "red", dan: "green" };
const PG: Record<string, string> = { pairBlue: "blue" };
const sideTeam = (s: SideRef) => (s.type === "play_group" ? PG[s.id] : TEAM[s.id]);
const user = (id: string): SideRef => ({ type: "user", id });
const CUP = ["blue", "red", "green"];

describe("teamsInGame — a points race credits only the teams that were in the game", () => {
  it("one Blue-v-Red match in a three-team race: Blue and Red, never Green", () => {
    expect(teamsInGame([{ side_a: user("ann"), side_b: user("cat") }], sideTeam, CUP, false)).toEqual(["blue", "red"]);
  });

  it("a team that played and has won nothing yet is still IN — its row is a 0, not an absence", () => {
    // The match has no result; both teams are in the game regardless.
    const inGame = teamsInGame([{ side_a: user("ann"), side_b: user("dan") }], sideTeam, CUP, false);
    expect(inGame).toEqual(["blue", "green"]);
  });

  it("same-team opponents put that one team in the game (ruling 10)", () => {
    expect(teamsInGame([{ side_a: user("ann"), side_b: user("bob") }], sideTeam, CUP, false)).toEqual(["blue"]);
  });

  it("a pair side counts through its group", () => {
    const pair: SideRef = { type: "play_group", id: "pairBlue" };
    expect(teamsInGame([{ side_a: pair, side_b: user("cat") }], sideTeam, CUP, false)).toEqual(["blue", "red"]);
  });

  it("keeps the cup's team order, whatever order the matches name them in", () => {
    const matches = [
      { side_a: user("dan"), side_b: user("cat") },
      { side_a: user("ann"), side_b: null },
    ];
    expect(teamsInGame(matches, sideTeam, CUP, false)).toEqual(["blue", "red", "green"]);
  });

  it("no side resolving to a team gives EMPTY — which the caller must turn into writing nothing", () => {
    expect(teamsInGame([{ side_a: user("zed"), side_b: null }], sideTeam, CUP, false)).toEqual([]);
    expect(teamsInGame([], sideTeam, CUP, false)).toEqual([]);
  });
});

describe("teamsInGame — a Match Play cup is unchanged: both teams, always", () => {
  it("both teams even when no side resolves — the game IS between the cup's two teams", () => {
    // matches.pointsA2b pins the database half of this: a game where nobody
    // resolves still writes both team rows at 0 rather than an empty wipe.
    expect(teamsInGame([{ side_a: user("zed"), side_b: null }], sideTeam, ["blue", "red"], true)).toEqual(["blue", "red"]);
  });
});
