import { describe, it, expect } from "vitest";
import {
  computeSideBets,
  buildNassauBets,
  buildDoubleBet,
  lastHoleDoubleOffers,
  nassauAvailable,
  pressRules,
  playerTotal,
  buildManualBet,
  playerBetLines,
  betsInvolvingPlayer,
  buildManualPress,
  makePressBet,
  pressBetId,
  betRate,
  betQualifier,
  canManuallyPress,
  formatMoney,
  formatSignedMoney,
  betLabel,
  betTotalForPlayer,
  rulesForKind,
  holeValue,
  EXPOSURE_WARN_MULTIPLE,
  type BetScoring,
  type SideBet,
  type SideBetsInput,
} from "./sideBets";

/**
 * The rules module's suite. Every assertion here is on a NUMBER the module
 * returns, never on "a tracker rendered" — which is the whole reason the rules
 * are not in the component (see the module doc, and `reorderList.ts`'s).
 *
 * The one that matters most is the recompute case (§8's own note): the property
 * §4 buys is that fixing a wrong score on the 9th re-derives the entire tally,
 * including whether a press should have fired, and a suite that only ever
 * enters scores in order never exercises it.
 */

const P = { zach: "p-zach", brad: "p-brad", cal: "p-cal", dave: "p-dave" };
const SIDE_A = { id: "s-a", playerIds: [P.zach] };
const SIDE_B = { id: "s-b", playerIds: [P.brad] };

const holes18 = Array.from({ length: 18 }, (_, i) => i + 1);
const holes9 = Array.from({ length: 9 }, (_, i) => i + 1);

/** Net scores from a per-player hole→score map. Lower wins, so a `4 vs 5` hole
 *  is a win for the first player. */
function net(rows: Record<string, Record<number, number>>): BetScoring {
  return { mode: "net", net: rows };
}

/** Two singles whose holes are described as A-perspective results: "W" = the
 *  first player wins, "L" = the second, "H" = halved. Produces real per-hole
 *  scores, so the module resolves the hole the way it does in the app rather
 *  than being handed the answer. */
function duel(results: Record<number, "W" | "L" | "H">, a = P.zach, b = P.brad): BetScoring {
  const rows: Record<string, Record<number, number>> = { [a]: {}, [b]: {} };
  for (const [hole, r] of Object.entries(results)) {
    const h = Number(hole);
    rows[a][h] = r === "W" ? 4 : 5;
    rows[b][h] = r === "L" ? 4 : 5;
  }
  return net(rows);
}

/**
 * A bet fixture. `kind` is DERIVED from carryover unless given: carrying is
 * what skins does and head-to-head does not (§12), so a fixture asking for a
 * carryover is asking for a pot. Keeps every pre-existing case expressing a
 * configuration the app can actually build.
 */
function bet(over: Partial<SideBet> = {}): SideBet {
  const merged = {
    id: "bet-1",
    sides: [SIDE_A, SIDE_B],
    amount: 10,
    startHole: 1,
    endHole: null,
    carryover: false,
    autoPressAt: null,
    pressOnPress: false,
    origin: { kind: "manual" as const },
    ...over,
  };
  return { ...merged, kind: over.kind ?? (merged.carryover ? "skins" : "head_to_head") };
}

function run(over: Partial<SideBetsInput> = {}): ReturnType<typeof computeSideBets> {
  return computeSideBets({ holes: holes18, bets: [bet()], scoring: duel({}), ...over });
}

describe("no bets", () => {
  it("returns nothing to show and no exposure", () => {
    const r = run({ bets: [] });
    expect(r.bets).toEqual([]);
    expect(r.presses).toEqual([]);
    expect(r.exposure.perHole).toBe(0);
    expect(r.exposure.liveBetCount).toBe(0);
    expect(r.exposure.warn).toBe(false);
    expect(r.totalsByPlayer).toEqual({});
    expect(r.settlement).toEqual([]);
    // A hole line exists per hole, with nothing on it — the caller indexes by
    // hole rather than searching, and "nothing at stake" is $0, not absent.
    expect(r.holeLines).toHaveLength(18);
    expect(r.holeLines.every((l) => l.atStake === 0 && l.perBet.length === 0)).toBe(true);
  });
});

describe("a plain bet", () => {
  it("win 3, lose 1 at $10 a hole is +$20", () => {
    const r = run({ scoring: duel({ 1: "W", 2: "W", 3: "W", 4: "L" }) });
    expect(r.totalsByPlayer[P.zach]).toBe(20);
    expect(r.totalsByPlayer[P.brad]).toBe(-20);
    expect(r.settlement).toEqual([{ fromPlayerId: P.brad, toPlayerId: P.zach, amount: 20 }]);
  });

  it("a bet starting at hole 4 draws nothing from holes 1–3", () => {
    // Holes 1–3 are wins for A and would be +$30 if the bet covered them.
    const scoring = duel({ 1: "W", 2: "W", 3: "W", 4: "W" });
    const from1 = computeSideBets({ holes: holes18, bets: [bet()], scoring });
    const from4 = computeSideBets({ holes: holes18, bets: [bet({ startHole: 4 })], scoring });
    expect(from1.totalsByPlayer[P.zach]).toBe(40);
    expect(from4.totalsByPlayer[P.zach]).toBe(10);
    // And the earlier holes carry no money line for it at all.
    expect(from4.holeLines[0].perBet).toEqual([]);
    expect(from4.holeLines[3].perBet).toHaveLength(1);
  });

  it("an unscored hole is undecided, not halved — it moves no money and ends no bet", () => {
    const r = run({ scoring: duel({ 1: "W", 3: "W" }) });
    expect(r.holeLines[1].decided).toBe(false);
    expect(r.holeLines[1].delta).toEqual({});
    expect(r.totalsByPlayer[P.zach]).toBe(20);
  });
});

