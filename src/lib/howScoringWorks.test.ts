import { describe, it, expect } from "vitest";
import { howScoringWorks, type HowScoringGameInput, type HowScoringInput } from "./howScoringWorks";
import { FORMAT_LINE } from "./formatLines";
import { AWARD_WORD, COMPETING_WORD, NONGOLF_FORMAT_WORD, SPLIT_WORD, WIN_RULE } from "./vocabulary";

/**
 * The How scoring works card's lines (Zach's rulings, 2026-10-22). Each case
 * asserts whole lines, built from the shared words they must come from, so a
 * line worded anywhere else fails here.
 */

const game = (over: Partial<HowScoringGameInput>): HowScoringGameInput => ({
  id: "g", name: "Game", gameTypeId: "gtt_stroke_play", competitionFormat: null, pointsTotal: 10, distribution: null, ...over,
});
const cup = (games: HowScoringGameInput[], over: Partial<HowScoringInput> = {}) =>
  howScoringWorks({ scoringModel: "match_play", teams: [{ name: "Alpha" }, { name: "Bravo" }], teamless: false, games, ...over });

describe("who is competing", () => {
  it("teams, by name", () => {
    expect(cup([]).competing).toEqual({ label: COMPETING_WORD.teamCount(2), names: "Alpha and Bravo" });
  });
  it("a tournament of individuals", () => {
    expect(cup([], { scoringModel: "points", teams: [], teamless: true }).competing).toEqual({ label: COMPETING_WORD.individuals, names: null });
  });
});

describe("how the winner is decided", () => {
  it("a Cup of match games: the target, why it drops, a level Cup is shared", () => {
    expect(cup([game({ gameTypeId: "gtt_match_play" })]).rules).toEqual([WIN_RULE.cupTarget, WIN_RULE.cupTargetDrops, WIN_RULE.cupLevel]);
  });
  it("tied places only where a game awards by place", () => {
    expect(cup([game({ gameTypeId: "gtt_match_play" }), game({ gameTypeId: "gtt_generic_yard" })]).rules).toContain(WIN_RULE.tiedPlaces);
  });
  it("a Tournament: most points wins, level shares the place", () => {
    expect(cup([], { scoringModel: "points" }).rules).toEqual([WIN_RULE.tournament, WIN_RULE.tournamentTie]);
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
    expect(worth({ pointsTotal: 0 })).toBe(AWARD_WORD.none);
  });
  it("one point reads pt, a half reads ½", () => {
    expect(worth({ gameTypeId: "gtt_match_play", pointsTotal: 1 })).toBe("1 pt");
    expect(worth({ gameTypeId: "gtt_match_play", pointsTotal: 2.5 })).toBe("2½ pts");
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
  it("Simple keeps the type's line", () => {
    expect(line({ gameTypeId: "gtt_generic_card", competitionFormat: "head_to_head" })).toBe(FORMAT_LINE.gtt_generic_card);
  });
});
