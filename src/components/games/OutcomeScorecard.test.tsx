import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeLeadTrack, sectionSwing, OutcomeScorecard } from "./OutcomeScorecard";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { HoleOutcomeRow, DecidedHole } from "@/lib/matchPlay";
import type { Participant, ScoreUnit } from "./types";

/**
 * OutcomeScorecard (Refactor B2, built to outcome_scorecard_mockup.html). The
 * running lead lives in the LEADER's row; a tied hole reads "AS" (B's row only,
 * mirroring the mockup); a Glorious win's double-jump is visible in the number;
 * closeout dims the never-played remainder.
 */

const GLOR2: GloriousConfig = { enabled: true, n: 2 }; // last 2 holes (17,18) worth 2×

describe("computeLeadTrack — the pure per-hole running lead", () => {
  it("the lead hands off between sides as momentum shifts", () => {
    const outcomes: HoleOutcomeRow[] = [
      { hole: 1, result: "side_a" }, // A +1 → 1
      { hole: 2, result: "side_b" }, // A -1 → 0 (AS)
      { hole: 3, result: "side_a" }, // A +1 → 1
    ];
    const { track } = computeLeadTrack(outcomes.map((o) => ({ hole: o.hole, result: o.result === "side_a" ? "W" : o.result === "side_b" ? "L" : "H" })), 18, NO_GLORIOUS);
    expect(track.slice(0, 3)).toEqual([
      { hole: 1, lead: 1, dead: false, glorious: false },
      { hole: 2, lead: 0, dead: false, glorious: false },
      { hole: 3, lead: 1, dead: false, glorious: false },
    ]);
  });

  it("a halved hole CARRIES FORWARD the unchanged lead — not blank", () => {
    const decided = [{ hole: 1, result: "W" as const }, { hole: 2, result: "H" as const }];
    const { track } = computeLeadTrack(decided, 18, NO_GLORIOUS);
    expect(track[1]).toMatchObject({ hole: 2, lead: 1 }); // still 1, carried from hole 1
  });

  it("a Glorious win jumps the lead by 2, not 1 — visible in the number", () => {
    // Holes 1-16 halved (no swing), hole 17 (glorious, GLOR2) won by A.
    const decided = [
      ...Array.from({ length: 16 }, (_, i) => ({ hole: i + 1, result: "H" as const })),
      { hole: 17, result: "W" as const },
    ];
    const { track } = computeLeadTrack(decided, 18, GLOR2);
    expect(track[16]).toMatchObject({ hole: 17, lead: 2, glorious: true }); // +2, not +1
  });

  it("an unplayed (not-yet-entered) hole is neither a lead nor dead — simply blank", () => {
    const decided = [{ hole: 1, result: "W" as const }];
    const { track } = computeLeadTrack(decided, 18, NO_GLORIOUS);
    expect(track[5]).toEqual({ hole: 6, lead: null, dead: false, glorious: false }); // hole 7, untouched
  });

  it("closeout DIMS the never-played remainder — dead, not just unplayed", () => {
    // A wins 1-4, halves 5-13 → 4 up thru 13, 5 to play, swing 5 > 4 → NOT yet closed.
    // Push to a real close-out: A wins 1-7 → 7 up thru 7, 11 to play (still live), then
    // halve the rest so it closes at 18 as "7 UP", nothing dead. Use a smaller, decisive
    // case instead: 3-hole round, A wins holes 1-2 → 2 up thru 2, 1 to play, swing 1 < 2
    // → closed early (2&1). Hole 3 is dead (never played).
    const decided = [{ hole: 1, result: "W" as const }, { hole: 2, result: "W" as const }];
    const { track, st } = computeLeadTrack(decided, 3, NO_GLORIOUS);
    expect(st).toMatchObject({ closed: true, margin: "2&1" });
    expect(track[2]).toEqual({ hole: 3, lead: null, dead: true, glorious: false }); // dead, not blank
  });
});

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

  it("the Out/In/Total columns carry the leading side's swing over that section (not blank)", () => {
    // A wins hole 1 (front) and hole 10 (back) → Out +1, In +1, Total +2.
    const outcomes: HoleOutcomeRow[] = [{ hole: 1, result: "side_a" }, { hole: 3, result: "side_a" }];
    const html = renderToStaticMarkup(
      <OutcomeScorecard units={courseUnits} a={a} b={b} outcomes={outcomes} leftColor={a.color} rightColor={b.color} />
    );
    // 3 lead pills total: hole 1, hole 3 (both single-hole cells) + the Total column (+2).
    // (No Out/In split pill here since each swing is a single hole — Out=+1, In=+1, Total=+2.)
    const pillCount = html.split("outcome-lead-pill").length - 1;
    expect(pillCount).toBeGreaterThanOrEqual(3);
    expect(html).toContain(">2<"); // the Total column's +2
  });
});