describe("carryover", () => {
  it("halving the 4th makes the 5th worth $20", () => {
    const r = run({
      bets: [bet({ carryover: true })],
      scoring: duel({ 1: "W", 2: "W", 3: "W", 4: "H", 5: "W" }),
    });
    expect(r.holeLines[3].atStake).toBe(10); // the 4th was worth its own $10
    expect(r.holeLines[4].atStake).toBe(20); // …which rolled into the 5th
    expect(r.holeLines[4].perBet[0].carriedIn).toBe(1);
    // 3 wins + the doubled 5th
    expect(r.totalsByPlayer[P.zach]).toBe(50);
  });

  it("several halves accumulate", () => {
    const r = run({
      bets: [bet({ carryover: true })],
      scoring: duel({ 1: "H", 2: "H", 3: "H", 4: "W" }),
    });
    expect(r.holeLines.map((l) => l.atStake).slice(0, 5)).toEqual([10, 20, 30, 40, 10]);
    expect(r.totalsByPlayer[P.zach]).toBe(40);
  });

  it("carryover off leaves a halved hole worth nothing and the next back at the stake", () => {
    const r = run({ scoring: duel({ 1: "H", 2: "W" }) });
    expect(r.holeLines[1].atStake).toBe(10);
    expect(r.totalsByPlayer[P.zach]).toBe(10);
  });

  it("the pot rolls THROUGH an unplayed hole rather than resetting on it", () => {
    // Halve the 1st, skip the 2nd entirely, win the 3rd: the 3rd is worth $20.
    const r = run({ bets: [bet({ carryover: true })], scoring: duel({ 1: "H", 3: "W" }) });
    expect(r.holeLines[2].atStake).toBe(20);
    expect(r.totalsByPlayer[P.zach]).toBe(20);
  });
});

describe("automatic press", () => {
  const pressed = (over: Partial<SideBet> = {}, results: Record<number, "W" | "L" | "H"> = {}) =>
    computeSideBets({
      holes: holes18,
      bets: [bet({ autoPressAt: 2, ...over })],
      scoring: duel(results),
    });

  it("fires a new bet from the hole after the trigger, with the original still running", () => {
    // A is 2 down after the 6th (lost 5 and 6 after halving 1–4).
    const r = pressed({}, { 1: "H", 2: "H", 3: "H", 4: "H", 5: "L", 6: "L" });
    expect(r.bets).toHaveLength(2);
    const [original, press] = r.bets;
    expect(original.bet.origin.kind).toBe("manual");
    expect(press.bet.origin).toEqual({ kind: "press", parentId: "bet-1", level: 1 });
    expect(press.bet.startHole).toBe(7);
    // The original is not settled or closed — it is still live on hole 7.
    expect(original.live).toBe(true);
    expect(original.bet.endHole).toBeNull();
  });

  it("runs to the end of the round, not to where the original ends", () => {
    // The parent is a front-nine bet; its press still covers 7 through 18.
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ autoPressAt: 2, endHole: 9 })],
      scoring: duel({ 5: "L", 6: "L", 18: "W" }),
    });
    const press = r.bets.find((t) => t.bet.origin.kind === "press")!;
    expect(press.bet.startHole).toBe(7);
    expect(press.bet.endHole).toBeNull();
    // The 18th is inside the press and outside the original.
    expect(r.holeLines[17].perBet.map((p) => p.betId)).toEqual([press.bet.id]);
  });

  it("pays nothing when it fires — the total moves only as holes are won", () => {
    const r = pressed({}, { 5: "L", 6: "L" });
    expect(r.presses).toHaveLength(1);
    // Two holes lost at $10 and not a cent more for the press existing.
    expect(r.totalsByPlayer[P.zach]).toBe(-20);
    const press = r.bets.find((t) => t.bet.origin.kind === "press")!;
    expect(Object.values(press.totals)).toEqual([0, 0]);
  });

  it("announces itself with the exposure it creates", () => {
    const r = pressed({}, { 5: "L", 6: "L" });
    expect(r.presses[0]).toMatchObject({
      parentId: "bet-1",
      level: 1,
      triggerHole: 6,
      startHole: 7,
      amount: 10,
      exposureAfter: 20, // the original plus the press, both live on the 7th
    });
    // And the hole that triggered it carries the announcement.
    expect(r.holeLines[5].presses).toHaveLength(1);
    expect(r.holeLines[6].presses).toHaveLength(0);
  });

  it("does not fire a press with no holes left to play", () => {
    const r = pressed({}, { 17: "L", 18: "L" });
    expect(r.presses).toEqual([]);
    expect(r.bets).toHaveLength(1);
  });

  it("counts holes, not money — and a carried hole counts for what it was worth", () => {
    // Halve the 1st with carryover (the 2nd is worth $20), then lose the 2nd:
    // that is $20 down = 2 units on a $10 bet, so the press fires on hole 2.
    const r = pressed({ carryover: true }, { 1: "H", 2: "L" });
    expect(r.presses.map((p) => p.triggerHole)).toEqual([2]);
  });
});

describe("presses on presses", () => {
  // A loses the first seven holes, so each level goes two down as fast as it
  // can and the chain is as deep as the rule allows: the original fires at the
  // 2nd, press 1 at the 4th, press 2 at the 6th. Stopping at the 7th leaves the
  // round mid-play, which is the state exposure is a question about.
  const chain = (pressOnPress: boolean) =>
    computeSideBets({
      holes: holes18,
      bets: [bet({ autoPressAt: 2, pressOnPress })],
      scoring: duel(Object.fromEntries(holes18.slice(0, 7).map((h) => [h, "L" as const]))),
    });

  it("off — a press never triggers its own press, however far down it goes", () => {
    const r = chain(false);
    expect(r.presses).toHaveLength(1);
    expect(r.bets).toHaveLength(2);
    expect(r.bets.every((t) => t.bet.origin.kind !== "press" || t.bet.autoPressAt == null)).toBe(true);
  });

  it("on — it does, and exposure compounds through three levels", () => {
    const r = chain(true);
    // Original fires at hole 2 (press 1 from hole 3); press 1 fires at hole 4
    // (press 2 from hole 5); press 2 at hole 6 (press 3 from hole 7).
    expect(r.presses.map((p) => [p.level, p.triggerHole, p.startHole, p.exposureAfter])).toEqual([
      [1, 2, 3, 20],
      [2, 4, 5, 30],
      [3, 6, 7, 40],
    ]);
    // §6's worked example, exactly: $10 a hole with three automatic presses is
    // $40 a hole — the original plus three, each at the same stake. (§8's own
    // restatement of this says "three $10 bets live" reads $40, which is $30;
    // §6's arithmetic is the one that closes, so it is the one asserted.)
    expect(r.holeLines[6].perBet).toHaveLength(4);
    expect(r.exposure.perHole).toBe(40);
    expect(r.exposure.liveBetCount).toBe(4);
  });

  it("is refused outright when automatic press is off, not merely hidden", () => {
    expect(pressRules(null, true)).toEqual({ autoPressAt: null, pressOnPress: false });
    expect(pressRules(2, true)).toEqual({ autoPressAt: 2, pressOnPress: true });
    expect(pressRules(0, true)).toEqual({ autoPressAt: null, pressOnPress: false });
    // And a payload that set it anyway produces no chain, because the press a
    // rule-less bet would make inherits nothing to fire with.
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ autoPressAt: null, pressOnPress: true })],
      scoring: duel(Object.fromEntries(holes18.slice(0, 7).map((h) => [h, "L" as const]))),
    });
    expect(r.presses).toEqual([]);
  });
});

