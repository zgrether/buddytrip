import { describe, it, expect } from "vitest";
import { needsAttention, needsAttentionCount, unevenTeamsWhy, type NeedsAttentionInput } from "./needsAttention";
import { notOnATeamLine, unevenTeamsLine, wontCountLine } from "./vocabulary";

/**
 * The Needs attention card's derivation (Zach's rulings, 2026-10-21). Each case
 * asserts the whole result, so an item appearing where it should not fails as
 * surely as one missing.
 */

const A = { id: "a", name: "Alpha", color: "#3b82f6" };
const B = { id: "b", name: "Bravo", color: "#ef4444" };
const names: Record<string, string> = { mo: "Mo", oz: "Oz", al: "Al", zz: "Zed" };
const base = (over: Partial<NeedsAttentionInput> = {}): NeedsAttentionInput => ({
  teams: [A, B],
  teamSizes: new Map([["a", 2], ["b", 2]]),
  teamed: new Set(["p1", "p2", "p3", "p4"]),
  games: [],
  nameOf: (id) => names[id] ?? id,
  ...over,
});
const game = (name: string, playerIds: string[], over: Partial<NeedsAttentionInput["games"][number]> = {}) => ({
  name, status: "pending", gameTypeId: "gtt_match_play", config: {}, playerIds, ...over,
});

describe("not on a team: people PLAYING on no team (ruling 4)", () => {
  it("lists the people in an unfinished game who are on no team, and the games", () => {
    const n = needsAttention(base({ games: [game("Day 2 Stroke", ["p1", "mo", "oz"])] }));
    expect(n.offTeam).toEqual({ names: ["Mo", "Oz"], games: ["Day 2 Stroke"] });
  });
  it("not someone on the trip who plays nothing, and not a finished game", () => {
    const n = needsAttention(base({ games: [game("Done", ["mo"], { status: "complete" }), game("Day 1", ["p1"])] }));
    expect(n.offTeam).toBeNull();
  });
  it("a teamless tournament has nothing to list at all", () => {
    expect(needsAttention(base({ teams: [], games: [game("G", ["mo"])] }))).toEqual({ offTeam: null, emptyTeams: [], uneven: null });
  });
});

describe("empty and uneven teams", () => {
  it("a team with nobody on it", () => {
    expect(needsAttention(base({ teamSizes: new Map([["a", 3]]) })).emptyTeams).toEqual([B]);
  });
  it("uneven only when an unfinished game sums its players (ruling 2)", () => {
    const sizes = new Map([["a", 6], ["b", 5]]);
    expect(needsAttention(base({ teamSizes: sizes, games: [game("Match", ["p1"])] })).uneven).toBeNull();
    expect(needsAttention(base({ teamSizes: sizes, games: [game("Stroke", ["p1"], { gameTypeId: "gtt_stroke_play" })] })).uneven).toEqual({
      teams: [{ ...A, size: 6 }, { ...B, size: 5 }],
      scorings: ["traditional"],
    });
  });
  it("not beside an empty team, which says it more strongly", () => {
    const n = needsAttention(base({ teamSizes: new Map([["a", 4]]), games: [game("Stroke", [], { gameTypeId: "gtt_stroke_play" })] }));
    expect(n.uneven).toBeNull();
    expect(needsAttentionCount(n)).toBe(1);
  });
});

describe("the words", () => {
  it("names, three at most", () => {
    expect(notOnATeamLine(["Mo"])).toBe("Mo isn't on a team");
    expect(notOnATeamLine(["Mo", "Oz"])).toBe("Mo and Oz aren't on a team");
    expect(notOnATeamLine(["Mo", "Oz", "Al"])).toBe("Mo, Oz and Al aren't on a team");
    expect(notOnATeamLine(["Mo", "Oz", "Al", "Zed"])).toBe("Mo, Oz and 2 others aren't on a team");
  });
  it("the games they are in", () => {
    expect(wontCountLine(["Day 2 Stroke"])).toBe("Playing Day 2 Stroke — won't count");
    expect(wontCountLine(["Day 2 Stroke", "Skins", "Scramble"])).toBe("Playing Day 2 Stroke and 2 more — won't count");
  });
  it("sizes in team order", () => {
    expect(unevenTeamsLine([6, 5])).toBe("Teams are uneven: 6 v 5");
  });
  it("why it matters points the way the format ranks", () => {
    expect(unevenTeamsWhy(["traditional"])).toBe("Stroke play totals add up, so the bigger team is at a disadvantage");
    expect(unevenTeamsWhy(["skins"])).toBe("Skins totals add up, so the bigger team is at an advantage");
    expect(unevenTeamsWhy(["traditional", "skins"])).toBe("Team totals add up, so team size changes the result");
  });
});
