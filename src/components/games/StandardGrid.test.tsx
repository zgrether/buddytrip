import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid } from "./StandardGrid";
import type { ScoreUnit } from "./types";
import type { TeeRow } from "@/lib/teeRows";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";

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
    expect(html).toContain("White · playing"); // chosen tee shown in the trigger summary
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

  it("marks the chosen tee playing and highlights it (accent-faint token)", () => {
    expect(html).toContain("· playing");
    expect(html).toContain("var(--color-bt-accent-faint)"); // the chosen row's brighter fill
    expect(html).toContain("var(--color-bt-accent)"); // the chosen row's left accent rail
  });

  it("shows per-tee yardage values (a display-only reference row)", () => {
    expect(html).toContain("410"); // Blue hole 1
    expect(html).toContain("380"); // White (chosen) hole 1
  });
});

// Glorious Finishing Holes visual layer (§8/#571) — a full contiguous 18-hole
// round so array INDEX (i+1) matches the hole LABEL, keeping the fixture
// unambiguous re: engine position vs. display label.
const round18: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
  strokeIndex: i + 1,
  yardage: 400,
}));
const round9: ScoreUnit[] = Array.from({ length: 9 }, (_, i) => ({
  label: String(i + 1),
  section: "front",
  par: 4,
  strokeIndex: i + 1,
  yardage: 400,
}));
const g = (n: number): GloriousConfig => ({ enabled: true, n });

describe("StandardGrid — Glorious Finishing Holes (gate a: marks the right holes)", () => {
  it("N=3: diamond + bracket on holes 16/17/18 only; tees-bar label reads '3 ...'", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} glorious={g(3)} />
    );
    for (const h of [16, 17, 18]) expect(html).toContain(`glorious-diamond-${h}"`);
    // Quote-terminated match — "glorious-diamond-1" is a PREFIX of
    // "glorious-diamond-16/17/18", so an unterminated check would false-positive.
    for (const h of [1, 5, 10, 15]) expect(html).not.toContain(`glorious-diamond-${h}"`);
    expect(html).toContain("glorious-bracket");
    expect(html).toContain("glorious-tees-label");
    expect(html).toContain("3 Glorious Finishing Holes · Worth Double");
  });

  it("N=4: the marked span shifts to holes 15–18 (not hardcoded to 3)", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} glorious={g(4)} />
    );
    for (const h of [15, 16, 17, 18]) expect(html).toContain(`glorious-diamond-${h}`);
    expect(html).not.toContain("glorious-diamond-14");
    expect(html).toContain("4 Glorious Finishing Holes · Worth Double");
  });

  it("off: none of the treatment renders, and the grid is otherwise unchanged", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} glorious={NO_GLORIOUS} />
    );
    expect(html).not.toContain("glorious-diamond-");
    expect(html).not.toContain("glorious-bracket");
    expect(html).not.toContain("glorious-tees-label");
    expect(html).not.toContain("var(--color-bt-glorious"); // no token referenced anywhere
    // Untouched structural rendering still present.
    expect(html).toContain("Par");
    expect(html).toContain("Blue tees");
  });

  it("defaults to NO_GLORIOUS when the prop is omitted entirely", () => {
    const html = renderToStaticMarkup(<StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" />);
    expect(html).not.toContain("glorious-diamond-");
  });
});

describe("StandardGrid — Glorious (gate b: score legend untouched)", () => {
  it("legend keeps exactly its five score-value chips, unaffected by glorious state", () => {
    for (const glorious of [NO_GLORIOUS, g(3)]) {
      const html = renderToStaticMarkup(
        <StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} glorious={glorious} />
      );
      for (const label of ["Eagle", "Birdie", "Par", "Bogey", "Dbl+"]) expect(html).toContain(label);
      // The tees-bar label (a real string this glorious=g(3) case DOES render) must
      // never end up folded into the legend — it's a separate DOM region entirely.
      const legendStart = html.indexOf("Eagle");
      const legendEnd = html.lastIndexOf("Dbl+");
      expect(html.slice(legendStart, legendEnd)).not.toContain("Worth Double");
    }
  });
});

describe("StandardGrid — Glorious (gate e: pure-config, not gated on emptiness)", () => {
  it("zero participants AND zero scores still renders the full treatment (the in-game setup-preview case, #501)", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} glorious={g(3)} />
    );
    expect(html).not.toContain("score-cell-"); // confirms genuinely empty (no participants)
    expect(html).toContain("glorious-diamond-16");
    expect(html).toContain("glorious-bracket");
    expect(html).toContain("glorious-tees-label");
  });
});

describe("StandardGrid — Glorious (gate f: no-course degradation)", () => {
  it("no tee/teeRows → diamond + bracket present, no tees-bar label, no crash", () => {
    const render = () =>
      renderToStaticMarkup(<StandardGrid units={round18} participants={[]} values={{}} direction="low_wins" glorious={g(3)} />);
    expect(render).not.toThrow();
    const html = render();
    expect(html).toContain("glorious-diamond-16");
    expect(html).toContain("glorious-bracket");
    expect(html).not.toContain("glorious-tees-label"); // accepted degradation — no fallback bar
  });
});

describe("StandardGrid — Glorious (9-hole round: the 18−N inertness is inherited, not special-cased)", () => {
  it("no hole on a 9-hole round ever qualifies, so nothing renders — even with glorious enabled", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={round9} participants={[]} values={{}} direction="low_wins" tee={{ name: "Blue" }} glorious={g(3)} />
    );
    expect(html).not.toContain("glorious-diamond-");
    expect(html).not.toContain("glorious-bracket");
    expect(html).not.toContain("glorious-tees-label"); // gloriousCols.size === 0 → label gate is also closed
  });
});
