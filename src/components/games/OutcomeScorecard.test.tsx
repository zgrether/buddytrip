import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { sectionSwing, OutcomeScorecard } from "./OutcomeScorecard";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { HoleOutcomeRow, DecidedHole } from "@/lib/matchPlay";
import type { Participant, ScoreUnit } from "./types";

/**
 * OutcomeScorecard (Refactor B2, built to outcome_scorecard_mockup.html). The
 * running lead lives in the LEADER's row; a tied hole reads "AS" (B's row only,
 * mirroring the mockup); a Glorious win's double-jump is visible in the number;
 * closeout dims the never-played remainder.
 */

describe("OutcomeScorecard — render (react-dom/server)", () => {
  const a: Participant = { id: "a", name: "Brad", color: "#4ade80" };
  const b: Participant = { id: "b", name: "Johnny D", color: "#fb923c" };
  const units = Array.from({ length: 3 }, (_, i) => ({ label: String(i + 1), par: 4 }));

  it("shows a team-colored lead pill in the LEADING side's row only", () => {
    const outcomes: HoleOutcomeRow[] = [{ hole: 1, result: "side_a" }];
    const html = renderToStaticMarkup(
      <OutcomeScorecard units={units} a={a} b={b} outcomes={outcomes} leftColor={a.color} rightColor={b.color} />
    );
    expect(html).toContain("outcome-lead-pill");
    expect(html).toContain(">1<"); // the pill's value
    expect(html).not.toContain("outcome-as"); // not tied — no AS anywhere yet
  });

  it("shows neutral AS (in B's row) when the match is tied", () => {
    const outcomes: HoleOutcomeRow[] = [{ hole: 1, result: "halved" }];
    const html = renderToStaticMarkup(<OutcomeScorecard units={units} a={a} b={b} outcomes={outcomes} />);
    expect(html).toContain("outcome-as");
    expect(html).toContain(">AS<");
  });

  it("shows the closeout line once the match is decided", () => {
    const outcomes: HoleOutcomeRow[] = [{ hole: 1, result: "side_a" }, { hole: 2, result: "side_a" }];
    const html = renderToStaticMarkup(<OutcomeScorecard units={units} a={a} b={b} outcomes={outcomes} />);
    expect(html).toContain("outcome-closeout");
    expect(html).toContain("Brad def. Johnny D");
    expect(html).toContain("2&amp;1"); // React-escaped "2&1"
  });

  /**
   * THE REFERENCE MUST NOT MOVE. This surface is what the stroke scorecard is
   * being matched to, and its result sentence was just repointed at the shared
   * `matchDefeatText` (#1302 shared it between the two ENTRY views; this is the
   * third caller).
   *
   * The separator is the thing at risk: the entry banners use a middle dot and
   * this caption uses an EM DASH — a per-surface choice that predates the
   * extraction, not drift between copies. Asserting the dash exactly is what
   * fails a build that "unified" the punctuation on the way through, which is
   * the tempting and wrong move.
   */
  it("keeps its em dash after the sentence was shared, not the entry banners' middle dot", () => {
    const outcomes: HoleOutcomeRow[] = [{ hole: 1, result: "side_a" }, { hole: 2, result: "side_a" }];
    const html = renderToStaticMarkup(<OutcomeScorecard units={units} a={a} b={b} outcomes={outcomes} />);
    expect(html).toContain("Brad def. Johnny D — 2&amp;1");
    expect(html).not.toContain("Brad def. Johnny D · 2&amp;1");
  });

  it("no outcomes yet → no pills, no closeout, no AS", () => {
    const html = renderToStaticMarkup(<OutcomeScorecard units={units} a={a} b={b} outcomes={[]} />);
    expect(html).not.toContain("outcome-lead-pill");
    expect(html).not.toContain("outcome-closeout");
    expect(html).not.toContain("outcome-as");
  });
});

