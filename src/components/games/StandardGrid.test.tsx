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
    <StandardGrid units={units} participants={[]} values={{}} tee={{ name: "Blue" }} />
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
    <StandardGrid units={units} participants={[]} values={{}} teeRows={teeRows} />
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
      <StandardGrid units={round18} participants={[]} values={{}} tee={{ name: "Blue" }} glorious={g(3)} />
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
      <StandardGrid units={round18} participants={[]} values={{}} tee={{ name: "Blue" }} glorious={g(4)} />
    );
    for (const h of [15, 16, 17, 18]) expect(html).toContain(`glorious-diamond-${h}`);
    expect(html).not.toContain("glorious-diamond-14");
    expect(html).toContain("4 Glorious Finishing Holes · Worth Double");
  });

  it("off: none of the treatment renders, and the grid is otherwise unchanged", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={round18} participants={[]} values={{}} tee={{ name: "Blue" }} glorious={NO_GLORIOUS} />
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
    const html = renderToStaticMarkup(<StandardGrid units={round18} participants={[]} values={{}} />);
    expect(html).not.toContain("glorious-diamond-");
  });
});

describe("StandardGrid — Glorious (gate b: score legend untouched)", () => {
  it("legend keeps exactly its five score-value chips, unaffected by glorious state", () => {
    for (const glorious of [NO_GLORIOUS, g(3)]) {
      const html = renderToStaticMarkup(
        <StandardGrid units={round18} participants={[]} values={{}} tee={{ name: "Blue" }} glorious={glorious} />
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
      <StandardGrid units={round18} participants={[]} values={{}} tee={{ name: "Blue" }} glorious={g(3)} />
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
      renderToStaticMarkup(<StandardGrid units={round18} participants={[]} values={{}} glorious={g(3)} />);
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
      <StandardGrid units={round9} participants={[]} values={{}} tee={{ name: "Blue" }} glorious={g(3)} />
    );
    expect(html).not.toContain("glorious-diamond-");
    expect(html).not.toContain("glorious-bracket");
    expect(html).not.toContain("glorious-tees-label"); // gloriousCols.size === 0 → label gate is also closed
  });
});

// ── NET column (#824) ────────────────────────────────────────────────────────
// The reported bug was "handicaps applied twice in rack standings". They are not:
// `score_entries` stores GROSS and the subtraction happens exactly once, in
// `playerStats` / `netStrokeEntries`. What was missing was any way to SEE that on
// the scorecard — it showed gross totals while the board showed a net-derived
// to-par, and the unexplained gap read as a second deduction. These pin the
// column that closes it: gross + dots stay, NET appears beside Total, and the
// arithmetic is hand-computed here rather than mirrored from the component.

/** The value + vs-par text of a SubCell, by test id (raw slice, tags stripped). */
const subCell = (html: string, testId: string) => {
  const i = html.indexOf(`data-testid="${testId}"`);
  if (i === -1) return null;
  const raw = html.slice(i, html.indexOf("</div>", i));
  const spans = [...raw.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
  return { value: spans[0], vsPar: spans[1], raw };
};

describe("StandardGrid — NET column", () => {
  // units: par 4 / 3 / 5 / 4 (holes 1, 2, 10, 18) — par 16 over the four.
  it("one stroked hole: gross 5 keeps its cell + pip, NET reads 4 (not 3)", () => {
    const html = renderToStaticMarkup(
      <StandardGrid
        units={units}
        participants={[{ id: "zach", name: "Zach", color: "#2dd4bf" }]}
        values={{ zach: { "1": 5 } }}
        pips={{ zach: new Set(["1"]) }}
      />
    );
    // The cell itself is untouched — GROSS is what you shot.
    expect(html).toContain('data-testid="score-cell-zach-1"');
    expect(subCell(html, "scorecard-total-zach")?.value).toBe("5");
    // Net = 5 − 1 = 4. The whole point: exactly ONE stroke comes off.
    expect(subCell(html, "scorecard-net-zach")?.value).toBe("4");
    // …and net-to-par on a par 4 is even, which is what the board would show.
    expect(subCell(html, "scorecard-net-zach")?.vsPar).toBe("E");
  });

  it("full round, hand-computed: gross 20 / 2 strokes / par 16 → net 18, +2", () => {
    const html = renderToStaticMarkup(
      <StandardGrid
        units={units}
        participants={[{ id: "zach", name: "Zach", color: "#2dd4bf" }]}
        // 5 + 4 + 6 + 5 = 20 gross; strokes fall on holes 1 and 10.
        values={{ zach: { "1": 5, "2": 4, "10": 6, "18": 5 } }}
        pips={{ zach: new Set(["1", "10"]) }}
      />
    );
    const total = subCell(html, "scorecard-total-zach");
    const net = subCell(html, "scorecard-net-zach");
    expect(total?.value).toBe("20"); // gross
    expect(total?.vsPar).toBe("+4"); // 20 − 16
    expect(net?.value).toBe("18"); // 20 − 2 strokes, applied ONCE
    expect(net?.vsPar).toBe("+2"); // 18 − 16 — reconciles the card to the board
  });

  it("a stroke on an UNPLAYED hole is not credited early", () => {
    const html = renderToStaticMarkup(
      <StandardGrid
        units={units}
        participants={[{ id: "zach", name: "Zach", color: "#2dd4bf" }]}
        // Only hole 1 played; the stroke on hole 10 must not come off yet.
        values={{ zach: { "1": 5 } }}
        pips={{ zach: new Set(["1", "10"]) }}
      />
    );
    expect(subCell(html, "scorecard-net-zach")?.value).toBe("4"); // not 3
  });

  it("the leader marker rides NET, so it can't crown the gross leader", () => {
    const html = renderToStaticMarkup(
      <StandardGrid
        units={units}
        participants={[
          { id: "zach", name: "Zach", color: "#2dd4bf" },
          { id: "matt", name: "Matt", color: "#f59e0b" },
        ]}
        values={{
          zach: { "1": 5, "2": 4, "10": 6, "18": 5 }, // gross 20 → net 18
          matt: { "1": 4, "2": 4, "10": 6, "18": 5 }, // gross 19 → net 19 (scratch)
        }}
        pips={{ zach: new Set(["1", "10"]) }}
      />
    );
    // Matt is the GROSS leader (19 < 20); Zach is the NET leader (18 < 19).
    expect(subCell(html, "scorecard-net-zach")?.value).toBe("18");
    expect(subCell(html, "scorecard-net-matt")?.value).toBe("19");
    // Green place-1 treatment lands on Zach's net cell, and on nobody's total.
    expect(subCell(html, "scorecard-net-zach")?.raw).toContain("--color-bt-place-1-text");
    expect(subCell(html, "scorecard-net-matt")?.raw).not.toContain("--color-bt-place-1-text");
    expect(subCell(html, "scorecard-total-matt")?.raw).not.toContain("--color-bt-place-1-text");
  });

  it("no handicaps → no NET column at all (net ≡ gross; a copy of Total is noise)", () => {
    const html = renderToStaticMarkup(
      <StandardGrid
        units={units}
        participants={[{ id: "matt", name: "Matt", color: "#f59e0b" }]}
        values={{ matt: { "1": 4, "2": 3, "10": 5, "18": 4 } }}
      />
    );
    expect(html).not.toContain('data-testid="scorecard-net-');
    expect(html).not.toContain(">Net<"); // no header cell either
    // Unchanged: gross total still shown, and the leader marker stays on it.
    expect(subCell(html, "scorecard-total-matt")?.value).toBe("16");
    expect(subCell(html, "scorecard-total-matt")?.raw).toContain("--color-bt-place-1-text");
  });

  it("keeps every row aligned — the header gains Net only when the rows do", () => {
    const withNet = renderToStaticMarkup(
      <StandardGrid
        units={units}
        participants={[{ id: "zach", name: "Zach", color: "#2dd4bf" }]}
        values={{ zach: { "1": 5 } }}
        pips={{ zach: new Set(["1"]) }}
        tee={{ name: "Blue" }}
      />
    );
    expect(withNet).toContain(">Net<");
    // Structure rows (Par / Yards / Index) each carry a blank Net cell, so the
    // column stays continuous top to bottom rather than only existing on scores.
    const cols = (row: string) => (withNet.match(new RegExp(row, "g")) ?? []).length;
    expect(cols("Par")).toBeGreaterThan(0);
    expect(cols("Index")).toBeGreaterThan(0);
  });
});

// ── SCORE-ENTRY MODE KEEPS ITS SUBTOTALS ────────────────────────────────────
//
// The companion to `OutcomeScorecard`'s reversal. Out/In/Total were blanked for
// OUTCOME-based match play, where a front-nine figure is valid arithmetic about
// a quantity the format does not recognise. This grid is the SCORE-entry
// scorecard — strokes are entered, and a nine-hole total is exactly what a
// stroke player wants — so the numbers stay.
//
// This is the guard against the obvious over-reach: removing the subtotals for
// all match play, or for the shared chrome, rather than for the one mode where
// they mean nothing. The two modes do not share a component (outcome renders
// `OutcomeScorecard`, score renders this), so the mistake is reachable only by
// editing the wrong file — which is precisely the edit this catches.
describe("StandardGrid — a scored row still carries Out / In / Total", () => {
  const scored = renderToStaticMarkup(
    <StandardGrid
      units={units}
      participants={[{ id: "p1", name: "Ann", color: "#22c55e" }]}
      values={{ p1: { "1": 4, "2": 3, "10": 5, "18": 4 } }}
      tee={{ name: "Blue" }}
    />,
  );

  it("still prints the section headers", () => {
    for (const label of ["Out", "In", "Total"]) expect(scored).toContain(label);
  });

  it("still prints the participant's OWN total, anchored to its testid", () => {
    /**
     * ANCHORED, because the obvious assertion is decorative. An earlier draft
     * checked  for the total — and passed against a mutant
     * where SubCell rendered NOTHING, because these units have par 4+3+5+4 and
     * the PAR row prints 16 too. Same for the section sums.
     *
     *  is emitted only by the participant's own total
     * cell, so the surrounding rows cannot produce it. Verified by the mutant
     * that returns null from SubCell: this fails, the substring version did not.
     */
    expect(scored).toContain('data-testid="scorecard-total-p1"');
    // ...and the cell is not merely present but populated.
    const cell = scored.slice(scored.indexOf('scorecard-total-p1'));
    expect(cell).toMatch(/>16</);
  });  it("renders a participant row at all (the fixture actually scored something)", () => {
    // Absence of matches is absence of search: without this, a fixture that
    // silently rendered no rows would make the assertions above vacuous.
    expect(scored).toContain("Ann");
  });
});