describe("exposure", () => {
  it("is the sum of the live stakes, and names how many bets that is", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ id: "b1" }), bet({ id: "b2" }), bet({ id: "b3" })],
      scoring: duel({ 1: "W" }),
    });
    expect(r.exposure.perHole).toBe(30);
    expect(r.exposure.liveBetCount).toBe(3);
  });

  it("takes its warning past the threshold, and not before", () => {
    const mk = (n: number) =>
      computeSideBets({
        holes: holes18,
        bets: Array.from({ length: n }, (_, i) => bet({ id: `b${i}` })),
        scoring: duel({ 1: "W" }),
      });
    expect(EXPOSURE_WARN_MULTIPLE).toBe(4);
    // The opening stake here is the whole live base, so the multiple is reached
    // only when presses pile on — four independent bets ARE four times one bet,
    // but they are all base, so the ratio stays 1.
    expect(mk(4).exposure.warn).toBe(false);
    const chained = computeSideBets({
      holes: holes18,
      bets: [bet({ autoPressAt: 2, pressOnPress: true })],
      scoring: duel(Object.fromEntries(holes18.slice(0, 7).map((h) => [h, "L" as const]))),
    });
    expect(chained.exposure.baseStake).toBe(10);
    expect(chained.exposure.perHole).toBe(40);
    expect(chained.exposure.warn).toBe(true);
  });

  it("counts only bets that have started and have not ended", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ id: "later", startHole: 10 }), bet({ id: "front", endHole: 9 })],
      scoring: duel({ 1: "W" }),
    });
    // Standing on the 2nd: the front-nine bet is live, the hole-10 one is not.
    expect(r.exposure.perHole).toBe(10);
    expect(r.bets.find((t) => t.bet.id === "later")!.started).toBe(false);
  });
});

describe("a bet that has not started", () => {
  it("is invisible until the round reaches its start hole", () => {
    const late = bet({ id: "late", startHole: 10 });
    const scoring = (through: number) =>
      duel(Object.fromEntries(Array.from({ length: through }, (_, i) => [i + 1, "W" as const])));

    const atNine = computeSideBets({ holes: holes18, bets: [late], scoring: scoring(8) });
    expect(atNine.bets[0].started).toBe(false); // playing the 9th

    const atTen = computeSideBets({ holes: holes18, bets: [late], scoring: scoring(9) });
    expect(atTen.bets[0].started).toBe(true); // playing the 10th
    expect(atTen.exposure.perHole).toBe(10);
  });
});

describe("the per-hole line", () => {
  const scoring = duel({ 1: "H", 2: "H", 3: "H", 4: "H", 5: "H", 6: "H", 7: "W", 8: "W" });
  const r = computeSideBets({ holes: holes18, bets: [bet({ carryover: true })], scoring });

  it("shows what THAT hole was worth", () => {
    // Six halves carried in: the 7th is worth $70.
    expect(r.holeLines[6].hole).toBe(7);
    expect(r.holeLines[6].atStake).toBe(70);
    expect(r.holeLines[6].perBet[0].winnerSideId).toBe(SIDE_A.id);
    expect(r.holeLines[6].delta[P.zach]).toBe(70);
  });

  it("does not depend on which hole is being viewed — there is no hole to view", () => {
    // The banner and the hole lines come out of ONE call with no notion of a
    // current hole, which is the mechanism behind "navigating to hole 3 doesn't
    // rewind it": there is no input a navigation could change.
    const again = computeSideBets({ holes: holes18, bets: [bet({ carryover: true })], scoring });
    expect(again.holeLines).toEqual(r.holeLines);
    expect(again.totalsByPlayer).toEqual(r.totalsByPlayer);
    expect(playerTotal(again, P.zach)).toBe(80);
  });

  it("names the stake and the pot separately — two numbers, two names (§11)", () => {
    const mid = computeSideBets({
      holes: holes18,
      bets: [bet({ carryover: true })], // carryover ⇒ skins, per the fixture
      scoring: duel({ 1: "H", 2: "H" }),
    });
    // The standing rate — what each player is putting in per hole.
    expect(mid.exposure.perHole).toBe(10);
    // What each side has at risk on the 3rd, two halves carried in.
    expect(mid.holeLines[2].atStake).toBe(30);
    // And what the 3rd is WORTH: the pot, which is what the tracker shows.
    expect(mid.holeLines[2].pot).toBe(60);
  });
});

describe("recompute — the property the derived design buys", () => {
  it("fixing a wrong score on the 9th rewrites the 9th and every line after it", () => {
    const base: Record<number, "W" | "L" | "H"> = {
      1: "H", 2: "H", 3: "H", 4: "H", 5: "H", 6: "H", 7: "H", 8: "H", 9: "L", 10: "W", 11: "W",
    };
    const mk = (results: Record<number, "W" | "L" | "H">) =>
      computeSideBets({
        holes: holes18,
        bets: [bet({ carryover: true })],
        scoring: duel(results),
      });

    const wrong = mk(base);
    // Eight halves carried in, so the 9th is worth $90 — and B took it.
    expect(wrong.holeLines[8].atStake).toBe(90);
    expect(wrong.holeLines[8].delta[P.brad]).toBe(90);
    expect(wrong.holeLines[9].atStake).toBe(10); // the pot was collected
    expect(wrong.totalsByPlayer[P.zach]).toBe(-70);

    // Correct the 9th: it was halved, not lost.
    const fixed = mk({ ...base, 9: "H" });
    expect(fixed.holeLines[8].delta).toEqual({}); // the 9th itself changed
    expect(fixed.holeLines[9].atStake).toBe(100); // …and so did the 10th
    expect(fixed.holeLines[10].atStake).toBe(10);
    expect(fixed.totalsByPlayer[P.zach]).toBe(110);
  });

  it("recomputes whether a press should have fired at all", () => {
    const withPress = bet({ autoPressAt: 2 });
    const wrong = computeSideBets({
      holes: holes18,
      bets: [withPress],
      scoring: duel({ 1: "L", 2: "L", 3: "W" }),
    });
    expect(wrong.presses.map((p) => p.triggerHole)).toEqual([2]);

    // The 2nd was actually halved — the press never happened.
    const fixed = computeSideBets({
      holes: holes18,
      bets: [withPress],
      scoring: duel({ 1: "L", 2: "H", 3: "W" }),
    });
    expect(fixed.presses).toEqual([]);
    expect(fixed.bets).toHaveLength(1);
    expect(fixed.exposure.perHole).toBe(10);
  });
});

