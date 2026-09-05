import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid, type HoleMark } from "./StandardGrid";
import { matchTrack, matchState, type DecidedHole } from "@/lib/matchPlay";
import type { ScoreUnit, Participant } from "./types";

/**
 * PARITY ITEM 4 — who won each hole, on the card that shows the strokes it was
 * decided by.
 */

const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
}));
const A_COLOR = "#22c55e";
const participants: Participant[] = [
  { id: "pA", name: "Bud Banks", color: A_COLOR },
  { id: "pB", name: "Rob Drupp", color: "#f97316" },
];

const render = (marks: Array<HoleMark | null>) =>
  renderToStaticMarkup(
    <StandardGrid units={units} participants={participants} values={{}} holeMarks={{ pA: marks }} />
  );

/** What one cell on side A's mark row actually rendered. */
const cell = (html: string, hole: number) => {
  const m = html.match(new RegExp(`data-testid="scorecard-mark-pA-${hole}"[^>]*>(.*?)</div>`));
  return m ? m[1] : "MISSING";
};

describe("the hole-marks row", () => {
  /**
   * THE SPEC'S OWN TEST 2, and the one a natural implementation fails: an
   * unplayed hole is BLANK and a halved hole is not. Both are "nobody won this
   * hole" in the data; only one of them is a result.
   *
   * A build that rendered the halved treatment for both — or blanked both —
   * passes every other assertion in this file.
   */
  it("is blank on an unplayed hole and marked on a halved one", () => {
    const html = render([null, "halved"]);
    expect(cell(html, 1)).toBe("");
    expect(cell(html, 2)).not.toBe("");
    expect(cell(html, 2)).toContain('aria-label="Halved"');
  });

  it("marks a won hole in the side's own colour", () => {
    const html = render(["won"]);
    expect(cell(html, 1)).toContain('aria-label="Won"');
    expect(cell(html, 1)).toContain(`background:${A_COLOR}`);
  });

  /** The third state: past close-out is not the same absence as not-yet-played. */
  it("shows the dead-hole dot after close-out, distinct from blank", () => {
    const html = render([null, "dead"]);
    expect(cell(html, 1)).toBe("");
    expect(cell(html, 2)).toContain("·");
  });

  /** All four renderings differ from each other — the property that makes the
   *  row readable at all, asserted as a set rather than pairwise. */
  it("renders four distinguishable states", () => {
    const html = render([null, "halved", "won", "dead"]);
    const rendered = [1, 2, 3, 4].map((h) => cell(html, h));
    expect(new Set(rendered).size).toBe(4);
  });

  /**
   * OPT-IN, the same mechanism `resultLine` uses. Six of this grid's seven
   * callers have no match; omitting the prop is what stops a rack card growing
   * a row about holes won, so the omission is what is asserted.
   */
  it("renders no marks row at all for a caller that omits it", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={units} participants={participants} values={{}} />
    );
    expect(html).not.toContain("scorecard-marks-row");
  });

  /**
   * OUT / IN / TOTAL ARE BLANK — deliberately, not by omission. A count of holes
   * won is not a subtotal of anything match play recognises, and the final cell
   * would restate the result the caption already carries. Pinned so a later
   * "the columns look empty" impulse has to argue with the reasoning.
   */
  it("leaves the subtotal columns empty", () => {
    const html = render(["won", "won", "halved"]);
    // Addressed by testid rather than by slicing the region after the row —
    // the first version of this matched hole LABELS further down the document
    // and failed against correct code, which is "measure the thing, not the
    // region around it" arriving in a test.
    for (const which of ["out", "in", "total"]) {
      const m = html.match(new RegExp(`data-testid="scorecard-marks-${which}-pA"[^>]*>(.*?)</div>`));
      expect(m, `the ${which} cell is missing entirely`).not.toBeNull();
      expect(m![1], `the ${which} cell carries a value`).toBe("");
    }
  });
});

describe("the marks and the card agree about one match", () => {
  /**
   * TWO SURFACES, ONE MATCH. The row and the match card's margin come from the
   * same `matchTrack`/`matchState` pair; this asserts they cannot disagree,
   * which is the failure the lift into `matchPlay` exists to prevent.
   */
  it("the marks count the holes the margin is built from", () => {
    // A wins 1,2,3; B wins 4; 5 halved.
    const decided: DecidedHole[] = [
      { hole: 1, result: "W" },
      { hole: 2, result: "W" },
      { hole: 3, result: "W" },
      { hole: 4, result: "L" },
      { hole: 5, result: "H" },
    ];
    const { track } = matchTrack(decided, 18);
    const st = matchState(decided, 18);

    const aWins = track.filter((c) => c.result === "W").length;
    const bWins = track.filter((c) => c.result === "L").length;
    expect(aWins).toBe(3);
    expect(bWins).toBe(1);
    // The card says A is 2 up; the row shows 3 wins against 1. Same match.
    expect(st.diff).toBe(aWins - bWins);
    expect(st.up).toBe(2);
    expect(st.leader).toBe("A");
  });

  /** Under glorious the lead and the hole COUNT diverge legitimately — a 2×
   *  hole moves the margin by two and the row by one mark. Pinned so nobody
   *  "fixes" the row to match the number. */
  it("a glorious hole moves the margin by two and the row by one mark", () => {
    const decided: DecidedHole[] = [{ hole: 18, result: "W" }];
    const glorious = { enabled: true, n: 2 } as const;
    const { track } = matchTrack(decided, 18, glorious);
    const st = matchState(decided, 18, glorious);
    expect(track.filter((c) => c.result === "W")).toHaveLength(1);
    expect(st.up).toBe(2);
  });
});
