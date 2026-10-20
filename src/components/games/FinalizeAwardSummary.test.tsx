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
      <FinalizeAwardSummary award={placementAward([5, 3], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
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
      <FinalizeAwardSummary award={placementAward([5, 3, 1], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
    );
    const unawarded = html.slice(html.indexOf('data-testid="finalize-award-unawarded"')).replace(/<[^>]+>/g, "");
    expect(unawarded).toContain("Not awarded1 pt");
    expect(unawarded).toContain("3rd place: only 2 teams finished");
  });

  it("says 'no team finished' rather than 'only 0 teams'", () => {
    const html = renderToStaticMarkup(<FinalizeAwardSummary award={placementAward([5], [])} units={units} unitWord={teams} />);
    expect(html).toContain("1st place: no team finished");
    expect(html).not.toContain("only 0");
  });

  it("a race of people says 'nobody finished'", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary award={placementAward([5], [])} units={units} unitWord={{ one: "player", many: "players", none: "nobody" }} />
    );
    expect(html).toContain("1st place: nobody finished");
  });

  it("writes a half point as ½", () => {
    const html = renderToStaticMarkup(
      <FinalizeAwardSummary
        award={placementAward([3, 2], [{ unitId: "A", position: 1 }, { unitId: "B", position: 1 }])}
        units={units}
        unitWord={teams}
      />
    );
    expect(rowText(html, "finalize-award-row-A")).toBe("1stAlpha2½ pts");
  });
});