describe("skins", () => {
  const four = [
    { id: "s1", playerIds: [P.zach] },
    { id: "s2", playerIds: [P.brad] },
    { id: "s3", playerIds: [P.cal] },
    { id: "s4", playerIds: [P.dave] },
  ];

  it("the winner collects the stake from every other side", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: four, carryover: true })],
      scoring: net({
        [P.zach]: { 1: 4 },
        [P.brad]: { 1: 5 },
        [P.cal]: { 1: 5 },
        [P.dave]: { 1: 5 },
      }),
    });
    expect(r.totalsByPlayer[P.zach]).toBe(30);
    expect(r.totalsByPlayer[P.brad]).toBe(-10);
    expect(r.holeLines[0].atStake).toBe(10);
  });

  it("two tying for the low score halves the hole and carries it", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: four, carryover: true })],
      scoring: net({
        [P.zach]: { 1: 4, 2: 4 },
        [P.brad]: { 1: 4, 2: 5 },
        [P.cal]: { 1: 5, 2: 5 },
        [P.dave]: { 1: 5, 2: 5 },
      }),
    });
    expect(r.holeLines[0].delta).toEqual({});
    expect(r.holeLines[1].atStake).toBe(20);
    expect(r.totalsByPlayer[P.zach]).toBe(60);
  });

  it("two of four betting leaves the other two contributing nothing", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: [{ id: "s1", playerIds: [P.zach] }, { id: "s2", playerIds: [P.brad] }] })],
      scoring: net({
        [P.zach]: { 1: 4 },
        [P.brad]: { 1: 5 },
        // Cal and Dave are playing the round and are in no bet.
        [P.cal]: { 1: 3 },
        [P.dave]: { 1: 3 },
      }),
    });
    expect(r.totalsByPlayer[P.zach]).toBe(10);
    expect(r.totalsByPlayer[P.brad]).toBe(-10);
    expect(r.totalsByPlayer[P.cal]).toBeUndefined();
    expect(r.totalsByPlayer[P.dave]).toBeUndefined();
  });
});

describe("a 2v2 bet", () => {
  const pairs = [
    { id: "s-ab", playerIds: [P.zach, P.brad] },
    { id: "s-cd", playerIds: [P.cal, P.dave] },
  ];

  it("is side versus side, best ball, and the side's money splits between partners", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: pairs })],
      scoring: net({
        [P.zach]: { 1: 6 },
        [P.brad]: { 1: 4 }, // the pair's ball
        [P.cal]: { 1: 5 },
        [P.dave]: { 1: 5 },
      }),
    });
    expect(r.totalsByPlayer[P.zach]).toBe(5);
    expect(r.totalsByPlayer[P.brad]).toBe(5);
    expect(r.totalsByPlayer[P.cal]).toBe(-5);
    expect(r.totalsByPlayer[P.dave]).toBe(-5);
  });

  it("waits for every player on a side before deciding the hole", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: pairs })],
      scoring: net({
        [P.zach]: { 1: 4 },
        // Brad has not entered the 1st yet.
        [P.cal]: { 1: 5 },
        [P.dave]: { 1: 5 },
      }),
    });
    expect(r.holeLines[0].decided).toBe(false);
    expect(r.totalsByPlayer[P.zach] ?? 0).toBe(0);
  });
});

describe("outcome scoring", () => {
  const sideA = { id: "m-a", playerIds: [P.zach, P.brad] };
  const sideB = { id: "m-b", playerIds: [P.cal, P.dave] };

  it("gives the same result as scores do for the same hole winners", () => {
    const outcomes: BetScoring = {
      mode: "outcome",
      sideA: sideA.playerIds,
      sideB: sideB.playerIds,
      outcomes: { 1: "side_a", 2: "side_a", 3: "halved", 4: "side_b" },
    };
    const scores = net({
      [P.zach]: { 1: 4, 2: 4, 3: 4, 4: 5 },
      [P.brad]: { 1: 9, 2: 9, 3: 9, 4: 9 },
      [P.cal]: { 1: 5, 2: 5, 3: 4, 4: 4 },
      [P.dave]: { 1: 9, 2: 9, 3: 9, 4: 9 },
    });
    const byOutcome = computeSideBets({ holes: holes18, bets: [bet({ sides: [sideA, sideB], carryover: true })], scoring: outcomes });
    const byScore = computeSideBets({ holes: holes18, bets: [bet({ sides: [sideA, sideB], carryover: true })], scoring: scores });
    expect(byOutcome.totalsByPlayer).toEqual(byScore.totalsByPlayer);
    expect(byOutcome.holeLines.map((l) => l.atStake)).toEqual(byScore.holeLines.map((l) => l.atStake));
  });

  it("leaves a bet whose sides are not the match's sides undecided rather than guessing", () => {
    // There is no per-player stroke behind an outcome, so a Zach-vs-Cal bet in
    // an outcome round cannot be resolved — and must not be resolved wrongly.
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: [{ id: "x", playerIds: [P.zach] }, { id: "y", playerIds: [P.cal] }] })],
      scoring: {
        mode: "outcome",
        sideA: sideA.playerIds,
        sideB: sideB.playerIds,
        outcomes: { 1: "side_a", 2: "side_b" },
      },
    });
    expect(r.holeLines[0].decided).toBe(false);
    expect(r.totalsByPlayer[P.zach]).toBe(0);
  });
});

