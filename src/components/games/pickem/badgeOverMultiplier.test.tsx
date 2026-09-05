import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheetRow } from "./PickemSheetRow";

/**
 * The NOT PICKED stamp OVERLAPS the multiplier chip — it does not push it.
 *
 * ── Why this is a structural assertion and not a positional one ───────────
 *
 * The defect is positional: the stamp used to be a flow sibling of the matchup,
 * so on a row that was both weighted AND unpicked it took its own width, the
 * matchup's box shrank, and the multiplier — pinned to the RIGHT of that box —
 * slid left. The one badge whose entire job is to sit in the same place on
 * every row moved, and only on the rows carrying a second badge.
 *
 * This suite is `environment: "node"` with no DOM, so "same x position" is not
 * measurable here. What IS assertable is the mechanism that guarantees it: the
 * stamp is absolutely positioned and lives OUTSIDE the matchup's flow, so it
 * cannot take width from it. A build that keeps the badge in flow fails both
 * assertions below.
 *
 * The positions were measured in a browser at 390px when this landed —
 * multiplier left edge 337.9px and right edge 366px, identical with and without
 * the stamp, and the chip fully inside the stamp's box (both 18.5px tall). That
 * measurement is what this structure is standing in for; it is recorded here
 * because the test cannot repeat it.
 *
 * NOTE the assertion the spec warned against: "both elements exist" passes
 * against the bug. Presence was never in question — placement was.
 */

const WEIGHTED = {
  id: "g12",
  awayTeam: "Western Michigan Broncos",
  homeTeam: "Michigan Wolverines",
  spread: "-26.5",
  multiplier: 2,
  kickoff: "Sat Sep 5, 7:30p",
  note: null,
};

const render = (over: Partial<Parameters<typeof PickemSheetRow>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemSheetRow
      game={WEIGHTED}
      pick={null}
      points={null}
      editable={false}
      onPick={() => {}}
      {...over}
    />
  );

function tag(markup: string, testId: string): string {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

/** The `pickem-card-content` element's inner HTML — the matchup's own flow. */
function contentSubtree(markup: string): string {
  const at = markup.indexOf('data-testid="pickem-card-content"');
  if (at === -1) return "";
  const start = markup.indexOf(">", at) + 1;
  // The content div is followed by the badge slot or the body; slicing to the
  // next absolutely-positioned slot is enough to bound it for this assertion.
  return markup.slice(start, markup.indexOf('data-testid="pickem-card-badge"', start) + 1 || undefined);
}

describe("NOT PICKED over the multiplier", () => {
  const withBadge = render({ outcome: "unpicked" });

  it("takes the stamp OUT of the matchup's flow", () => {
    /**
     * THE MUTATION: render `{badge}` as a flex sibling of the content again.
     *
     * Asserting only that both the stamp and the chip are present passes
     * against that build — which is exactly what shipped and was reported. The
     * stamp being ABSOLUTE is what stops it taking width.
     */
    expect(tag(withBadge, "pickem-card-badge")).toContain("absolute");
    expect(withBadge).toContain('data-testid="pickem-row-not-picked"');
  });

  it("keeps the stamp outside the element the matchup lays out in", () => {
    /**
     * The other half: absolute positioning only helps if the element is not
     * ALSO inside the content box being measured. A build that made it absolute
     * but left it nested would still be correct today and would break the
     * moment the content box gained `overflow: hidden`.
     */
    expect(contentSubtree(withBadge)).not.toContain("pickem-row-not-picked");
  });

  it("makes the stamp OPAQUE, because it now covers rather than displaces", () => {
    /**
     * A transparent stamp over a chip shows both at once, which is worse than
     * the displacement it replaced — two badges printed through each other. The
     * fill is what turns an overlap into an occlusion.
     */
    expect(tag(withBadge, "pickem-row-not-picked")).toContain("background:var(--color-bt-card)");
  });

  it("leaves the multiplier's own slot pinned in both cases", () => {
    /**
     * The chip's position must not depend on whether the stamp is there. Its
     * slot carries `right:0` either way — the stamp cannot move it because it
     * is no longer in the same flow.
     */
    const noBadge = render({ pick: "away", outcome: "won" });
    for (const [label, markup] of [["with stamp", withBadge], ["without", noBadge]] as const) {
      const slot = tag(markup, "pickem-matchup-multiplier-slot");
      expect(slot, label).toContain("right:0");
      expect(slot, label).toContain("absolute");
    }
  });

  it("does not stamp a row that WAS picked", () => {
    // The guard against making the badge unconditional, which every assertion
    // above tolerates.
    expect(render({ pick: "away", outcome: "won" })).not.toContain("pickem-row-not-picked");
  });
});
