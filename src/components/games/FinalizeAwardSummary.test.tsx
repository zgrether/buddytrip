import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinalizeAwardSummary } from "./FinalizeAwardSummary";
import { placementAward } from "@/lib/finalizeAward";

/**
 * #1639 — the award shown beside "Save results". Assertions read the rows'
 * own test ids, not the whole markup: a bare "5" or "pts" would be matched by
 * a place number or another row (CLAUDE.md, the substring corollary).
 */

const units = new Map([
  ["A", { name: "Alpha", color: "#f00" }],
  ["B", { name: "Bravo", color: "#00f" }],
]);
const teams = { one: "team", many: "teams", none: "no team" };
const T = "team" as const;

function rowText(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, `${testId} rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<div", at);
  const end = html.indexOf("</div>", at);
  // The badge's own letter is not row text; its presence is asserted separately.
  const row = html.slice(start, end);
  const badge = '<span role="img"';
  const b = row.indexOf(badge);
  const withoutBadge = b < 0 ? row : row.slice(0, b) + row.slice(row.indexOf("</span>", b) + 7);
  return withoutBadge.replace(/<[^>]+>/g, "");
}
/** The row's slice, badge included — for asserting the badge itself. */
function rowHtml(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  return html.slice(html.lastIndexOf("<div", at), html.indexOf("</div>", at));
}

describe("FinalizeAwardSummary", () => {
  it("lists each team's points in finishing order", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary kind={T} award={placementAward([5, 3], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
    );
    expect(rowText(html, "finalize-award-row-A")).toBe("1stAlpha5 pts");
    expect(rowText(html, "finalize-award-row-B")).toBe("2ndBravo3 pts");
    // Each team row carries its badge (a square, never the old circle).
    expect(rowHtml(html, "finalize-award-row-A")).toContain('data-testid="team-badge"');
    expect(rowHtml(html, "finalize-award-row-A")).not.toContain("border-radius:50%");
    expect(html).not.toContain('data-testid="finalize-award-unawarded"');
  });

  it("shows an unawarded place with its reason", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary kind={T} award={placementAward([5, 3, 1], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
    );
    const unawarded = html.slice(html.indexOf('data-testid="finalize-award-unawarded"')).replace(/<[^>]+>/g, "");
    expect(unawarded).toContain("Not awarded1 pt");
    expect(unawarded).toContain("3rd place: only 2 teams finished");
  });

  it("says 'no team finished' rather than 'only 0 teams'", () => {
    const html = renderToStaticMarkup(<FinalizeAwardSummary kind={T} award={placementAward([5], [])} units={units} unitWord={teams} />);
    expect(html).toContain("1st place: no team finished");
    expect(html).not.toContain("only 0");
  });

  it("a race of people says 'nobody finished'", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary kind={T} award={placementAward([5], [])} units={units} unitWord={{ one: "player", many: "players", none: "nobody" }} />
    );
    expect(html).toContain("1st place: nobody finished");
  });

  it("writes a half point as ½", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary
        kind={T}
        award={placementAward([3, 2], [{ unitId: "A", position: 1 }, { unitId: "B", position: 1 }])}
        units={units}
        unitWord={teams}
      />
    );
    expect(rowText(html, "finalize-award-row-A")).toBe("1stAlpha2½ pts");
  });

  it("a race of people lists only the places that win points: no 0-point rows, no marks", () => {
    const people = new Map([["ann", { name: "Ann" }], ["bob", { name: "Bob" }], ["cat", { name: "Cat" }]]);
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary
        kind="person"
        award={placementAward([5, 3], [{ unitId: "ann", position: 1 }, { unitId: "bob", position: 2 }, { unitId: "cat", position: 3 }])}
        units={people}
        unitWord={{ one: "player", many: "players", none: "nobody" }}
      />
    );
    expect(html).toContain('data-testid="finalize-award-row-ann"');
    expect(html).toContain('data-testid="finalize-award-row-bob"');
    expect(html).not.toContain('data-testid="finalize-award-row-cat"');
    expect(html).not.toContain('data-testid="team-badge"');
  });

  it("CONTROL: teams keep every place and their mark", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary kind="team" award={placementAward([5, 3], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
    );
    expect(html).toContain('data-testid="team-badge"');
  });

  describe("only the unawarded places (a format whose header shows projected points)", () => {
    // Three places on offer, two teams: the 3rd can never be filled.
    const short = placementAward([5, 3, 1], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }]);

    it("shows the unfillable place and no team rows", () => {
      const html = renderToStaticMarkup(<FinalizeAwardSummary kind={T} award={short} units={units} unitWord={teams} only="unawarded" />);
      const unawarded = html.slice(html.indexOf('data-testid="finalize-award-unawarded"')).replace(/<[^>]+>/g, "");
      expect(unawarded).toContain("3rd place: only 2 teams finished");
      expect(html).not.toContain('data-testid="finalize-award-row-A"');
      expect(html).not.toContain('data-testid="finalize-award-row-B"');
      // No "Points" heading over an empty list: the header already says it.
      expect(html.replace(/<[^>]+>/g, "|")).not.toContain("|Points|");
    });

    it("renders nothing when every place can be filled", () => {
      const full = placementAward([5, 3], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }]);
      expect(renderToStaticMarkup(<FinalizeAwardSummary kind={T} award={full} units={units} unitWord={teams} only="unawarded" />)).toBe("");
    });

    it("CONTROL: without the mode, the same award lists the rows under its heading", () => {
      const html = renderToStaticMarkup(<FinalizeAwardSummary kind={T} award={short} units={units} unitWord={teams} />);
      expect(html).toContain('data-testid="finalize-award-row-A"');
      expect(html.replace(/<[^>]+>/g, "|")).toContain("|Points|");
    });
  });
});
