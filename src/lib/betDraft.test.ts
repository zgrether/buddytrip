import { describe, it, expect } from "vitest";
import {
  emptyBetDraft,
  sidesFromWhoIsIn,
  betDraftError,
  buildBetsFromDraft,
  setPressRules,
  setBetKind,
  toggleWhoIsIn,
  canBeHeadToHead,
  type BetDraft,
} from "./betDraft";
import { betLabel } from "./sideBets";
import { freshBetDraft } from "@/components/games/bets/betControls";

/**
 * The create form's draft. Since §10 the control is a checkbox per player
 * under "who's in" — so what is asserted here is that picking people produces
 * the right SIDES and the right KIND, and that a kind cannot carry a rule that
 * belongs to the other one.
 */

const players = ["p1", "p2", "p3", "p4"];
const mkIds = () => {
  let n = 0;
  return () => `s${++n}`;
};
/** Tick these players' checkboxes, in order. */
const pick = (draft: BetDraft, ids: string[]) => ids.reduce((d, id) => toggleWhoIsIn(d, id), draft);
const sidesOf = (draft: BetDraft) => sidesFromWhoIsIn(players, draft.whoIsIn, mkIds());

describe("who's in", () => {
  it("makes each player their own side, in roster order", () => {
    // Ticked out of order — the bet still reads the way the card does.
    const d = pick(emptyBetDraft(1), ["p3", "p1"]);
    expect(sidesOf(d).map((s) => s.playerIds)).toEqual([["p1"], ["p3"]]);
  });

  it("unticks", () => {
    const d = pick(emptyBetDraft(1), ["p1", "p2", "p1"]);
    expect(d.whoIsIn).toEqual(["p2"]);
  });
});

describe("the kind follows from how many are in", () => {
  it("offers both at two, since they are identical there", () => {
    const d = pick(emptyBetDraft(1), ["p1", "p2"]);
    expect(canBeHeadToHead(d)).toBe(true);
    expect(d.kind).toBe("head_to_head");
    expect(setBetKind(d, "skins").kind).toBe("skins");
  });

  it("forces a pot above two — there is no three-way head-to-head", () => {
    const d = pick(emptyBetDraft(1), ["p1", "p2", "p3"]);
    expect(canBeHeadToHead(d)).toBe(false);
    expect(d.kind).toBe("skins");
  });

  it("carries a head-to-head's press rules over when a third player joins, then drops them", () => {
    const two = setPressRules(pick(emptyBetDraft(1), ["p1", "p2"]), { autoPressAt: 2 });
    expect(two.autoPressAt).toBe(2);
    const three = toggleWhoIsIn(two, "p3");
    // §13 — a pot has no "down two to someone" to press from.
    expect(three.kind).toBe("skins");
    expect(three.autoPressAt).toBeNull();
    expect(three.pressOnPress).toBe(false);
  });
});

describe("rules belong to the kind, not to a toggle (§12/§13)", () => {
  it("gives skins carryover and refuses it presses", () => {
    const d = setBetKind(pick(emptyBetDraft(1), ["p1", "p2"]), "skins");
    const [built] = buildBetsFromDraft(d, sidesOf(d), { holeCount: 18, mkId: mkIds() });
    expect(built.kind).toBe("skins");
    expect(built.carryover).toBe(true);
    expect(built.autoPressAt).toBeNull();
    expect(built.pressOnPress).toBe(false);
  });

  it("gives head-to-head presses and refuses it carryover", () => {
    const d = setPressRules(pick(emptyBetDraft(1), ["p1", "p2"]), { autoPressAt: 2 });
    const [built] = buildBetsFromDraft(d, sidesOf(d), { holeCount: 18, mkId: mkIds() });
    expect(built.kind).toBe("head_to_head");
    expect(built.carryover).toBe(false);
    expect(built.autoPressAt).toBe(2);
  });

  it("cannot smuggle a press onto a pot through setPressRules", () => {
    const pot = setBetKind(pick(emptyBetDraft(1), ["p1", "p2"]), "skins");
    expect(setPressRules(pot, { autoPressAt: 2 }).autoPressAt).toBeNull();
    expect(setPressRules(pot, { pressOnPress: true }).pressOnPress).toBe(false);
  });
});

describe("what a draft refuses, and why", () => {
  const two = pick(emptyBetDraft(1), ["p1", "p2"]);

  it("needs two players", () => {
    const one = pick(emptyBetDraft(1), ["p1"]);
    expect(betDraftError(one, sidesOf(one), { holeCount: 18 })).toMatch(/at least two players/);
    expect(betDraftError(two, sidesOf(two), { holeCount: 18 })).toBeNull();
  });

  it("needs a real stake", () => {
    expect(betDraftError({ ...two, amount: 0 }, sidesOf(two), { holeCount: 18 })).toMatch(/at least/);
    expect(betDraftError({ ...two, amount: 10_000 }, sidesOf(two), { holeCount: 18 })).toMatch(/under/);
  });

  it("needs a start hole inside the round", () => {
    expect(betDraftError({ ...two, startHole: 12 }, sidesOf(two), { holeCount: 9 })).toMatch(/9 holes/);
    expect(betDraftError({ ...two, startHole: 9 }, sidesOf(two), { holeCount: 9 })).toBeNull();
  });

  it("refuses Nassau where there is no back nine, and on a pot", () => {
    expect(betDraftError({ ...two, shape: "nassau" }, sidesOf(two), { holeCount: 9 })).toMatch(/front and a back/);
    expect(betDraftError({ ...two, shape: "nassau" }, sidesOf(two), { holeCount: 18 })).toBeNull();
    const pot = setBetKind(pick(emptyBetDraft(1), ["p1", "p2", "p3"]), "skins");
    expect(betDraftError({ ...pot, shape: "nassau" }, sidesOf(pot), { holeCount: 18 })).toMatch(/head-to-head/);
  });

  it("refuses an automatic press on more than two sides", () => {
    const four = pick(emptyBetDraft(1), players);
    expect(betDraftError({ ...four, autoPressAt: 2 }, sidesOf(four), { holeCount: 18 })).toMatch(/two sides/);
  });
});

