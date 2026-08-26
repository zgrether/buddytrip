import { describe, it, expect } from "vitest";
import {
  emptyBetDraft,
  sidesFromAssignment,
  betDraftError,
  buildBetsFromDraft,
  setPressRules,
  pressOnPressBlurb,
} from "./betDraft";
import { betLabel } from "./sideBets";

const players = ["p1", "p2", "p3", "p4"];
const mkIds = () => {
  let n = 0;
  return () => `s${++n}`;
};

describe("sides from an assignment", () => {
  it("groups by side index and leaves unassigned players out", () => {
    const sides = sidesFromAssignment(players, { p1: 0, p2: 1 }, mkIds());
    expect(sides.map((s) => s.playerIds)).toEqual([["p1"], ["p2"]]);
  });

  it("makes a pair a single side", () => {
    const sides = sidesFromAssignment(players, { p1: 0, p3: 0, p2: 1, p4: 1 }, mkIds());
    expect(sides.map((s) => s.playerIds)).toEqual([
      ["p1", "p3"],
      ["p2", "p4"],
    ]);
  });

  it("supports a side each — skins", () => {
    const sides = sidesFromAssignment(players, { p1: 0, p2: 1, p3: 2, p4: 3 }, mkIds());
    expect(sides).toHaveLength(4);
  });
});

describe("what a draft refuses, and why", () => {
  const draft = emptyBetDraft(1);
  const two = sidesFromAssignment(players, { p1: 0, p2: 1 }, mkIds());

  it("needs two sides", () => {
    expect(betDraftError(draft, sidesFromAssignment(players, { p1: 0 }, mkIds()), { holeCount: 18 }))
      .toMatch(/at least two sides/);
    expect(betDraftError(draft, two, { holeCount: 18 })).toBeNull();
  });

  it("needs a real stake", () => {
    expect(betDraftError({ ...draft, amount: 0 }, two, { holeCount: 18 })).toMatch(/at least/);
    expect(betDraftError({ ...draft, amount: 10_000 }, two, { holeCount: 18 })).toMatch(/under/);
  });

  it("needs a start hole inside the round", () => {
    expect(betDraftError({ ...draft, startHole: 12 }, two, { holeCount: 9 })).toMatch(/9 holes/);
    expect(betDraftError({ ...draft, startHole: 9 }, two, { holeCount: 9 })).toBeNull();
  });

  it("refuses Nassau where there is no back nine", () => {
    expect(betDraftError({ ...draft, kind: "nassau" }, two, { holeCount: 9 })).toMatch(/front and a back/);
    expect(betDraftError({ ...draft, kind: "nassau" }, two, { holeCount: 18 })).toBeNull();
  });

  it("refuses an automatic press on a bet with more than two sides", () => {
    const four = sidesFromAssignment(players, { p1: 0, p2: 1, p3: 2, p4: 3 }, mkIds());
    expect(betDraftError({ ...draft, autoPressAt: 2 }, four, { holeCount: 18 })).toMatch(/two sides/);
  });
});

describe("building the bets", () => {
  const two = sidesFromAssignment(players, { p1: 0, p2: 1 }, mkIds());

  it("records one bet with no end hole", () => {
    const bets = buildBetsFromDraft(emptyBetDraft(4), two, { holeCount: 18, mkId: mkIds() });
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({ startHole: 4, endHole: null, amount: 10 });
  });

  it("records Nassau's three in one action", () => {
    const bets = buildBetsFromDraft({ ...emptyBetDraft(1), kind: "nassau" }, two, {
      holeCount: 18,
      mkId: mkIds(),
    });
    expect(bets.map(betLabel)).toEqual(["Front 9", "Back 9", "Overall"]);
  });

  it("never records presses-on-presses without an automatic press", () => {
    const bets = buildBetsFromDraft(
      { ...emptyBetDraft(1), autoPressAt: null, pressOnPress: true },
      two,
      { holeCount: 18, mkId: mkIds() }
    );
    expect(bets[0].autoPressAt).toBeNull();
    expect(bets[0].pressOnPress).toBe(false);
  });
});

describe("the ☠️ option's dependency", () => {
  it("clears in the DRAFT when automatic press is switched off, not just in what is drawn", () => {
    const on = setPressRules(setPressRules(emptyBetDraft(1), { autoPressAt: 2 }), { pressOnPress: true });
    expect(on).toMatchObject({ autoPressAt: 2, pressOnPress: true });
    const off = setPressRules(on, { autoPressAt: null });
    expect(off).toMatchObject({ autoPressAt: null, pressOnPress: false });
    // And switching it back on does not resurrect the old ☠️ setting.
    expect(setPressRules(off, { autoPressAt: 2 }).pressOnPress).toBe(false);
  });

  it("says what it does to the money, in money", () => {
    const blurb = pressOnPressBlurb(10, 2);
    expect(blurb).toContain("$20");
    expect(blurb).toContain("$40");
    expect(blurb).not.toMatch(/recursive/i);
  });
});
