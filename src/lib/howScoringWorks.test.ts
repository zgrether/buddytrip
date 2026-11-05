import { describe, it, expect } from "vitest";
import { awardedSoFar, howScoringWorks, type HowScoringGameInput, type HowScoringInput } from "./howScoringWorks";
import { FORMAT_LINE } from "./formatLines";
import { AWARD_WORD, COMPETING_WORD, NONGOLF_FORMAT_WORD, SPLIT_WORD } from "./vocabulary";

/**
 * The How scoring works card's lines (Zach's rulings, 2026-10-22). Each case
 * asserts whole lines, built from the shared words they must come from, so a
 * line worded anywhere else fails here.
 */

const game = (over: Partial<HowScoringGameInput>): HowScoringGameInput => ({
  id: "g", name: "Game", gameTypeId: "gtt_stroke_play", competitionFormat: null, pointsTotal: 10, distribution: null, ...over,
});
const cup = (games: HowScoringGameInput[], over: Partial<HowScoringInput> = {}) =>
  howScoringWorks({ scoringModel: "match_play", pointsAvailable: 24, awarded: null, teams: [{ name: "Alpha" }, { name: "Bravo" }], teamless: false, games, ...over });

describe("who is competing", () => {
  it("teams, by name", () => {
    expect(cup([]).competing).toEqual({ label: COMPETING_WORD.teamCount(2), names: "Alpha and Bravo" });
  });
  it("a tournament of individuals", () => {
    expect(cup([], { scoringModel: "points", teams: [], teamless: true }).competing).toEqual({ label: COMPETING_WORD.individuals, names: null });
  });
});

describe("the points line (Zach's look on #1694)", () => {
  it("before any game has finished: the points in play alone", () => {
    expect(cup([]).points).toBe("24 points in play");
  });
  it("once a game has finished: and what has been awarded", () => {
    expect(cup([], { awarded: 8 }).points).toBe("24 points in play · 8 awarded");
  });
  it("nothing awarded yet still says 0 once a game has finished, and one point is singular", () => {
    expect(cup([], { pointsAvailable: 1, awarded: 0 }).points).toBe("1 point in play · 0 awarded");
  });
  it("awarded is null until a game has finished, then the banked totals summed", () => {
    expect(awardedSoFar([{ status: "active" }, { status: "pending" }], { a: 0, b: 0 })).toBeNull();
    expect(awardedSoFar([{ status: "active" }, { status: "complete" }], { a: 3, b: 1.5 })).toBe(4.5);
    expect(awardedSoFar([{ status: "complete" }], { a: 0, b: 0 })).toBe(0);
  });
  it("a half is a decimal here: the card is not one of the ½ places", () => {
    expect(cup([], { pointsAvailable: 17, awarded: 8.5 }).points).toBe("17 points in play · 8.5 awarded");
  });
});

describe("what each game is worth", () => {
  const worth = (g: Partial<HowScoringGameInput>) => cup([game(g)]).games[0].worth;
  it("a split by place lists its values", () => {
    expect(worth({ distribution: [5, 3, 2] })).toBe("10 pts · 5 · 3 · 2 pts");
  });
  it("one place, or none set, is winner takes all", () => {
    expect(worth({ distribution: [10] })).toBe(`10 pts · ${SPLIT_WORD.winnerTakesAll}`);
    expect(worth({ distribution: null })).toBe(`10 pts · ${SPLIT_WORD.winnerTakesAll}`);
  });
  it("a game that awards match by match (or slot by slot) states its total only (ruling 3)", () => {
    expect(worth({ gameTypeId: "gtt_match_play", pointsTotal: 8 })).toBe("8 pts");
    expect(worth({ gameTypeId: "gtt_rack_n_stack", pointsTotal: 8 })).toBe("8 pts");
    expect(worth({ gameTypeId: "gtt_generic_card", competitionFormat: "matches", pointsTotal: 4 })).toBe("4 pts");
  });
  it("pick'em states its total only: its split depends on settings the board does not carry", () => {
    expect(worth({ gameTypeId: "gtt_pickem", pointsTotal: 6 })).toBe("6 pts");
  });
  it("a game with no points says so", () => {
    expect(worth({ pointsTotal: 0 })).toBe(AWARD_WORD.noPoints);
    expect(AWARD_WORD.noPoints).toBe("No points");
  });
  it("one point reads pt, a half is a decimal", () => {
    expect(worth({ gameTypeId: "gtt_match_play", pointsTotal: 1 })).toBe("1 pt");
    expect(worth({ gameTypeId: "gtt_match_play", pointsTotal: 2.5 })).toBe("2.5 pts");
  });
});

describe("each game's line", () => {
  const line = (g: Partial<HowScoringGameInput>) => cup([game(g)]).games[0].line;
  it("the format's line", () => {
    expect(line({})).toBe(FORMAT_LINE.gtt_stroke_play);
  });
  it("a non-golf game played as Matches or Best of N says that", () => {
    expect(line({ gameTypeId: "gtt_generic_card", competitionFormat: "matches" })).toBe(NONGOLF_FORMAT_WORD.matches.desc);
    expect(line({ gameTypeId: "gtt_generic_card", competitionFormat: "best_of_n" })).toBe(NONGOLF_FORMAT_WORD.best_of_n.desc);
  });
  it("every non-golf type has its own line, never another type's", () => {
    const types = ["gtt_generic_card", "gtt_generic_yard", "gtt_generic_bar", "gtt_manual"] as const;
    const lines = types.map((t) => line({ gameTypeId: t }));
    expect(lines).toEqual(types.map((t) => FORMAT_LINE[t]));
    expect(new Set(lines).size).toBe(types.length);
  });
  it("Simple keeps the type's line", () => {
    expect(line({ gameTypeId: "gtt_generic_card", competitionFormat: "head_to_head" })).toBe(FORMAT_LINE.gtt_generic_card);
  });
});