describe("Nassau", () => {
  const mkIds = () => {
    let n = 0;
    return () => `nassau-${++n}`;
  };

  it("is three bets in one action — 1–9, 10–18, and the whole round", () => {
    const bets = buildNassauBets({
      mkId: mkIds(),
      sides: [SIDE_A, SIDE_B],
      amount: 10,
      startHole: 1,
      holeCount: 18,
      autoPressAt: null,
      pressOnPress: false,
    });
    expect(bets).toHaveLength(3);
    // Only the front nine stops early; the other two run to the end of the
    // round and carry no end hole, exactly like a bet made by hand.
    expect(bets.map((b) => [b.startHole, b.endHole])).toEqual([[1, 9], [10, null], [1, null]]);
    expect(bets.map(betLabel)).toEqual(["Nassau Front 9", "Nassau Back 9", "Nassau Overall"]);
  });

  it("its legs behave as ordinary bets afterwards, and the totals sum", () => {
    const bets = buildNassauBets({
      mkId: mkIds(),
      sides: [SIDE_A, SIDE_B],
      amount: 10,
      startHole: 1,
      holeCount: 18,
      autoPressAt: null,
      pressOnPress: false,
    });
    // Win the 1st (front + overall) and the 10th (back + overall).
    const r = computeSideBets({ holes: holes18, bets, scoring: duel({ 1: "W", 10: "W" }) });
    expect(r.holeLines[0].atStake).toBe(20); // front and overall both live
    expect(r.holeLines[9].atStake).toBe(20); // back and overall
    expect(r.totalsByPlayer[P.zach]).toBe(40);
    // Standing on the 11th: the front nine is over, so back and overall are
    // what is still running.
    expect(r.exposure.perHole).toBe(20);
  });

  it("clamps its legs to where it was set up, rather than pricing played holes", () => {
    const bets = buildNassauBets({
      mkId: mkIds(),
      sides: [SIDE_A, SIDE_B],
      amount: 10,
      startHole: 12,
      holeCount: 18,
      autoPressAt: null,
      pressOnPress: false,
    });
    // The front nine is over — that leg is dropped, not created empty.
    expect(bets.map((b) => [b.startHole, b.endHole])).toEqual([[12, null], [12, null]]);
    expect(bets.map(betLabel)).toEqual(["Nassau Back 9", "Nassau Overall"]);
  });

  it("is not offered on a nine-hole round", () => {
    expect(nassauAvailable(18)).toBe(true);
    expect(nassauAvailable(9)).toBe(false);
  });
});

describe("the last-hole double", () => {
  it("is offered once the second-to-last hole is in, to the side that is down", () => {
    const through17 = duel(Object.fromEntries(holes18.slice(0, 17).map((h) => [h, h <= 2 ? ("L" as const) : ("H" as const)])));
    const r = computeSideBets({ holes: holes18, bets: [bet()], scoring: through17 });
    const offers = lastHoleDoubleOffers(r, holes18);
    expect(offers).toHaveLength(1);
    expect(offers[0].trailingSideId).toBe(SIDE_A.id);
    expect(offers[0].amount).toBe(20);
  });

  it("is not offered earlier, nor once the last hole is in", () => {
    const at16 = computeSideBets({
      holes: holes18,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes18.slice(0, 16).map((h) => [h, "L" as const]))),
    });
    expect(lastHoleDoubleOffers(at16, holes18)).toEqual([]);

    const at18 = computeSideBets({
      holes: holes18,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes18.map((h) => [h, "L" as const]))),
    });
    expect(lastHoleDoubleOffers(at18, holes18)).toEqual([]);
  });

  it("is not offered on a tied bet, and not twice on a declined one", () => {
    const tied = computeSideBets({
      holes: holes18,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes18.slice(0, 17).map((h) => [h, "H" as const]))),
    });
    expect(lastHoleDoubleOffers(tied, holes18)).toEqual([]);

    const behind = computeSideBets({
      holes: holes18,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes18.slice(0, 17).map((h) => [h, h === 1 ? ("L" as const) : ("H" as const)]))),
    });
    expect(lastHoleDoubleOffers(behind, holes18)).toHaveLength(1);
    expect(lastHoleDoubleOffers(behind, holes18, ["bet-1"])).toEqual([]);
  });

  it("records one bet, one hole, doubled stakes", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes18.slice(0, 17).map((h) => [h, h === 1 ? ("L" as const) : ("H" as const)]))),
    });
    const offer = lastHoleDoubleOffers(r, holes18)[0];
    const dbl = buildDoubleBet({ mkId: () => "dbl", offer, lastHole: 18 });
    expect(dbl).toMatchObject({ startHole: 18, endHole: 18, amount: 20, autoPressAt: null });
    const after = computeSideBets({
      holes: holes18,
      bets: [bet(), dbl],
      scoring: duel({ ...Object.fromEntries(holes18.slice(0, 17).map((h) => [h, h === 1 ? ("L" as const) : ("H" as const)])), 18: "W" }),
    });
    // Won the last hole: $10 on the original, $20 on the double, against $10 lost.
    expect(after.totalsByPlayer[P.zach]).toBe(20);
    expect(after.holeLines[17].atStake).toBe(30);
  });
});

describe("a nine-hole round", () => {
  it("carries over and presses within its own length, never reaching for an 18th hole", () => {
    const r = computeSideBets({
      holes: holes9,
      bets: [bet({ carryover: true, autoPressAt: 2 })],
      scoring: duel({ 1: "H", 2: "L", 3: "L" }),
    });
    expect(r.holeLines).toHaveLength(9);
    expect(r.holeLines[1].atStake).toBe(20);
    // $20 down after the 2nd = 2 units → press from the 3rd.
    expect(r.presses.map((p) => [p.triggerHole, p.startHole])).toEqual([[2, 3]]);
    const press = r.bets.find((t) => t.bet.origin.kind === "press")!;
    expect(press.lines.map((l) => l.hole)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("prompts the last-hole double after the 8th", () => {
    const r = computeSideBets({
      holes: holes9,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes9.slice(0, 8).map((h) => [h, h === 1 ? ("L" as const) : ("H" as const)]))),
    });
    expect(lastHoleDoubleOffers(r, holes9)).toHaveLength(1);
    const early = computeSideBets({
      holes: holes9,
      bets: [bet()],
      scoring: duel(Object.fromEntries(holes9.slice(0, 7).map((h) => [h, "L" as const]))),
    });
    expect(lastHoleDoubleOffers(early, holes9)).toEqual([]);
  });
});

describe("money formatting", () => {
  it("keeps whole amounts whole and a split's cents payable", () => {
    expect(formatMoney(40)).toBe("$40");
    expect(formatMoney(-40)).toBe("−$40");
    expect(formatMoney(2.5)).toBe("$2.50");
    expect(formatSignedMoney(40)).toBe("+$40");
    expect(formatSignedMoney(-40)).toBe("−$40");
    expect(formatSignedMoney(0)).toBe("even");
  });
});

describe("the breakdown's per-bet lines", () => {
  it("add up to the number on the strip", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ id: "a" }), bet({ id: "b", amount: 5, startHole: 2 })],
      scoring: duel({ 1: "W", 2: "W" }),
    });
    const lines = r.bets.map((t) => betTotalForPlayer(t, P.zach));
    expect(lines).toEqual([20, 5]);
    expect(lines.reduce((a, b) => a + b, 0)).toBe(r.totalsByPlayer[P.zach]);
  });

  it("splits a pair's line the same way the round total does", () => {
    const pairs = [
      { id: "s-ab", playerIds: [P.zach, P.brad] },
      { id: "s-cd", playerIds: [P.cal, P.dave] },
    ];
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ sides: pairs })],
      scoring: net({
        [P.zach]: { 1: 4 },
        [P.brad]: { 1: 4 },
        [P.cal]: { 1: 5 },
        [P.dave]: { 1: 5 },
      }),
    });
    expect(betTotalForPlayer(r.bets[0], P.zach)).toBe(5);
    expect(betTotalForPlayer(r.bets[0], P.cal)).toBe(-5);
    expect(betTotalForPlayer(r.bets[0], null)).toBe(0);
  });
});

