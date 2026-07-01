import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid } from "./StandardGrid";
import type { ScoreUnit } from "./types";

// Empty scorecard PREVIEW (Spec 5a): the grid renders the course STRUCTURE
// (par / yardage / stroke-index rows + front/back sections) independently of
// scores, so passing participants=[] / values={} yields a valid scores-off
// preview with no player rows. Rendered via react-dom/server (node env, no RTL).

const units: ScoreUnit[] = [
  { label: "1", section: "front", par: 4, strokeIndex: 5, yardage: 410 },
  { label: "2", section: "front", par: 3, strokeIndex: 17, yardage: 165 },
  { label: "10", section: "back", par: 5, strokeIndex: 2, yardage: 540 },
  { label: "18", section: "back", par: 4, strokeIndex: 8, yardage: 430 },
];

describe("StandardGrid — empty (scores-off) preview", () => {
  const html = renderToStaticMarkup(
    <StandardGrid units={units} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} />
  );

  it("renders the course-structure rows from units alone (Par / Yards / Index)", () => {
    expect(html).toContain("Par");
    expect(html).toContain("Yards");
    expect(html).toContain("Index");
    // Actual par + stroke-index + yardage values are present (structure, not scores).
    expect(html).toContain(">4<"); // a par value
    expect(html).toContain(">17<"); // a stroke index
    expect(html).toContain("410"); // a yardage
  });

  it("shows front/back sections (Out / In / Total) when units span both nines", () => {
    expect(html).toContain("Out");
    expect(html).toContain("In");
    expect(html).toContain("Total");
  });

  it("renders NO participant rows or score cells when participants=[]", () => {
    expect(html).not.toContain("score-cell-"); // no per-cell score buttons
  });

  it("shows the configured tee header (single tee — 5b adds multi-tee)", () => {
    expect(html).toContain("Blue tees");
  });
});
