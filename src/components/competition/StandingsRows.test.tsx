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

describe("the rank chip (spec §2)", () => {
  /** One row's rank chip: its opening tag and its text. */
  const chip = (html: string, id: string) => {
    const at = html.indexOf(`data-testid="standings-rank-${id}"`);
    const open = html.lastIndexOf("<", at);
    const close = html.indexOf(">", at);
    return { tag: html.slice(open, close + 1), text: html.slice(close + 1, html.indexOf("<", close)) };
  };

  /** Four placed teams, for 1st to 4th. */
  const four = [
    { id: "a", label: "A", color: "#3b82f6", hasResult: true },
    { id: "b", label: "B", color: "#ef4444", hasResult: true },
    { id: "c", label: "C", color: "#22c55e", hasResult: true },
    { id: "d", label: "D", color: "#a855f7", hasResult: true },
  ];
  const placed = (over: Partial<Parameters<typeof StandingsRows>[0]> = {}) =>
    render({ units: four, unitTotals: { a: 9, b: 7, c: 5, d: 3 }, projections: {}, viewerUnitId: null, ...over });

  it("a locked 1st, 2nd and 3rd each wear their own metal's ribbon, named for a screen reader", () => {
    const html = placed({ lockedUnitIds: ["a", "b", "c"] });
    for (const [id, medal, place] of [["a", "gold", "1st"], ["b", "silver", "2nd"], ["c", "bronze", "3rd"]] as const) {
      const t = chip(html, id).tag;
      expect(t.startsWith("<svg")).toBe(true);
      expect(t).toContain(`data-medal="${medal}"`);
      expect(t).toContain(`aria-label="${place} place, locked"`);
    }
    expect(html).toContain("var(--color-bt-medal-silver-deep)");
  });
  it("the ribbon engraves the rank in the darker metal, never a team colour", () => {
    const html = placed({ lockedUnitIds: ["b"] });
    const svg = html.slice(html.indexOf('data-testid="standings-rank-b"'), html.indexOf("</svg>", html.indexOf('data-testid="standings-rank-b"')));
    expect(svg).toMatch(/<text[^>]*fill="var\(--color-bt-medal-silver-deep\)"[^>]*>2<\/text>/);
    expect(svg).not.toContain("#ef4444");
  });
  it("a locked 4th is the number in an outlined square with no fill", () => {
    const html = placed({ lockedUnitIds: ["d"] });
    const t = chip(html, "d");
    expect(t.tag).toContain("border:1.5px solid var(--color-bt-text-dim)");
    expect(t.tag).not.toContain("background");
    expect(t.tag).toContain('aria-label="4th place, locked"');
    expect(t.text).toBe("4");
  });
  it("CONTROL: an open place is the plain dim number: no ribbon, no outline", () => {
    const html = placed({ lockedUnitIds: [] });
    for (const id of ["a", "d"]) {
      expect(chip(html, id).tag.startsWith("<span")).toBe(true);
      expect(chip(html, id).tag).not.toContain("border");
      expect(chip(html, id).tag).toContain("color:var(--color-bt-text-dim)");
    }
    expect(html).not.toContain("<svg");
  });
  it("a locked shared 1st: both rows wear the same gold ribbon and no T", () => {
    const html = placed({ unitTotals: { a: 9, b: 9, c: 5, d: 3 }, lockedUnitIds: ["a", "b"] });
    expect(chip(html, "a").tag).toContain('data-medal="gold"');
    expect(chip(html, "b").tag).toContain('data-medal="gold"');
    expect(html).not.toContain(">T1<");
  });
  it("an open tie keeps T1 as plain dim text", () => {
    const html = placed({ unitTotals: { a: 9, b: 9, c: 5, d: 3 }, lockedUnitIds: [] });
    expect(chip(html, "a").text).toBe("T1");
    expect(chip(html, "b").text).toBe("T1");
  });
  it("two ribbons on one board do not share a gradient id", () => {
    const ids = [...placed({ lockedUnitIds: ["a", "b", "c"] }).matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
  it("no points yet keeps the dash, never a chip", () => {
    const html = render({ lockedUnitIds: ["green"], projections: { live: { green: 2 } } });
    expect(chip(html, "green").text).toBe("–");
    expect(chip(html, "green").tag).not.toContain("background:");
  });
  it("points are decimals (fmtPts), per the 2026-10-22 rule", () => {
    expect(render({ unitTotals: { blue: 18.5, red: 2 } })).toContain(">18.5<");
  });
});

describe("the full name (spec §2)", () => {
  const named = [{ id: "blue", label: "Eagles Cold Beers", shortName: "HE", color: "#3b82f6", hasResult: true }];
  it("the row reads the full name, unclipped, and the badge keeps the short one", () => {
    const html = render({ units: named, unitTotals: { blue: 6 }, projections: {} });
    expect(html).toContain(">Eagles Cold Beers<");
    expect(html).not.toContain("truncate");
    expect(html).toContain(">H<"); // the badge reads the short name's initial, not the full name's
  });
});

describe("the row's three columns (spec §2, v2.11)", () => {
  const named = [{ id: "blue", label: "Eagles Cold Beers", shortName: "HE", color: "#3b82f6", hasResult: true }];
  /** The markup between an element's opening tag and the end of the row. */
  const from = (html: string, testId: string) => html.slice(html.lastIndexOf("<", html.indexOf(`data-testid="${testId}"`)));
  const col = (html: string, id: string) => {
    const s = from(html, `standings-col-${id}`);
    return s.slice(0, s.indexOf(`data-testid="standings-row-`) === -1 ? s.length : s.indexOf(`data-testid="standings-row-`));
  };

  it("the rank is its own column, centred on the whole row, outside the name-and-bar column", () => {
    const html = render({ units: named, unitTotals: { blue: 6 }, projections: {} });
    const line = tag(html, "standings-line-blue");
    expect(line).toContain("items-center");
    const rank = html.indexOf('data-testid="standings-rank-blue"');
    expect(rank).toBeGreaterThan(html.indexOf('data-testid="standings-line-blue"'));
    expect(rank).toBeLessThan(html.indexOf('data-testid="standings-col-blue"'));
    expect(col(html, "blue")).not.toContain("standings-rank-blue");
  });
  it("badge, name, score and bar share the second column, so the bar starts at the badge's edge", () => {
    const c = col(render({ units: named, unitTotals: { blue: 6 }, projections: {} }), "blue");
    expect(c).toContain(">H<"); // the badge
    expect(c).toContain(">Eagles Cold Beers<");
    expect(c).toContain('data-testid="standings-points-blue"');
    expect(c).toContain('data-testid="standings-bar-blue"');
    expect(c).not.toContain("padding-left");
  });
  it("a person has no badge, so the bar starts at the name's edge, in the same column", () => {
    const html = render({ kind: "players", units: [{ id: "ann", label: "Ann", color: null, hasResult: true }], unitTotals: { ann: 3 }, projections: {} });
    const c = col(html, "ann");
    expect(c).toContain(">Ann<");
    expect(c).toContain('data-testid="standings-bar-ann"');
    expect(c).not.toContain("padding-left");
  });
});

describe("the leader's number", () => {
  const size = (html: string, id: string) => html.slice(html.lastIndexOf("<", html.indexOf(`data-testid="standings-points-${id}"`)), html.indexOf(`data-testid="standings-points-${id}"`));
  it("the leader alone reads larger", () => {
    const html = render();
    expect(size(html, "blue")).toContain("font-size:19px");
    expect(size(html, "red")).toContain("font-size:15px");
  });
  it("a shared 1st reads the same on both rows: neither leads", () => {
    const html = render({ unitTotals: { blue: 6, red: 6 } });
    expect(size(html, "blue")).toContain("font-size:19px");
    expect(size(html, "red")).toContain("font-size:19px");
  });
});