describe("skins — the pot (§11)", () => {
  const four = ["p-zach", "p-brad", "p-cal", "p-dave"].map((id) => ({ id: `s-${id}`, playerIds: [id] }));
  const skins = (over: Partial<SideBet> = {}) =>
    bet({ kind: "skins", sides: four, carryover: true, amount: 10, ...over });

  /** Everyone's net for one hole, from four gross scores. */
  const hole = (h: number, scores: [number, number, number, number]) => ({
    [P.zach]: { [h]: scores[0] },
    [P.brad]: { [h]: scores[1] },
    [P.cal]: { [h]: scores[2] },
    [P.dave]: { [h]: scores[3] },
  });
  const merge = (...rows: Record<string, Record<number, number>>[]) => {
    const out: Record<string, Record<number, number>> = {};
    for (const r of rows) for (const [pid, byHole] of Object.entries(r)) out[pid] = { ...out[pid], ...byHole };
    return net(out);
  };

  it("four at $10 makes the first skin $40 — winner +$30, everyone else −$10", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [skins()],
      scoring: merge(hole(1, [4, 5, 5, 5])),
    });
    // The stake is what each puts in; the skin is what the hole is worth.
    expect(r.holeLines[0].pot).toBe(40);
    expect(r.exposure.perHole).toBe(10);
    expect(r.totalsByPlayer[P.zach]).toBe(30);
    expect(r.totalsByPlayer[P.brad]).toBe(-10);
    expect(r.totalsByPlayer[P.cal]).toBe(-10);
    expect(r.totalsByPlayer[P.dave]).toBe(-10);
  });

  it("second gets nothing, same as fourth", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [skins()],
      scoring: merge(hole(1, [4, 5, 9, 9])),
    });
    expect(r.totalsByPlayer[P.brad]).toBe(r.totalsByPlayer[P.dave]);
  });

  it("a tie for low pays nobody and carries — $80 next, and $160 after three", () => {
    const tied = computeSideBets({
      holes: holes18,
      bets: [skins()],
      scoring: merge(hole(1, [4, 4, 5, 5])),
    });
    expect(tied.holeLines[0].delta).toEqual({});
    expect(Object.values(tied.totalsByPlayer).every((v) => v === 0)).toBe(true);
    expect(tied.holeLines[1].pot).toBe(80);

    const thrice = computeSideBets({
      holes: holes18,
      bets: [skins()],
      scoring: merge(hole(1, [4, 4, 5, 5]), hole(2, [4, 4, 5, 5]), hole(3, [4, 4, 5, 5])),
    });
    // Three carries on a $40 skin makes the fourth hole worth $160.
    expect(thrice.holeLines[3].pot).toBe(160);
  });

  it("is arithmetically identical to head-to-head at two players", () => {
    const two = [
      { id: "s1", playerIds: [P.zach] },
      { id: "s2", playerIds: [P.brad] },
    ];
    const scoring = duel({ 1: "W", 2: "L", 3: "W" });
    const asSkins = computeSideBets({ holes: holes18, bets: [bet({ kind: "skins", sides: two, carryover: false })], scoring });
    const asH2H = computeSideBets({ holes: holes18, bets: [bet({ kind: "head_to_head", sides: two })], scoring });
    expect(asSkins.totalsByPlayer).toEqual(asH2H.totalsByPlayer);
    expect(asSkins.settlement).toEqual(asH2H.settlement);
  });
});

describe("the kinds carry different rules (§12/§13)", () => {
  it("skins gets carryover and no presses; head-to-head the reverse", () => {
    expect(rulesForKind("skins", { autoPressAt: 2, pressOnPress: true })).toEqual({
      carryover: true,
      autoPressAt: null,
      pressOnPress: false,
    });
    expect(rulesForKind("head_to_head", { autoPressAt: 2, pressOnPress: true })).toEqual({
      carryover: false,
      autoPressAt: 2,
      pressOnPress: true,
    });
    expect(rulesForKind("head_to_head")).toEqual({
      carryover: false,
      autoPressAt: null,
      pressOnPress: false,
    });
  });

  it("shows the stake in a head-to-head and the pot in skins", () => {
    const two = [
      { id: "a", playerIds: [P.zach] },
      { id: "b", playerIds: [P.brad] },
    ];
    expect(holeValue(bet({ kind: "head_to_head", sides: two }), 10)).toBe(10);
    expect(holeValue(bet({ kind: "skins", sides: two, carryover: true }), 10)).toBe(20);
  });

  it("a press minted from a head-to-head is itself head-to-head", () => {
    const r = computeSideBets({
      holes: holes18,
      bets: [bet({ autoPressAt: 2 })],
      scoring: duel({ 1: "L", 2: "L" }),
    });
    const press = r.bets.find((t) => t.bet.origin.kind === "press")!;
    expect(press.bet.kind).toBe("head_to_head");
    expect(press.bet.carryover).toBe(false);
  });
});

