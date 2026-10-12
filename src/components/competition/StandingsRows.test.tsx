import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandingsRows } from "./StandingsRows";

/**
 * PR 9c-2 — the standings rows as they render. The model (`standingsRows`) has
 * its own tests; these pin what only the markup can: the projected segment is
 * HATCHED (a different paint from banked, so mutating the paint must fail a
 * test — CLAUDE.md's style-only-distinction entry), "No points yet" replaces the
 * bar, and the viewer's row is filled.
 */

const units = [
  { id: "blue", label: "BLU", color: "#3b82f6", hasResult: true },
  { id: "red", label: "RED", color: "#ef4444", hasResult: true },
  { id: "green", label: "GRN", color: "#22c55e", hasResult: false },
];

const render = (over: Partial<Parameters<typeof StandingsRows>[0]> = {}) =>
  renderToStaticMarkup(
    <StandingsRows
      kind="teams"
      units={units}
      unitTotals={{ blue: 6, red: 2 }}
      projections={{ live: { blue: 0, red: 4, green: 0 } }}
      viewerUnitId="red"
      {...over}
    />
  );

/** One element's opening tag, by testid. */
const tag = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("StandingsRows — banked solid, projected hatched", () => {
  it("the banked segment is the team's colour, solid; the projected segment is the hatch of it", () => {
    const html = render();
    expect(tag(html, "standings-banked-red")).toContain("background:#ef4444");
    expect(tag(html, "standings-projected-red")).toContain("repeating-linear-gradient");
    expect(tag(html, "standings-projected-red")).toContain("#ef4444");
    expect(tag(html, "standings-banked-red")).not.toContain("repeating-linear-gradient");
  });

  it("widths share one scale: max(6 + 0, 2 + 4) = 6 → RED 33⅓% banked + 66⅔% hatched", () => {
    const html = render();
    expect(tag(html, "standings-banked-red")).toMatch(/width:33\.33/);
    expect(tag(html, "standings-projected-red")).toMatch(/width:66\.66/);
    expect(tag(html, "standings-banked-blue")).toContain("width:100%");
  });

  it("the legend explains the hatch only when something is projected", () => {
    expect(render()).toContain('data-testid="standings-legend"');
    expect(render({ projections: {} })).not.toContain('data-testid="standings-legend"');
  });
});

describe("StandingsRows — no points yet, and your row", () => {
  it("a team with no finished game reads No points yet, with no bar and no number", () => {
    const html = render();
    expect(html).toContain('data-testid="standings-waiting-green"');
    expect(html).not.toContain('data-testid="standings-bar-green"');
    expect(html).toMatch(/data-testid="standings-points-green"[^>]*><\/span>/);
  });

  it("the viewer's row is filled, and only it", () => {
    const html = render();
    expect(tag(html, "standings-row-red")).toContain("background:var(--color-bt-accent-faint)");
    expect(tag(html, "standings-row-red")).toContain('data-viewer="true"');
    expect(tag(html, "standings-row-blue")).not.toContain("accent-faint");
  });

  it("a person's row (tournament of individuals) uses the accent, not a missing colour", () => {
    const html = render({
      kind: "players",
      units: [{ id: "ann", label: "Ann", color: null, hasResult: true }],
      unitTotals: { ann: 3 },
      projections: {},
      viewerUnitId: "ann",
    });
    expect(tag(html, "standings-banked-ann")).toContain("background:var(--color-bt-accent)");
  });
});
