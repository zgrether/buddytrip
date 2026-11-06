import { describe, it, expect } from "vitest";
import { pointsHeroStory, type StoryUnit } from "./pointsHeroStory";
import type { ClinchWatch } from "./pointsClinch";

/**
 * The hero's middle tier: one case per row of the spec's §3 table, whole lines,
 * so a row reworded anywhere fails here.
 */

const units: StoryUnit[] = [
  { id: "he", name: "Hot Eagles Cold Beers", shortName: "HECB" },
  { id: "ba", name: "Bogey Army", shortName: "BA" },
  { id: "om", name: "One More Wedge", shortName: "OMW" },
  { id: "hs", name: "Hack Squad", shortName: "HS" },
];

const field = (ids: string[], out: string[] = []) => ids.map((id) => ({ id, out: out.includes(id) }));

const watch = (over: Partial<ClinchWatch> = {}): ClinchWatch => ({
  bankedGames: 2,
  gamesLeft: 6,
  clincherId: null,
  place: 1,
  leaderIds: ["ba"],
  chaserId: "he",
  lead: 2.5,
  swing: 23,
  projectedLead: null,
  liveSwing: 0,
  segments: [],
  field: field(["ba", "he", "om", "hs"]),
  alive: 4,
  wins: { wins: null, sets: [], anySet: false },
  winGameNames: [],
  clinchesIfHolds: null,
  newlyOutIds: [],
  ...over,
});

const story = (w: ClinchWatch, totals: Record<string, number> = {}, final = false) => pointsHeroStory(w, units, totals, final);
const lines = (s: ReturnType<typeof story>) => [s.unitIds[0] ?? null, s.headline, s.sub];

describe("the spec's table", () => {
  it("no game banked", () => {
    expect(lines(story(watch({ bankedGames: 0, gamesLeft: 8, lead: 0 })))).toEqual([null, "Anyone's cup", "8 games left"]);
  });
  it("tied at the top", () => {
    expect(lines(story(watch({ leaderIds: ["he", "ba"], lead: 0, wins: null })))).toEqual([null, "Tied at the top", "HECB & BA · 6 games left"]);
  });
  it("leading, three or more wins away", () => {
    expect(lines(story(watch()))).toEqual(["ba", "Lead by 2.5", "6 games left · all 4 still alive"]);
  });
  it("two wins away, when every pair would do it", () => {
    const w = watch({ gamesLeft: 4, alive: 3, wins: { wins: 2, sets: [["a", "b"]], anySet: true } });
    expect(lines(story(w))).toEqual(["ba", "Two wins from the cup", "Win any 2 of the 4 left · 3 still alive"]);
  });
  it("two wins away, when only some pairs would do it, names no pair", () => {
    const w = watch({ gamesLeft: 4, alive: 3, wins: { wins: 2, sets: [["a", "b"]], anySet: false } });
    expect(lines(story(w))).toEqual(["ba", "Two wins from the cup", "4 games left · 3 still alive"]);
  });
  it("one win away, by any game left", () => {
    const w = watch({ gamesLeft: 3, alive: 3, wins: { wins: 1, sets: [["a"], ["b"], ["c"]], anySet: true }, winGameNames: ["a", "b", "c"] });
    expect(lines(story(w))).toEqual(["ba", "One win from the cup", "Win any of the 3 left · 3 still alive"]);
  });
  it("one win away, by only some games", () => {
    const w = watch({ gamesLeft: 3, alive: 3, wins: { wins: 1, sets: [["s"], ["p"]], anySet: false }, winGameNames: ["Skins", "Pick'em"] });
    expect(lines(story(w))).toEqual(["ba", "One win from the cup", "A win in Skins or Pick'em clinches it · 3 still alive"]);
  });
  it("one game left names it: \"any of the 1\" is not a sentence", () => {
    const w = watch({ gamesLeft: 1, alive: 2, wins: { wins: 1, sets: [["s"]], anySet: true }, winGameNames: ["Skins"] });
    expect(story(w).sub).toBe("A win in Skins clinches it · 2 still alive");
  });
  it("a projecting live game would clinch", () => {
    const w = watch({ wins: { wins: 1, sets: [["s"]], anySet: false }, winGameNames: ["Stableford"], clinchesIfHolds: "Stableford" });
    expect(lines(story(w))).toEqual(["ba", "One win from the cup", "Leading Stableford · clinches if it holds"]);
  });
  it("it would clinch if it holds, but a win alone would not: the headline does not promise one", () => {
    const w = watch({ wins: { wins: null, sets: [], anySet: false }, clinchesIfHolds: "Stableford" });
    expect(lines(story(w))).toEqual(["ba", "Lead by 2.5", "Leading Stableford · clinches if it holds"]);
  });
  it("1st clinched, the race for 2nd wide open", () => {
    const w = watch({ clincherId: "he", place: 2, leaderIds: ["ba"], field: field(["ba", "om", "hs"]), alive: 3 });
    expect(lines(story(w))).toEqual([null, "2nd is up for grabs", "Hot Eagles Cold Beers clinched the cup"]);
  });
  it("1st clinched, level for 2nd", () => {
    const w = watch({ clincherId: "he", place: 2, leaderIds: ["ba", "om"], wins: null });
    expect(lines(story(w))).toEqual([null, "2nd is up for grabs", "Hot Eagles Cold Beers clinched the cup"]);
  });
  it("final", () => {
    const w = watch({ clincherId: "he", place: null, leaderIds: [], gamesLeft: 0 });
    const s = story(w, { he: 25, ba: 16, om: 14, hs: 13 }, true);
    expect(lines(s)).toEqual(["he", "25", "Final · Hot Eagles Cold Beers wins"]);
    expect(s.isScore).toBe(true);
  });
  it("final with a shared place", () => {
    const w = watch({ clincherId: "he", place: null, leaderIds: [], gamesLeft: 0 });
    expect(story(w, { he: 25, ba: 16, om: 15, hs: 15 }, true).sub).toBe("Final · Hot Eagles Cold Beers wins · 3rd shared");
  });
});

