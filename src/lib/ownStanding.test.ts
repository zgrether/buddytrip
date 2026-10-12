import { describe, it, expect } from "vitest";
import { formatOwnStanding } from "./ownStanding";

/**
 * The words on your live card (#1599), as Zach ruled them 2026-10-12. Each case
 * is an exact string: a wording test that matches a substring can pass on the
 * wrong word.
 */
describe("formatOwnStanding — match play, from the viewer's side", () => {
  it("leading, level, trailing: UP, AS, DN, each with how far through", () => {
    expect(formatOwnStanding({ kind: "match", lead: 2, thru: 7, over: false, margin: null })).toBe("2 UP thru 7");
    expect(formatOwnStanding({ kind: "match", lead: 0, thru: 7, over: false, margin: null })).toBe("AS thru 7");
    expect(formatOwnStanding({ kind: "match", lead: -2, thru: 7, over: false, margin: null })).toBe("2 DN thru 7");
  });

  it("closed out early: the same margin, won or lost", () => {
    expect(formatOwnStanding({ kind: "match", lead: 3, thru: 16, over: true, margin: "3&2" })).toBe("Won 3&2");
    expect(formatOwnStanding({ kind: "match", lead: -3, thru: 16, over: true, margin: "3&2" })).toBe("Lost 3&2");
  });

  it("decided on the last hole: the loser's margin reads DN, not the winner's UP", () => {
    expect(formatOwnStanding({ kind: "match", lead: 1, thru: 18, over: true, margin: "1 UP" })).toBe("Won 1 UP");
    expect(formatOwnStanding({ kind: "match", lead: -1, thru: 18, over: true, margin: "1 UP" })).toBe("Lost 1 DN");
  });

  it("level at the end is Halved", () => {
    expect(formatOwnStanding({ kind: "match", lead: 0, thru: 18, over: true, margin: "AS" })).toBe("Halved");
  });
});

describe("formatOwnStanding — the other formats", () => {
  it("to par, thru a count or F", () => {
    expect(formatOwnStanding({ kind: "to_par", toPar: 3, thru: "9" })).toBe("+3 thru 9");
    expect(formatOwnStanding({ kind: "to_par", toPar: 0, thru: "9" })).toBe("E thru 9");
    expect(formatOwnStanding({ kind: "to_par", toPar: -1, thru: "F" })).toBe("−1 F");
  });

  it("Stableford in points", () => {
    expect(formatOwnStanding({ kind: "points", points: 14, thru: "9" })).toBe("14 pts thru 9");
    expect(formatOwnStanding({ kind: "points", points: 1, thru: "F" })).toBe("1 pt F");
  });

  it("skins", () => {
    expect(formatOwnStanding({ kind: "skins", skins: 2, thru: "7" })).toBe("2 skins thru 7");
    expect(formatOwnStanding({ kind: "skins", skins: 0, thru: "7" })).toBe("0 skins thru 7");
    expect(formatOwnStanding({ kind: "skins", skins: 1, thru: "7" })).toBe("1 skin thru 7");
  });

  it("pick'em: points and how many results are in; no sheet is NOTHING, not 0", () => {
    expect(formatOwnStanding({ kind: "pickem", points: 14, resolved: 11, total: 16 })).toBe("14 pts · 11 of 16 in");
    expect(formatOwnStanding({ kind: "pickem", points: 0, resolved: 1, total: 16 })).toBe("0 pts · 1 of 16 in");
    expect(formatOwnStanding({ kind: "pickem", points: null, resolved: 1, total: 16 })).toBe("Nothing submitted");
  });

  it("non-golf matches say Tied, never the golf word Halved", () => {
    expect(formatOwnStanding({ kind: "result", result: "won" })).toBe("Won");
    expect(formatOwnStanding({ kind: "result", result: "lost" })).toBe("Lost");
    expect(formatOwnStanding({ kind: "result", result: "tied" })).toBe("Tied");
    expect(formatOwnStanding({ kind: "result", result: "pending" })).toBe("Not decided");
  });

  it("not started", () => {
    expect(formatOwnStanding({ kind: "not_started" })).toBe("Not started");
  });
});
