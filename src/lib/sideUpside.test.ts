import { describe, it, expect } from "vitest";
import { matchState, matchTrack, type DecidedHole } from "./matchPlay";
import { pickemCardModel } from "./pickemMatchCard";
import type { BoardRow } from "./pickemBoard";

/**
 * ROUND 3 ITEM 2 — a match decided by an ABSENT SHEET is over.
 *
 * `matchState`'s model was symmetric: `remainingSwing` assumes either side can
 * take any unplayed unit. True of golf — both players are on the tee — and
 * false the moment a side cannot score at all.
 *
 * BBMI's live shape: 16 games, one resolved, JohnnyD took it, Taj submitted
 * nothing. The engine said `over: false` and the card read "1 UP · THRU 1" on a
 * finished match.
 */

const oneWin: DecidedHole[] = [{ hole: 1, result: "W" }];

describe("the per-side upside cap", () => {
  /**
   * THE SPEC'S FIRST TEST, and the reason it asserts the STATE rather than the
   * rendered token: a display branch on the card would make the card read `F`
   * while leaving `matchState` reporting a live match to every other consumer —
   * the board, the leaderboard, the finalize gate. The state is the thing that
   * was wrong.
   */
  it("closes the match out when the trailing side can gain nothing", () => {
    const open = matchState(oneWin, 16);
    expect(open.over, "without a cap this is the old, wrong answer").toBe(false);

    const closed = matchState(oneWin, 16, undefined, { b: 0 });
    expect(closed.over).toBe(true);
    expect(closed.closed).toBe(true);
    expect(closed.leader).toBe("A");
    expect(closed.margin).toBe("1&15");
  });

  /** Symmetric: the same holds when the ABSENT side is A. */
  it("works from either side", () => {
    const bLeads: DecidedHole[] = [{ hole: 1, result: "L" }];
    const st = matchState(bLeads, 16, undefined, { a: 0 });
    expect(st.over).toBe(true);
    expect(st.leader).toBe("B");
  });

  /**
   * GOLF IS UNTOUCHED. Omitting the cap must reproduce the old answer exactly —
   * this is the assertion that makes the change safe to land in an engine four
   * formats read.
   */
  it("changes nothing when no cap is given", () => {
    for (const holes of [9, 16, 18]) {
      for (const n of [1, 3, 7]) {
        const decided: DecidedHole[] = Array.from({ length: n }, (_, i) => ({ hole: i + 1, result: "W" as const }));
        expect(matchState(decided, holes)).toEqual(matchState(decided, holes, undefined, {}));
      }
    }
  });

  /**
   * A CAP CAN ONLY TIGHTEN. One larger than the units can physically produce
   * must not hold a decided match open — a wrong cap fails safe in the
   * direction that keeps today's answer.
   */
  it("cannot inflate the ceiling beyond the real swing", () => {
    const nearlyDone: DecidedHole[] = Array.from({ length: 17 }, (_, i) => ({ hole: i + 1, result: "W" as const }));
    const uncapped = matchState(nearlyDone, 18);
    const absurd = matchState(nearlyDone, 18, undefined, { a: 999, b: 999 });
    expect(absurd).toEqual(uncapped);
  });

  /** Dormie measures against the trailing side's share too, not the raw swing. */
  it("does not call a match dormie when the trailing side has no upside", () => {
    const st = matchState(oneWin, 16, undefined, { b: 0 });
    expect(st.dormie).toBe(false); // it is decided, not dormie
  });

  /** The track and the state must agree about when it closed — one card, one
   *  answer, which is why the cap is threaded rather than re-derived. */
  it("carries the cap into matchTrack, so the cells and the margin agree", () => {
    const { track, st } = matchTrack(oneWin, 16, undefined, { b: 0 });
    expect(st.over).toBe(true);
    expect(track.filter((c) => c.dead).length).toBe(15);
  });
});

describe("the pick'em adapter supplies it", () => {
  const row = (id: string, over: Partial<BoardRow> = {}): BoardRow =>
    ({ slateGameId: id, result: null, swing: 0, aPoints: 0, bPoints: 0, upsideA: 1, upsideB: 1, zeroKind: null, ...over }) as unknown as BoardRow;

  /**
   * THE WHOLE POINT, end to end: an absent sheet gives every unplayed row
   * `upsideB: 0`, the adapter sums them, and the engine closes the match. Built
   * from the board's OWN row shape rather than a hand-made cap, so this fails if
   * the adapter stops reading the fields `matchStanding` reads.
   */
  it("sums each side's ceiling from the rows, so an absent sheet closes the match", () => {
    const slate = Array.from({ length: 16 }, (_, i) => ({ id: `g${i + 1}` }));
    const rows: BoardRow[] = [
      row("g1", { result: "home", swing: 3, aPoints: 3 }),
      // Taj has no sheet: he can gain nothing on any remaining game.
      ...Array.from({ length: 15 }, (_, i) => row(`g${i + 2}`, { upsideA: 1, upsideB: 0 })),
    ];
    const model = pickemCardModel(slate, rows);
    expect(model.upside).toEqual({ a: 15, b: 0 });

    const st = matchState(model.results, model.unitCount, model.weightOf, model.upside);
    expect(st.over).toBe(true);
    expect(st.leader).toBe("A");
  });

  /** Both sheets present → both ceilings real → the match stays live, which is
   *  the case that must NOT change. */
  it("leaves an ordinary match open", () => {
    const slate = Array.from({ length: 16 }, (_, i) => ({ id: `g${i + 1}` }));
    const rows: BoardRow[] = [
      row("g1", { result: "home", swing: 3, aPoints: 3 }),
      ...Array.from({ length: 15 }, (_, i) => row(`g${i + 2}`)),
    ];
    const model = pickemCardModel(slate, rows);
    expect(model.upside).toEqual({ a: 15, b: 15 });
    expect(matchState(model.results, model.unitCount, model.weightOf, model.upside).over).toBe(false);
  });
});