describe("building the bets", () => {
  const two = pick(emptyBetDraft(4), ["p1", "p2"]);

  it("records one bet with no end hole", () => {
    const bets = buildBetsFromDraft(two, sidesOf(two), { holeCount: 18, mkId: mkIds() });
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({ startHole: 4, endHole: null, amount: 10 });
  });

  it("records Nassau's three in one action", () => {
    const bets = buildBetsFromDraft({ ...two, startHole: 1, shape: "nassau" }, sidesOf(two), {
      holeCount: 18,
      mkId: mkIds(),
    });
    expect(bets.map(betLabel)).toEqual(["Nassau Front 9", "Nassau Back 9", "Nassau Overall"]);
    expect(bets.every((b) => b.kind === "head_to_head")).toBe(true);
  });

  it("never records presses-on-presses without an automatic press", () => {
    const bets = buildBetsFromDraft(
      { ...two, autoPressAt: null, pressOnPress: true },
      sidesOf(two),
      { holeCount: 18, mkId: mkIds() }
    );
    expect(bets[0].autoPressAt).toBeNull();
    expect(bets[0].pressOnPress).toBe(false);
  });
});

describe("the ☠️ option's dependency", () => {
  const two = pick(emptyBetDraft(1), ["p1", "p2"]);

  it("clears in the DRAFT when automatic press is switched off, not just in what is drawn", () => {
    const on = setPressRules(setPressRules(two, { autoPressAt: 2 }), { pressOnPress: true });
    expect(on).toMatchObject({ autoPressAt: 2, pressOnPress: true });
    const off = setPressRules(on, { autoPressAt: null });
    expect(off).toMatchObject({ autoPressAt: null, pressOnPress: false });
    expect(setPressRules(off, { autoPressAt: 2 }).pressOnPress).toBe(false);
  });

});

describe("a MATCH round's bet is a head-to-head, at any roster size", () => {
  /**
   * The reported bug: Skins turned up in quick match play. It was not the kind
   * CONTROL leaking — that is already hidden when the sides are locked — it was
   * the draft opening as skins because `setWhoIsIn` counts PLAYERS, and a 2v2
   * has four of them. The bet was then recorded, labelled and priced as a
   * four-way pot between two sides, with nothing on screen able to say so.
   */
  const matchSides = [
    { id: "sa", playerIds: ["p1", "p2"] },
    { id: "sb", playerIds: ["p3", "p4"] },
  ];
  const four = ["p1", "p2", "p3", "p4"].map((id) => ({ id, name: id, color: "#000" }));

  it("opens head-to-head with four players on the roster", () => {
    expect(freshBetDraft(four, 1, true).kind).toBe("head_to_head");
    // …and the same roster in a STROKE round still opens as a pot, which is
    // the behaviour this must not have broken.
    expect(freshBetDraft(four, 1, false).kind).toBe("skins");
  });

  it("records a head-to-head even from a draft that says skins", () => {
    const skinsDraft: BetDraft = setBetKind({ ...emptyBetDraft(1), whoIsIn: ["p1", "p2", "p3", "p4"] }, "skins");
    const [locked] = buildBetsFromDraft(skinsDraft, matchSides, { holeCount: 18, mkId: () => "b", sidesLocked: true });
    expect(locked.kind).toBe("head_to_head");
    // Carryover goes with the kind rather than surviving on a bet that has no
    // carryover to speak of — the rule the kind carries, not a second flag.
    expect(locked.carryover).toBe(false);
    expect(betLabel(locked)).toBe("Head to Head");

    // Unlocked, the same draft is still a pot: this forces the kind for a
    // match, it does not retire skins.
    const [free] = buildBetsFromDraft(skinsDraft, matchSides, { holeCount: 18, mkId: () => "b" });
    expect(free.kind).toBe("skins");
  });

  it("names an action the reader can take when a side is empty", () => {
    // The locked branch has no player chips to pick from, so "Pick at least two
    // players" pointed at a control that is not on the screen. The roster above
    // it is where a side gets filled (CLAUDE.md's refusal rule).
    expect(betDraftError(emptyBetDraft(1), [], { holeCount: 18, sidesLocked: true })).toBe(
      "Put a player on each side of the match first."
    );
    expect(betDraftError(emptyBetDraft(1), [], { holeCount: 18 })).toBe("Pick at least two players.");
  });

  it("says what the stake buys — a skin, not a hole", () => {
    const skins: BetDraft = { ...emptyBetDraft(1), kind: "skins", amount: 0 };
    expect(betDraftError(skins, [{ id: "a", playerIds: ["p1"] }, { id: "b", playerIds: ["p2"] }], { holeCount: 18 }))
      .toContain("a skin.");
    const h2h: BetDraft = { ...emptyBetDraft(1), amount: 0 };
    expect(betDraftError(h2h, [{ id: "a", playerIds: ["p1"] }, { id: "b", playerIds: ["p2"] }], { holeCount: 18 }))
      .toContain("a hole.");
  });
});
