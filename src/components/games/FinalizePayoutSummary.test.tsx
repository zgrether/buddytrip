import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinalizePayoutSummary } from "./FinalizePayoutSummary";
import { placementPayout } from "@/lib/finalizePayout";

/**
 * #1639 — the payout shown beside "Save results". Assertions read the rows'
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
  return html.slice(start, end).replace(/<[^>]+>/g, "");
}

describe("FinalizePayoutSummary", () => {
  it("lists each team's points in finishing order", () => {
    const html = renderToStaticMarkup(
      <FinalizePayoutSummary payout={placementPayout([5, 3], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
    );
    expect(rowText(html, "finalize-payout-row-A")).toBe("1stAlpha5 pts");
    expect(rowText(html, "finalize-payout-row-B")).toBe("2ndBravo3 pts");
    expect(html).not.toContain('data-testid="finalize-payout-unpaid"');
  });

  it("shows an unpaid place with its reason", () => {
    const html = renderToStaticMarkup(
      <FinalizePayoutSummary payout={placementPayout([5, 3, 1], [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }])} units={units} unitWord={teams} />
    );
    const unpaid = html.slice(html.indexOf('data-testid="finalize-payout-unpaid"')).replace(/<[^>]+>/g, "");
    expect(unpaid).toContain("Not paid1 pt");
    expect(unpaid).toContain("3rd place: only 2 teams finished");
  });

  it("says 'no team finished' rather than 'only 0 teams'", () => {
    const html = renderToStaticMarkup(<FinalizePayoutSummary payout={placementPayout([5], [])} units={units} unitWord={teams} />);
    expect(html).toContain("1st place: no team finished");
    expect(html).not.toContain("only 0");
  });

  it("a race of people says 'nobody finished'", () => {
    const html = renderToStaticMarkup(
      <FinalizePayoutSummary payout={placementPayout([5], [])} units={units} unitWord={{ one: "player", many: "players", none: "nobody" }} />
    );
    expect(html).toContain("1st place: nobody finished");
  });

  it("writes a half point as ½", () => {
    const html = renderToStaticMarkup(
      <FinalizePayoutSummary
        payout={placementPayout([3, 2], [{ unitId: "A", position: 1 }, { unitId: "B", position: 1 }])}
        units={units}
        unitWord={teams}
      />
    );
    expect(rowText(html, "finalize-payout-row-A")).toBe("1stAlpha2½ pts");
  });
});
