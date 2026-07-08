import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid } from "./StandardGrid";
import type { ScoreUnit } from "./types";
import type { TeeRow } from "@/lib/teeRows";

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

// Spec 5b — multi-tee yardage rows. When teeRows is supplied, the grid renders one
// yardage row per VISIBLE tee (default = chosen + neighbors), replacing the single
// snapshot Yards row; the chosen tee is highlighted + in play. The tee SELECTION
// controls live behind a collapsed-by-default disclosure (tee-display pass).
describe("StandardGrid — multi-tee yardage rows (5b)", () => {
  const teeRows: TeeRow[] = [
    { name: "Blue", color: "#3b82f6", yards: [410, 165, 540, 430], total: 1545, isChosen: false, defaultVisible: true },
    { name: "White", color: "#e5e7eb", yards: [380, 150, 505, 400], total: 1435, isChosen: true, defaultVisible: true },
    { name: "Red", color: "#ef4444", yards: [300, 120, 430, 340], total: 1190, isChosen: false, defaultVisible: false },
  ];
  const html = renderToStaticMarkup(
    <StandardGrid units={units} participants={[]} values={{}} direction="low_wins" teeRows={teeRows} />
  );

  it("collapses the tee selector behind a disclosure, summarizing the chosen tee", () => {
    expect(html).toContain("tee-legend-toggle"); // the disclosure trigger (collapsed by default)
    expect(html).toContain("Tees"); // the trigger label
    expect(html).toContain("White · in play"); // chosen tee shown in the trigger summary
    // The full per-tee selection is behind the collapsed disclosure — a tee that is
    // neither chosen nor rendered in the grid (Red, default-hidden) is absent from
    // the initial static markup until the disclosure is expanded.
    expect(html).not.toContain("Red");
  });

  it("renders a yardage row for each DEFAULT-VISIBLE tee, and hides the rest", () => {
    expect(html).toContain("tee-row-Blue");
    expect(html).toContain("tee-row-White");
    expect(html).not.toContain("tee-row-Red"); // default-hidden → no row (only the legend entry)
  });

  it("marks the chosen tee in play and highlights it (accent-faint token)", () => {
    expect(html).toContain("· in play");
    expect(html).toContain("var(--color-bt-accent-faint)"); // the chosen row's brighter fill
    expect(html).toContain("var(--color-bt-accent)"); // the chosen row's left accent rail
  });

  it("shows per-tee yardage values (a display-only reference row)", () => {
    expect(html).toContain("410"); // Blue hole 1
    expect(html).toContain("380"); // White (chosen) hole 1
  });
});
