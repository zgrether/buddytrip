import { describe, it, expect } from "vitest";
import { buildBoardRows, matchStanding } from "./pickemBoard";
import { pickemCardModel } from "./pickemMatchCard";
import { matchState } from "./matchPlay";
import type { ScoredSlateGame, ScoredPick } from "./pickemScoring";

/**
 * TWO READS OF THE SAME ROWS MUST NOT DISAGREE ABOUT WHO WON.
 *
 * A pick'em head-to-head is derived twice from one `BoardRow[]`: the head-to-head
 * screen runs `matchStanding`, and the match card runs `pickemCardModel` into the
 * shared match-play engine. They are the same contest, so they must name the same
 * leader and agree about whether it is decided.
 *
 * On 2026-09-13 they did not. The card's per-side ceiling was a WHOLE-MATCH TOTAL
 * applied at every step of a unit-by-unit replay, so a match whose only unresolved
 * game both players had picked the same way carried a total of zero — read as
 * "nothing left to play for" from unit 1. The card closed at the first game that
 * moved the needle and handed the match to whoever won it.
 *
 * Live blast radius across the eight BBMI 2026 matches: three named the WRONG
 * winner (one of them on a level match), and seven of eight closed early.
 *
 * ── Why the whole production slate rather than a minimal fixture ───────────
 *
 * The defect needed a specific coincidence — a decided match whose remaining game
 * is one both sides picked the same way — and a hand-made fixture is exactly where
 * that coincidence gets designed out. These are the real sixteen games and the real
 * sixteen sheets, so the case is present because it happened, not because someone
 * thought to write it.
 *
 * ── What this fails against ───────────────────────────────────────────────
 *
 * The two plausible wrong builds both go red here:
 *   - keeping the scalar total  -> Brad, Zach and Charlie name the wrong leader
 *   - dropping the cap entirely -> leaders come right, but `over`/`thru` do not:
 *     Zach v Tyler reads live at thru 15 on a match whose margin cannot move.
 * `thru` is asserted for that second reason — a build that picks the right winner
 * at the wrong moment is still wrong, and only the thru-count says so.
 */

/** Slate results and multipliers, display order. `-` = not yet resolved. */
const RESULTS = "aahahhhaahahaa-a";
const MULT = "1111111111111222";

/** One char per slate game, display order: the pick each player submitted. */
const SHEETS: Record<string, string> = {
  "Benjamin Dames": "hhaaaahhaaahhhhh",
  "Bill Giesler": "hhhaaahhahahhaah",
  "Bobby steiner": "hhhahahhahahhahh",
  "Brad Giesler": "haahaahahhaahahh",
  "Bud Banks": "hhahaahhaaahhahh",
  "Charlie Piper": "hhhaaahaahahhhhh",
  "Jason Schumacher": "hhhhaahhaaahaaah",
  "JD Shumpert": "hhhaaahaaahhhaah",
  "Jeremy Merling": "hhhaaahaaahhhaha",
  JohnnyD: "hhhhhhhhhhhhhhhh",
  "Matt Facchine": "haaaaahaahahhhhh",
  "Matt Shelley": "hhahaaaahhahaahh",
  "Rob Drupp": "hhahaaaaahahahhh",
  "Tajar Varghese": "aaahhaahahhhaaah",
  "Tyler Larson": "ahhhaahaaaahahhh",
  Zach: "hhaaahhaahhhhahh",
};

/** `game_matches.side_a` / `side_b`, in match_number order. */
const MATCHES: [string, string][] = [
  ["Brad Giesler", "Matt Shelley"],
  ["JohnnyD", "JD Shumpert"],
  ["Rob Drupp", "Tajar Varghese"],
  ["Zach", "Tyler Larson"],
  ["Charlie Piper", "Jeremy Merling"],
  ["Bill Giesler", "Bud Banks"],
  ["Bobby steiner", "Jason Schumacher"],
  ["Benjamin Dames", "Matt Facchine"],
];

/**
 * Expected card, per match. Derived from the rows, not from the implementation:
 * the leader is whoever leads on points, and the close-out point is the last unit
 * after which no unplayed unit carried a stake for the trailing side.
 */
const EXPECTED: Record<string, { leader: string | null; margin: string | null; thru: number }> = {
  "Brad Giesler": { leader: null, margin: null, thru: 15 }, // level 7-7, still live
  JohnnyD: { leader: "JD Shumpert", margin: null, thru: 15 },
  "Rob Drupp": { leader: "Tajar Varghese", margin: "3&2", thru: 14 },
  Zach: { leader: "Zach", margin: "1&2", thru: 14 },
  "Charlie Piper": { leader: "Jeremy Merling", margin: "2&1", thru: 15 },
  "Bill Giesler": { leader: "Bill Giesler", margin: "3&6", thru: 10 },
  "Bobby steiner": { leader: "Bobby steiner", margin: null, thru: 15 },
  "Benjamin Dames": { leader: "Matt Facchine", margin: "2&8", thru: 8 },
};

const expand = (c: string) => (c === "a" ? "away" : c === "h" ? "home" : null);

const slate: ScoredSlateGame[] = [...RESULTS].map((r, i) => ({
  id: `g${i}`,
  result: expand(r) as ScoredSlateGame["result"],
  multiplier: Number(MULT[i]),
}));

const sheetOf = (name: string): ScoredPick[] =>
  [...SHEETS[name]].flatMap((c, i) => {
    const p = expand(c);
    return p ? [{ slateGameId: `g${i}`, pick: p as "away" | "home", confidence: null }] : [];
  });

function derive(aName: string, bName: string) {
  const rows = buildBoardRows(slate, sheetOf(aName), sheetOf(bName), false);
  const standing = matchStanding(rows);
  const model = pickemCardModel(slate, rows);
  const card = matchState(model.results, model.unitCount, model.weightOf, model.upside);
  return { standing, card };
}

describe("pick'em: the card and the head-to-head agree", () => {
  it.each(MATCHES)("%s v %s", (aName, bName) => {
    const { standing, card } = derive(aName, bName);

    const standingLeader = standing.margin > 0 ? aName : standing.margin < 0 ? bName : null;
    const cardLeader = card.leader === "A" ? aName : card.leader === "B" ? bName : null;
    expect(cardLeader, "card and head-to-head name the same leader").toBe(standingLeader);

    /**
     * A margin that can no longer move is a decided match. `matchStanding` says so
     * via `clinched` (a lead beyond the trailing side's ceiling) or by having
     * nothing left; the card must say the same through `over`.
     */
    const decided = standing.clinched || standing.remaining === 0;
    expect(card.over, "card and head-to-head agree the match is decided").toBe(decided);

    const want = EXPECTED[aName];
    expect({ margin: card.margin, thru: card.thru }).toEqual({ margin: want.margin, thru: want.thru });
    expect(cardLeader).toBe(want.leader);
  });

  /**
   * The match the bug was reported on, asserted on its own so a regression names
   * itself. Grether won three of the four games they picked differently and led
   * 9-8; the card gave it to Tyler, who won the FIRST game, by closing there.
   */
  it("Grether v Tyler reads Grether 1&2 thru 14, not Tyler at thru 1", () => {
    const { standing, card } = derive("Zach", "Tyler Larson");
    expect({ a: standing.aTotal, b: standing.bTotal }).toEqual({ a: 9, b: 8 });
    expect(card.leader).toBe("A");
    expect(card.margin).toBe("1&2");
    expect(card.thru).toBe(14);
  });
});
