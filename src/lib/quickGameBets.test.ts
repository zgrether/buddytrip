import { describe, it, expect } from "vitest";
import {
  quickBetHoles,
  quickBetScoring,
  quickSideBets,
  quickHasBets,
  quickBetSidesLocked,
  quickBetDefaultSides,
  quickBetEveryoneSides,
  quickBetSideName,
  quickBetPerspective,
  quickNassauAvailable,
} from "./quickGameBets";
import { playerBetLines, EMPTY_SIDE_BETS, buildManualBet, type SideBet } from "./sideBets";
import { QUICK_GAME_STATE_VERSION, type QuickMatchState, type QuickStrokeState } from "./quickGame";
import { buildCourseSnapshot, type CourseSnapshotInput } from "./courseSnapshot";

/**
 * The adapter's suite. The rules are proven in `sideBets.test.ts`; what is at
 * stake HERE is that a Quick round's own answer to "who won this hole" is the
 * one the money uses — handicaps included, and a match's two entry modes
 * included.
 */

const P4 = [
  { id: "p1", name: "Zach Grether", color: "#2dd4bf" },
  { id: "p2", name: "Buddy Jones", color: "#60a5fa" },
  { id: "p3", name: "Mike", color: "#f59e0b" },
  { id: "p4", name: "Ryan", color: "#a855f7" },
];

function strokeGame(over: Partial<QuickStrokeState> = {}): QuickStrokeState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    format: "stroke",
    players: P4.slice(0, 2),
    values: {},
    finished: false,
    currentHole: 1,
    course: null,
    strokes: {},
    bets: EMPTY_SIDE_BETS,
    ...over,
  };
}

function matchGame(over: Partial<QuickMatchState> = {}): QuickMatchState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    format: "match",
    players: P4.slice(0, 2),
    values: {},
    finished: false,
    currentHole: 1,
    course: null,
    entryMode: "score",
    sideA: { id: "sA", playerIds: ["p1"], strokes: 0 },
    sideB: { id: "sB", playerIds: ["p2"], strokes: 0 },
    outcomes: {},
    modifiers: {},
    bets: EMPTY_SIDE_BETS,
    ...over,
  };
}

/** A $10-a-hole bet between the first two players. */
function tenner(over: Partial<SideBet> = {}): SideBet {
  let n = 0;
  return {
    ...buildManualBet({
      mkId: () => `bet-${++n}`,
      kind: "head_to_head",
      sides: [
        { id: "s1", playerIds: ["p1"] },
        { id: "s2", playerIds: ["p2"] },
      ],
      amount: 10,
      startHole: 1,
      autoPressAt: null,
      pressOnPress: false,
    }),
    ...over,
  };
}

const withBets = <T extends QuickStrokeState | QuickMatchState>(s: T, bets: SideBet[]): T => ({
  ...s,
  bets: { ...EMPTY_SIDE_BETS, bets },
});

/** A real nine-hole course snapshot, so "the round is nine holes" is a fact the
 *  shared unit builder produces rather than a number this test asserts. */
function nineHoleCourse() {
  const input: CourseSnapshotInput = {
    hole_count: 9,
    par: Array.from({ length: 9 }, () => 4),
    handicap_index: Array.from({ length: 9 }, (_, i) => i + 1),
  };
  const snap = buildCourseSnapshot(input, "gtt_stroke_play", undefined);
  if (!snap.ok) throw new Error("fixture course is not usable");
  return { id: "c9", name: "Nine", schema: snap.schema };
}

describe("no bets", () => {
  it("leaves the round exactly as it was", () => {
    const s = strokeGame();
    expect(quickHasBets(s)).toBe(false);
    expect(quickHasBets(null)).toBe(false);
    const r = quickSideBets(s);
    expect(r.bets).toEqual([]);
    expect(r.exposure.perHole).toBe(0);
    expect(playerBetLines(r, ["p1", "p2"]).every((l) => l.total === 0 && l.bets.length === 0)).toBe(true);
  });
});

describe("the money reads the round's own net", () => {
  it("a handicap stroke flips the hole, and the bet with it", () => {
    const gross = { p1: { "1": 5 }, p2: { "1": 4 } };
    const scratch = withBets(strokeGame({ values: gross }), [tenner()]);
    expect(quickSideBets(scratch).totalsByPlayer.p1).toBe(-10);

    // Same scores, but p1 gets a stroke. Without a course the pips fall on
    // holes 1..n, so hole 1 is stroked: 5 − 1 nets to a halve, not a loss.
    const stroked = withBets(strokeGame({ values: gross, strokes: { p1: 1 } }), [tenner()]);
    expect(quickSideBets(stroked).totalsByPlayer.p1).toBe(0);

    // A stroke is worth one shot on the hole, not two — level gross with a
    // stroke in hand is a win.
    const level = withBets(
      strokeGame({ values: { p1: { "1": 5 }, p2: { "1": 5 } }, strokes: { p1: 1 } }),
      [tenner()]
    );
    expect(quickSideBets(level).totalsByPlayer.p1).toBe(10);
  });

  it("hands the rules module net scores, not gross", () => {
    const s = strokeGame({ values: { p1: { "1": 5 } }, strokes: { p1: 1 } });
    const scoring = quickBetScoring(s);
    expect(scoring.mode).toBe("net");
    if (scoring.mode === "net") expect(scoring.net.p1[1]).toBe(4);
  });
});