describe("sectionSwing — the pure per-section signed swing (Out/In/Total for a lead row)", () => {
  it("sums weighted W/L within the range; halves and unplayed holes contribute 0", () => {
    const decided: DecidedHole[] = [
      { hole: 1, result: "W" }, // +1
      { hole: 2, result: "H" }, // 0
      { hole: 5, result: "L" }, // -1
      // hole 9 unplayed → 0
    ];
    expect(sectionSwing(decided, NO_GLORIOUS, 1, 9)).toBe(0); // +1 - 1 = 0
    expect(sectionSwing(decided, NO_GLORIOUS, 1, 1)).toBe(1); // just hole 1
  });

  it("a Glorious hole counts double within its section", () => {
    const decided: DecidedHole[] = [{ hole: 17, result: "W" }];
    const glor: GloriousConfig = { enabled: true, n: 2 }; // holes 17-18
    expect(sectionSwing(decided, glor, 10, 18)).toBe(2);
  });
});

// A CC follow-up ("look just like the normal scorecard — tees, yardage, par,
// stroke index; only the player rows differ"): OutcomeScorecard now renders
// the SAME ScorecardChrome StandardGrid.test.tsx exercises, around lead rows
// instead of score rows. Mirrors that file's fixture shape.
describe("OutcomeScorecard — chrome parity with StandardGrid (tees/yardage/par/index)", () => {
  const a: Participant = { id: "a", name: "Brad", color: "#4ade80" };
  const b: Participant = { id: "b", name: "Johnny D", color: "#fb923c" };
  const courseUnits: ScoreUnit[] = [
    { label: "1", section: "front", par: 4, strokeIndex: 5, yardage: 410 },
    { label: "2", section: "front", par: 3, strokeIndex: 17, yardage: 165 },
    { label: "10", section: "back", par: 5, strokeIndex: 2, yardage: 540 },
    { label: "18", section: "back", par: 4, strokeIndex: 8, yardage: 430 },
  ];

  it("renders the course-structure rows from units alone (Par / Yards / Index), same as StandardGrid", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard units={courseUnits} a={a} b={b} outcomes={[]} tee={{ name: "Blue" }} />
    );
    expect(html).toContain("Par");
    expect(html).toContain("Yards");
    expect(html).toContain("Index");
    expect(html).toContain(">4<"); // a par value
    expect(html).toContain(">17<"); // a stroke index
    expect(html).toContain("410"); // a yardage
    expect(html).toContain("Blue tees");
  });

  it("shows Out / In / Total column headers when units span both nines", () => {
    const html = renderToStaticMarkup(<OutcomeScorecard units={courseUnits} a={a} b={b} outcomes={[]} />);
    expect(html).toContain("Out");
    expect(html).toContain("In");
    expect(html).toContain("Total");
  });

  it("the Out/In/Total columns are BLANK — REVERSED, and the arithmetic was never wrong", () => {
    /**
     * This asserted the columns , on the reasoning that a signed swing is the
     * match-play equivalent of a gross-score section sum.
     *
     * The arithmetic held; the PREMISE did not. Match play is not nine plus
     * nine — it is one continuous eighteen-hole state, and the turn has no
     * standing in the format. Being 2 up after nine is not a milestone, so a
     * front-nine figure is valid arithmetic about a quantity the format does
     * not recognise: authoritative-looking, and answering a question nobody
     * asked. Total went with them because it duplicates the match header, and a
     * lone Total reads as a leftover where three numbers used to be.
     *
     * The COLUMNS stay — the grid keeps its structure — so this asserts the
     * cells are marked non-applicable rather than that the columns are gone.
     */
    const outcomes: HoleOutcomeRow[] = [{ hole: 1, result: "side_a" }, { hole: 3, result: "side_a" }];
    const html = renderToStaticMarkup(
      <OutcomeScorecard units={courseUnits} a={a} b={b} outcomes={outcomes} leftColor={a.color} rightColor={b.color} />
    );
    // The columns are still there, on both rows: Out + In + Total x 2 sides.
    expect(html.split('data-testid="lead-subcell-').length - 1).toBe(6);
    // ...and the Total column no longer prints the +2 it used to.
    expect(html).not.toContain('lead-subcell-A-total"><span aria-hidden style="font-size:11');
    // Only the per-HOLE pills survive: holes 1 and 3 on A's row. No subtotal pill.
    expect(html.split("outcome-lead-pill").length - 1).toBe(2);
  });});