describe("several bets at once (§14)", () => {
  it("a foursome carries two head-to-heads and a pot simultaneously", () => {
    const zachSteve = bet({
      id: "hh-1",
      amount: 20,
      sides: [{ id: "z1", playerIds: [P.zach] }, { id: "s1", playerIds: [P.brad] }],
    });
    const zachMike = bet({
      id: "hh-2",
      amount: 2,
      sides: [{ id: "z2", playerIds: [P.zach] }, { id: "m2", playerIds: [P.cal] }],
    });
    const pot = bet({
      id: "sk-1",
      kind: "skins",
      carryover: true,
      amount: 10,
      sides: [
        { id: "z3", playerIds: [P.zach] },
        { id: "m3", playerIds: [P.cal] },
        { id: "d3", playerIds: [P.dave] },
      ],
    });
    const r = computeSideBets({
      holes: holes18,
      bets: [zachSteve, zachMike, pot],
      // Zach wins the hole outright against everyone.
      scoring: net({
        [P.zach]: { 1: 3 },
        [P.brad]: { 1: 5 },
        [P.cal]: { 1: 5 },
        [P.dave]: { 1: 5 },
      }),
    });
    expect(r.bets).toHaveLength(3);
    // $20 from Steve, $2 from Mike, and a $30 pot of which he keeps $20 over his own stake.
    expect(r.totalsByPlayer[P.zach]).toBe(20 + 2 + 20);
    expect(r.totalsByPlayer[P.brad]).toBe(-20);
    expect(r.totalsByPlayer[P.cal]).toBe(-2 - 10);
    expect(r.totalsByPlayer[P.dave]).toBe(-10);
    // Steve and Mike never bet each other, and neither settles with the other.
    expect(r.settlement.some((s) => s.fromPlayerId === P.brad && s.toPlayerId === P.cal)).toBe(false);
    // Exposure is the headline that still means something with three bets live.
    expect(r.exposure.perHole).toBe(32);
    expect(r.exposure.liveBetCount).toBe(3);
  });
});

describe("head-to-head is unchanged by all of this (regression guard)", () => {
  it("still presses, still announces, still recomputes when a score is fixed", () => {
    const withPress = bet({ autoPressAt: 2 });
    const fired = computeSideBets({
      holes: holes18,
      bets: [withPress],
      scoring: duel({ 1: "L", 2: "L", 3: "W" }),
    });
    expect(fired.presses.map((p) => [p.triggerHole, p.startHole, p.exposureAfter])).toEqual([[2, 3, 20]]);
    expect(fired.holeLines[1].presses).toHaveLength(1);

    // Correct the 2nd to a halve — the press never happened.
    const fixed = computeSideBets({
      holes: holes18,
      bets: [withPress],
      scoring: duel({ 1: "L", 2: "H", 3: "W" }),
    });
    expect(fixed.presses).toEqual([]);
    expect(fixed.exposure.perHole).toBe(10);
  });
});

/**
 * The strip's columns. These exist because the old strip aggregated: one
 * player's net plus a round-wide "$/hole across N bets". With separate bets
 * between separate people that second figure is nobody's risk, so the
 * assertions below are about ISOLATION — what a player is NOT in must not
 * reach their column.
 */
describe("playerBetLines — one column per player", () => {
  const side = (id: string) => ({ id: `s-${id}`, playerIds: [id] });
  const bet = (id: string, a: string, b: string, amount: number): SideBet =>
    buildManualBet({
      kind: "head_to_head",
      sides: [side(a), side(b)],
      amount,
      startHole: 1,
      autoPressAt: null,
      pressOnPress: false,
      mkId: () => id,
    });

  /** p1 v p2 for $10; p3 v p4 for $25. Nobody is in both. */
  const twoSeparateBets = () =>
    computeSideBets({
      holes: Array.from({ length: 18 }, (_, i) => i + 1),
      bets: [bet("ten", "p1", "p2", 10), bet("twentyfive", "p3", "p4", 25)],
      scoring: { mode: "net", net: {} },
    });

  it("gives each player only the bets they are actually in", () => {
    const lines = playerBetLines(twoSeparateBets(), ["p1", "p2", "p3", "p4"]);
    expect(lines.map((l) => l.bets.map((b) => b.betId))).toEqual([
      ["ten"],
      ["ten"],
      ["twentyfive"],
      ["twentyfive"],
    ]);
  });

  it("puts each player's OWN stake in perHole, never the round's", () => {
    const lines = playerBetLines(twoSeparateBets(), ["p1", "p3"]);
    // The round is $35/hole. Neither player is exposed to $35 — that figure
    // was the whole problem with the line this replaced.
    expect(twoSeparateBets().exposure.perHole).toBe(35);
    expect(lines[0].perHole).toBe(10);
    expect(lines[1].perHole).toBe(25);
  });

  it("gives a player in nothing an empty column, not a zero-dollar bet", () => {
    const [line] = playerBetLines(twoSeparateBets(), ["p9"]);
    expect(line.bets).toEqual([]);
    expect(line.perHole).toBe(0);
    expect(line.total).toBe(0);
  });

  it("counts a player in BOTH bets once per bet", () => {
    const r = computeSideBets({
      holes: Array.from({ length: 18 }, (_, i) => i + 1),
      bets: [bet("a", "p1", "p2", 10), bet("b", "p1", "p3", 25)],
      scoring: { mode: "net", net: {} },
    });
    const [p1] = playerBetLines(r, ["p1"]);
    expect(p1.bets.map((b) => b.betId)).toEqual(["a", "b"]);
    expect(p1.perHole).toBe(35);
  });
});

describe("betsInvolvingPlayer — what a roster removal takes with it", () => {
  const side = (ids: string[]) => ({ id: `s-${ids.join("")}`, playerIds: ids });
  const mk = (id: string, sides: { id: string; playerIds: string[] }[]): SideBet =>
    buildManualBet({
      kind: "head_to_head",
      sides,
      amount: 10,
      startHole: 1,
      autoPressAt: null,
      pressOnPress: false,
      mkId: () => id,
    });

  const bets = [mk("a", [side(["p1"]), side(["p2"])]), mk("b", [side(["p3"]), side(["p4"])])];

  it("finds the bets a player is a side of", () => {
    expect(betsInvolvingPlayer(bets, "p1").map((b) => b.id)).toEqual(["a"]);
    expect(betsInvolvingPlayer(bets, "p4").map((b) => b.id)).toEqual(["b"]);
  });

  it("returns nothing for a player in none — the case that must NOT prompt", () => {
    expect(betsInvolvingPlayer(bets, "p9")).toEqual([]);
  });

  it("finds a player who is a PARTNER on a side, not just a solo side", () => {
    // The failure mode: matching only `sides[i].playerIds[0]` and missing the
    // second name on a 2v2 side, so their bet survives them.
    const doubles = [mk("c", [side(["p1", "p2"]), side(["p3", "p4"])])];
    expect(betsInvolvingPlayer(doubles, "p2").map((b) => b.id)).toEqual(["c"]);
  });
});

