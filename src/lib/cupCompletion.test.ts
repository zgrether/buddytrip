import { describe, it, expect } from "vitest";
import { isCupComplete, obstructsCompletion, gamesRemaining, type CupCompletionGame } from "./cupCompletion";

const locked = (over: Partial<CupCompletionGame> = {}): CupCompletionGame => ({
  status: "complete",
  correctionsOpen: false,
  started: true,
  scoringEnabled: true,
  ...over,
});

describe("obstructsCompletion", () => {
  it("a finalized game does not obstruct", () => {
    expect(obstructsCompletion(locked())).toBe(false);
  });

  it("a live game with scores obstructs", () => {
    expect(obstructsCompletion({ status: "active", started: true, scoringEnabled: true })).toBe(true);
  });

  it("an armed game with no scores yet obstructs — it is underway", () => {
    expect(obstructsCompletion({ status: "active", started: false, scoringEnabled: true })).toBe(true);
  });

  it("a never-armed, never-started game does NOT obstruct — the (c) allowance", () => {
    // The sixth game nobody plays. Requiring it would make the celebration
    // fail silently forever.
    expect(obstructsCompletion({ status: "pending", started: false, scoringEnabled: false })).toBe(false);
  });

  it("a game reopened for correction obstructs — the cup is back in doubt", () => {
    expect(obstructsCompletion(locked({ correctionsOpen: true }))).toBe(true);
  });

  it("absent optional flags read as not-started / not-armed", () => {
    expect(obstructsCompletion({ status: "pending" })).toBe(false);
  });
});

describe("isCupComplete", () => {
  it("no clincher → never complete, whatever the games say", () => {
    expect(isCupComplete([locked(), locked()], false)).toBe(false);
  });

  it("clinched and every game finalized → complete", () => {
    expect(isCupComplete([locked(), locked()], true)).toBe(true);
  });

  it("clinched with a game still live → NOT complete (the restrained state)", () => {
    const games = [locked(), { status: "active", started: true, scoringEnabled: true }];
    expect(isCupComplete(games, true)).toBe(false);
  });

  it("clinched with an unplayed, unarmed game → complete (option (c))", () => {
    // Five played, a sixth added and never touched. The event is over.
    const games = [locked(), locked(), { status: "pending", started: false, scoringEnabled: false }];
    expect(isCupComplete(games, true)).toBe(true);
  });

  it("clinched but one game reopened for correction → NOT complete", () => {
    expect(isCupComplete([locked(), locked({ correctionsOpen: true })], true)).toBe(false);
  });

  it("a cup with ZERO games never completes, even when clinch reads true", () => {
    // winThreshold(0, true) === 0, so a defending team's pointsToClinch is 0 on
    // an empty cup and the existing clinch predicate says "clinched". Without
    // the finalized-game floor, nothing obstructs either and an empty cup would
    // celebrate itself.
    expect(isCupComplete([], true)).toBe(false);
  });

  it("a cup whose only games are unplayed never completes", () => {
    const games = [
      { status: "pending", started: false, scoringEnabled: false },
      { status: "pending", started: false, scoringEnabled: false },
    ];
    expect(isCupComplete(games, true)).toBe(false);
  });
});

describe("gamesRemaining — the hero's 'clinched · N games remain' count", () => {
  it("counts every game NOT locked, including one nobody has armed yet — broader than obstructsCompletion", () => {
    const games = [
      locked(), // done
      { status: "active", started: true, scoringEnabled: true }, // underway
      { status: "pending", started: false, scoringEnabled: false }, // never armed — still counts as remaining
    ];
    expect(gamesRemaining(games)).toBe(2);
  });

  it("a fully locked cup has zero remaining", () => {
    expect(gamesRemaining([locked(), locked()])).toBe(0);
  });

  it("a game reopened for correction counts as remaining again", () => {
    expect(gamesRemaining([locked({ correctionsOpen: true })])).toBe(1);
  });

  it("zero games → zero remaining, not a crash on an empty cup", () => {
    expect(gamesRemaining([])).toBe(0);
  });
});