describe("a match round", () => {
  const sides = [
    { id: "sA", playerIds: ["p1"] },
    { id: "sB", playerIds: ["p2"] },
  ];

  it("scores the bet from the SAME decided holes the match board reads", () => {
    // Score mode: side A's ball beats side B's on the 1st, loses the 2nd.
    const scored = withBets(
      matchGame({ values: { sA: { "1": 4, "2": 5 }, sB: { "1": 5, "2": 4 } } }),
      [tenner({ sides })]
    );
    expect(quickSideBets(scored).totalsByPlayer.p1).toBe(0);

    const won = withBets(
      matchGame({ values: { sA: { "1": 4 }, sB: { "1": 5 } } }),
      [tenner({ sides })]
    );
    expect(quickSideBets(won).totalsByPlayer.p1).toBe(10);
  });

  it("gives outcome mode the same answer as score mode for the same winners", () => {
    const byScore = withBets(
      matchGame({ values: { sA: { "1": 4, "2": 5, "3": 4 }, sB: { "1": 5, "2": 4, "3": 4 } } }),
      [tenner({ sides, carryover: true })]
    );
    const byOutcome = withBets(
      matchGame({
        entryMode: "outcome",
        outcomes: { "1": "side_a", "2": "side_b", "3": "halved" },
      }),
      [tenner({ sides, carryover: true })]
    );
    expect(quickBetScoring(byOutcome).mode).toBe("outcome");
    // A match is resolved through the shared `quickMatchDecided` in BOTH modes,
    // so this is the same code path reached two ways — which is the point.
    expect(quickSideBets(byOutcome).totalsByPlayer).toEqual(quickSideBets(byScore).totalsByPlayer);
    expect(quickSideBets(byOutcome).holeLines.map((l) => l.atStake)).toEqual(
      quickSideBets(byScore).holeLines.map((l) => l.atStake)
    );
  });

  it("carries the relative handicap into the money", () => {
    // Side B receives two strokes; with no course they land on holes 1–2, so
    // B's 5 nets to a 4 and halves the 1st instead of losing it.
    const even = withBets(
      matchGame({ values: { sA: { "1": 4 }, sB: { "1": 5 } } }),
      [tenner({ sides })]
    );
    expect(quickSideBets(even).totalsByPlayer.p1).toBe(10);

    const spotted = withBets(
      matchGame({
        values: { sA: { "1": 4 }, sB: { "1": 5 } },
        sideB: { id: "sB", playerIds: ["p2"], strokes: 2 },
      }),
      [tenner({ sides })]
    );
    expect(quickSideBets(spotted).totalsByPlayer.p1).toBe(0);
  });

  it("locks the sides to the match's, and pre-fills them", () => {
    const s = matchGame();
    expect(quickBetSidesLocked(s)).toBe(true);
    expect(quickBetDefaultSides(s, () => "x")).toEqual([
      { id: "sA", playerIds: ["p1"] },
      { id: "sB", playerIds: ["p2"] },
    ]);
  });
});

describe("choosing sides in a stroke round", () => {
  it("pre-fills a twosome and asks a foursome", () => {
    let n = 0;
    const mk = () => `s${++n}`;
    expect(quickBetSidesLocked(strokeGame())).toBe(false);
    expect(quickBetDefaultSides(strokeGame(), mk)).toHaveLength(2);
    expect(quickBetDefaultSides(strokeGame({ players: P4 }), mk)).toEqual([]);
  });

  it("offers everyone as their own side — the skins shape", () => {
    let n = 0;
    const sides = quickBetEveryoneSides(strokeGame({ players: P4 }), () => `s${++n}`);
    expect(sides.map((s) => s.playerIds)).toEqual([["p1"], ["p2"], ["p3"], ["p4"]]);
  });

  it("names a side by its players' first names", () => {
    const s = strokeGame({ players: P4 });
    expect(quickBetSideName(s, { id: "x", playerIds: ["p1"] })).toBe("Zach");
    expect(quickBetSideName(s, { id: "x", playerIds: ["p1", "p2"] })).toBe("Zach & Buddy");
  });
});

describe("the banner's perspective", () => {
  it("defaults to the first player entered", () => {
    expect(quickBetPerspective(strokeGame({ players: P4 }))).toBe("p1");
  });

  it("falls back when the chosen player has been removed from the roster", () => {
    const s = strokeGame({
      players: P4.slice(0, 2),
      bets: { ...EMPTY_SIDE_BETS, perspectivePlayerId: "p4" },
    });
    expect(quickBetPerspective(s)).toBe("p1");
  });

  it("reads the round's total, with no hole to follow", () => {
    const s = withBets(
      strokeGame({ values: { p1: { "1": 4, "2": 4 }, p2: { "1": 5, "2": 5 } }, currentHole: 1 }),
      [tenner()]
    );
    const lineFor = (g: typeof s, id: string) =>
      playerBetLines(quickSideBets(g), [id])[0];
    expect(lineFor(s, "p1").total).toBe(20);
    // Moving the viewed hole cannot change it — `playerBetLines` takes no hole,
    // which is what makes navigating back to fix the 9th safe.
    const viewed = { ...s, currentHole: 14 };
    expect(lineFor(viewed, "p1").total).toBe(20);
  });
});

describe("round length", () => {
  it("takes its holes from the course, not from a literal 18", () => {
    expect(quickBetHoles(strokeGame())).toHaveLength(18);
    const nine = strokeGame({ course: nineHoleCourse() });
    expect(quickBetHoles(nine)).toHaveLength(9);
    expect(quickNassauAvailable(strokeGame())).toBe(true);
    expect(quickNassauAvailable(nine)).toBe(false);
  });

  it("never prices a hole the round does not have", () => {
    const nine = withBets(strokeGame({ course: nineHoleCourse() }), [tenner()]);
    const r = quickSideBets(nine);
    expect(r.holeLines).toHaveLength(9);
    expect(r.bets[0].lines.every((l) => l.hole <= 9)).toBe(true);
  });
});