describe("betRate / betQualifier — what the strip prints", () => {
  const mk = (kind: "head_to_head" | "skins", amount: number): SideBet =>
    buildManualBet({
      kind,
      sides: [
        { id: "sa", playerIds: ["p1"] },
        { id: "sb", playerIds: ["p2"] },
      ],
      amount,
      startHole: 1,
      mkId: () => "b",
    });

  it("names the UNIT, which differs by kind", () => {
    expect(betRate(mk("head_to_head", 5))).toBe("$5/hole");
    expect(betRate(mk("skins", 5))).toBe("$5/skin");
  });

  it("gives a plain bet no qualifier — the rate already says everything", () => {
    expect(betQualifier(mk("head_to_head", 5))).toBeNull();
    expect(betQualifier(mk("skins", 5))).toBeNull();
  });

  it("keeps the Nassau leg, which the rate CANNOT say", () => {
    // The reason this exists: three legs at one stake are three identical
    // rates, so dropping the leg would make them indistinguishable.
    const legs = buildNassauBets({
      sides: [
        { id: "sa", playerIds: ["p1"] },
        { id: "sb", playerIds: ["p2"] },
      ],
      amount: 5,
      holeCount: 18,
      startHole: 1,
      autoPressAt: null,
      pressOnPress: false,
      mkId: (() => {
        let n = 0;
        return () => `n${++n}`;
      })(),
    });
    expect(legs.map(betRate)).toEqual(["$5/hole", "$5/hole", "$5/hole"]);
    expect(legs.map(betQualifier)).toEqual(["Front 9", "Back 9", "Overall"]);
  });

  it("keeps the press level", () => {
    const parent = mk("head_to_head", 10);
    const p = buildManualPress({ parent, fromHole: 4, mkId: () => "mp" });
    expect(betRate(p)).toBe("$10/hole");
    expect(betQualifier(p)).toBe("Press 1");
  });
});

describe("buildManualPress — a press someone AGREED to", () => {
  const parent = buildManualBet({
    kind: "head_to_head",
    sides: [
      { id: "sa", playerIds: ["p1"] },
      { id: "sb", playerIds: ["p2"] },
    ],
    amount: 10,
    startHole: 1,
    mkId: () => "parent",
  });

  it("starts ON the given hole, not the one after", () => {
    // Agreed on the tee, so it covers the hole about to be played. The
    // automatic press adds one because its trigger hole is already decided.
    expect(buildManualPress({ parent, fromHole: 4, mkId: () => "mp" }).startHole).toBe(4);
    expect(makePressBet(parent, 4).startHole).toBe(5);
  });

  it("does NOT take the derived press's id", () => {
    // The decisive one. Sharing `pressBetId` would mean that turning the
    // parent's automatic press on later produces two bets under one key.
    const manual = buildManualPress({ parent, fromHole: 4, mkId: () => "mp" });
    expect(manual.id).toBe("mp");
    expect(manual.id).not.toBe(pressBetId(parent.id, 1));
  });

  it("keeps the parent's stake and sides, and runs to the end", () => {
    const p = buildManualPress({ parent, fromHole: 4, mkId: () => "mp" });
    expect(p.amount).toBe(10);
    expect(p.sides).toEqual(parent.sides);
    expect(p.endHole).toBeNull();
  });

  it("does not itself auto-press — one agreement, one bet", () => {
    const p = buildManualPress({ parent, fromHole: 4, mkId: () => "mp" });
    expect(p.autoPressAt).toBeNull();
    expect(p.pressOnPress).toBe(false);
  });

  it("presses a press to level 2", () => {
    const first = buildManualPress({ parent, fromHole: 4, mkId: () => "mp1" });
    const second = buildManualPress({ parent: first, fromHole: 8, mkId: () => "mp2" });
    expect(second.origin).toEqual({ kind: "press", parentId: "mp1", level: 2 });
  });

  it("is a REAL bet in the tally, priced like any other", () => {
    // p1 wins holes 4 and 5. Parent $10 each = $20; the press covers both too.
    const net: Record<string, Record<number, number>> = { p1: {}, p2: {} };
    for (const h of [4, 5]) {
      net.p1[h] = 3;
      net.p2[h] = 4;
    }
    const pressed = buildManualPress({ parent, fromHole: 4, mkId: () => "mp" });
    const r = computeSideBets({
      holes: Array.from({ length: 18 }, (_, i) => i + 1),
      bets: [parent, pressed],
      scoring: { mode: "net", net },
    });
    expect(r.totalsByPlayer.p1).toBe(40);
    expect(r.exposure.perHole).toBe(20);
  });
});

describe("canManuallyPress", () => {
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const tallyFor = (bet: SideBet) =>
    computeSideBets({ holes, bets: [bet], scoring: { mode: "net", net: {} } }).bets[0];
  const sides = [
    { id: "sa", playerIds: ["p1"] },
    { id: "sb", playerIds: ["p2"] },
  ];
  const opts = { fromHole: 3, holeCount: 18 };

  it("offers on a live head-to-head with automatic press OFF", () => {
    const t = tallyFor(buildManualBet({ kind: "head_to_head", sides, amount: 5, startHole: 1, mkId: () => "b" }));
    expect(canManuallyPress(t, opts)).toBe(true);
  });

  it("does NOT offer when the bet already presses itself", () => {
    const t = tallyFor(
      buildManualBet({ kind: "head_to_head", sides, amount: 5, startHole: 1, autoPressAt: 2, mkId: () => "b" })
    );
    expect(canManuallyPress(t, opts)).toBe(false);
  });

  it("does NOT offer on skins — the rules refuse them a press at all", () => {
    const t = tallyFor(
      buildManualBet({
        kind: "skins",
        sides: [...sides, { id: "sc", playerIds: ["p3"] }],
        amount: 5,
        startHole: 1,
        mkId: () => "b",
      })
    );
    expect(canManuallyPress(t, opts)).toBe(false);
  });

  it("does NOT offer with no hole left to cover", () => {
    const t = tallyFor(buildManualBet({ kind: "head_to_head", sides, amount: 5, startHole: 1, mkId: () => "b" }));
    expect(canManuallyPress(t, { fromHole: 19, holeCount: 18 })).toBe(false);
  });

  it("does NOT offer on a bet that has not started", () => {
    const t = tallyFor(buildManualBet({ kind: "head_to_head", sides, amount: 5, startHole: 10, mkId: () => "b" }));
    expect(t.live).toBe(false);
    expect(canManuallyPress(t, opts)).toBe(false);
  });
});