describe("below 1st there is no ladder (Zach, 2026-11-05)", () => {
  it("one game from settling 2nd still reads as open, as on F2", () => {
    const w = watch({ clincherId: "he", place: 2, gamesLeft: 1, alive: 3, wins: null, field: field(["ba", "om", "hs"]) });
    expect(lines(story(w))).toEqual([null, "2nd is up for grabs", "Hot Eagles Cold Beers clinched the cup"]);
  });
  it("a lower place reads the same", () => {
    const w = watch({ clincherId: "he", place: 3, wins: null, leaderIds: ["om"], field: field(["om", "hs"]), alive: 2 });
    expect(lines(story(w))).toEqual([null, "3rd is up for grabs", "Hot Eagles Cold Beers clinched the cup"]);
  });
});

describe("a unit dropping out", () => {
  it("takes the still-alive count's place until the next banked game", () => {
    expect(story(watch({ newlyOutIds: ["hs"], alive: 3 })).sub).toBe("6 games left · Hack Squad is out");
  });
  it("two at once", () => {
    expect(story(watch({ newlyOutIds: ["om", "hs"], alive: 2 })).sub).toBe("6 games left · One More Wedge and Hack Squad are out");
  });
});

describe("the edges the table leaves open", () => {
  it("a shared 1st at the end: both units named, and the score", () => {
    const w = watch({ clincherId: null, place: null, leaderIds: [], gamesLeft: 0 });
    const s = story(w, { he: 20, ba: 20, om: 9, hs: 1 }, true);
    expect(s.unitIds).toEqual(["he", "ba"]);
    expect([s.headline, s.sub]).toEqual(["20", "Final · Shared 1st"]);
  });
  it("a shared 1st with a shared place below it says both", () => {
    const w = watch({ clincherId: null, place: null, leaderIds: [], gamesLeft: 0 });
    expect(story(w, { he: 20, ba: 20, om: 9, hs: 9 }, true).sub).toBe("Final · Shared 1st · 3rd shared");
  });
  it("every place locked with a game still open", () => {
    const w = watch({ clincherId: "he", place: null, leaderIds: [], gamesLeft: 1 });
    expect(lines(story(w, { he: 25, ba: 16, om: 9, hs: 1 }))).toEqual(["he", "Clinched the cup", "Every place is set · 1 game left"]);
  });
  it("every place locked with only a correction open: no \"0 games left\"", () => {
    const w = watch({ clincherId: "he", place: null, leaderIds: [], gamesLeft: 0 });
    expect(story(w, { he: 25, ba: 16, om: 9, hs: 1 }).sub).toBe("Every place is set");
  });
  it("a person has no short name, so reads by name", () => {
    const people: StoryUnit[] = [{ id: "a", name: "Pat", shortName: null }, { id: "b", name: "Mo", shortName: null }];
    const s = pointsHeroStory(watch({ leaderIds: ["a", "b"], lead: 0, wins: null }), people, {}, false);
    expect(s.sub).toBe("Pat & Mo · 6 games left");
  });
});

