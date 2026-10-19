import { describe, it, expect } from "vitest";
import { asksSideGameAtGoLive, leaveCompetitionKey } from "./sideGamePrompt";

/**
 * #1668 look, item 3 — when going live asks "Nobody here is on a team, so this
 * game can't award points", and when the answer travels with the save.
 *
 * The base case asks; every other case changes exactly ONE input from it and
 * must not ask, so each condition is shown to be load-bearing on its own.
 */

const base = {
  wasLive: false,
  inCup: true,
  teamCount: 2,
  gameTypeId: "gtt_stroke_play",
  playerIds: ["ann", "bob"],
  teamOf: () => undefined as string | undefined,
};

describe("asksSideGameAtGoLive", () => {
  it("asks: a fresh go-live, a cup with teams, a side-capable format, nobody on a team", () => {
    expect(asksSideGameAtGoLive(base)).toBe(true);
  });

  it("not when someone playing is on a team", () => {
    expect(asksSideGameAtGoLive({ ...base, teamOf: (id) => (id === "bob" ? "red" : undefined) })).toBe(false);
  });

  it("not when the game was already live", () => {
    expect(asksSideGameAtGoLive({ ...base, wasLive: true })).toBe(false);
  });

  it("not for a side game", () => {
    expect(asksSideGameAtGoLive({ ...base, inCup: false })).toBe(false);
  });

  it("not in a teamless race, whose units are people", () => {
    expect(asksSideGameAtGoLive({ ...base, teamCount: 0 })).toBe(false);
  });

  it("not for a format that cannot be a side game", () => {
    expect(asksSideGameAtGoLive({ ...base, gameTypeId: "gtt_scramble" })).toBe(false);
  });

  it("not when nobody is playing yet", () => {
    expect(asksSideGameAtGoLive({ ...base, playerIds: [] })).toBe(false);
  });

  it("skins asks too", () => {
    expect(asksSideGameAtGoLive({ ...base, gameTypeId: "gtt_skins" })).toBe(true);
  });
});

describe("leaveCompetitionKey — the choice travels only with its go-live", () => {
  it("sent when chosen and this save turns scoring on", () => {
    expect(leaveCompetitionKey({ chosen: true, draftScoring: true, savedScoring: false })).toEqual({ leaveCompetition: true });
  });

  it("not sent once the toggle went back off", () => {
    expect(leaveCompetitionKey({ chosen: true, draftScoring: false, savedScoring: false })).toEqual({});
  });

  it("not sent again once the game is live", () => {
    expect(leaveCompetitionKey({ chosen: true, draftScoring: true, savedScoring: true })).toEqual({});
  });

  it("not sent when Keep as is was chosen", () => {
    expect(leaveCompetitionKey({ chosen: false, draftScoring: true, savedScoring: false })).toEqual({});
  });
});