describe("a board waiting to be finished (spec §5)", () => {
  const done = watch({ gamesLeft: 0, place: null, clincherId: "a", leaderIds: ["a"], bankedGames: 2 });
  const us = [
    { id: "a", name: "Alpha", shortName: "ALP" },
    { id: "b", name: "Bravo", shortName: "BRV" },
  ];

  it("claims the banked lead and no more, though the math reads clinched", () => {
    const s = pointsHeroStory(done, us, { a: 9, b: 4.5 }, false, { awaitingFinish: true });
    expect(s).toEqual({ unitIds: ["a"], headline: "Lead by 4.5", sub: "Every game on the board is done", isScore: false });
  });
  it("a clinch already announced stays said", () => {
    const s = pointsHeroStory(done, us, { a: 9, b: 4.5 }, false, { awaitingFinish: true, announced: true });
    expect(s).toEqual({ unitIds: ["a"], headline: "Clinched the cup", sub: "Every game on the board is done", isScore: false });
  });
  it("level at the top names nobody", () => {
    const s = pointsHeroStory(watch({ gamesLeft: 0, place: null, clincherId: null, leaderIds: ["a", "b"], bankedGames: 2 }), us, { a: 5, b: 5 }, false, { awaitingFinish: true });
    expect(s).toEqual({ unitIds: [], headline: "Tied at the top", sub: "Every game on the board is done", isScore: false });
  });
  it("CONTROL: without the wait the same watch reads clinched", () => {
    expect(pointsHeroStory(done, us, { a: 9, b: 4.5 }, false).headline).toBe("Clinched the cup");
  });
});

describe("Final with a tie broken (spec §5)", () => {
  const over = watch({ gamesLeft: 0, place: null, clincherId: null, leaderIds: ["a", "b"], bankedGames: 2 });
  const us = [
    { id: "a", name: "Alpha", shortName: "ALP" },
    { id: "b", name: "Bravo", shortName: "BRV" },
    { id: "c", name: "Coyotes", shortName: "COY" },
    { id: "d", name: "Dingos", shortName: "DIN" },
  ];
  const totals = { a: 9, b: 9, c: 3, d: 3 };

  it("an order breaking 1st makes one winner, with the score", () => {
    const s = pointsHeroStory(over, us, totals, true, { tiebreakOrder: ["b", "a"] });
    expect(s.unitIds).toEqual(["b"]);
    expect(s.headline).toBe("9");
    expect(s.sub).toBe("Final · Bravo wins · 3rd shared");
  });
  it("an order breaking a lower place drops it from the line", () => {
    expect(pointsHeroStory(over, us, totals, true, { tiebreakOrder: ["d", "c"] }).sub).toBe("Final · Shared 1st");
  });
  it("a unit with no result holds no place, so two of them are not a shared place", () => {
    const quiet = [us[0], us[1], { ...us[2], hasResult: false }, { ...us[3], hasResult: false }];
    expect(pointsHeroStory(watch({ gamesLeft: 0, place: null, clincherId: "a", bankedGames: 1 }), quiet, { a: 9, b: 3, c: 0, d: 0 }, true).sub).toBe("Final · Alpha wins");
  });
});
