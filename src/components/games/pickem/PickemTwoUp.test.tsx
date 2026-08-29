import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemTwoUp } from "./PickemTwoUp";

/**
 * The locked page's two buttons.
 *
 * Both subtitles are DERIVED, and each of them has a state that looks like an
 * ordinary number and is not one — which is what these cases are about.
 */

const render = (over: Partial<Parameters<typeof PickemTwoUp>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemTwoUp
      myPoints={34}
      myRank={3}
      sheetCount={16}
      resolved={11}
      total={16}
      canEdit={false}
      open={null}
      onOpen={() => {}}
      {...over}
    />
  );

describe("PickemTwoUp", () => {
  it("answers the question on the button rather than behind it", () => {
    const html = render();
    expect(html).toContain("34 pts · 3 of 16");
    expect(html).toContain("11 of 16 in");
  });

  it("says YOU DIDN’T PICK rather than 0 pts for somebody with no sheet", () => {
    /**
     * Zero-because-you-missed and zero-because-you-never-picked are the same
     * number and opposite facts. "0 pts · 16 of 16" reads as a bad weekend; it
     * would be describing a sheet that does not exist.
     */
    const html = render({ myPoints: null, myRank: null });
    expect(html).toContain("You didn’t pick");
    expect(html).not.toContain("0 pts");
    expect(html).not.toContain("of 16 ·");
  });

  it("asks the RUNNER for the results, in amber, while any are unmarked", () => {
    const html = render({ canEdit: true, resolved: 11, total: 16 });
    expect(html).toContain("Enter results");
    expect(html).toContain("5 to mark");
    expect(html).toContain("--color-bt-warning-faint");
  });

  it("stops asking once everything is marked", () => {
    /**
     * An amber "0 to mark" is a standing instruction to do nothing, which is
     * the shape this project keeps removing. With the slate complete the runner
     * is a reader like everyone else.
     *
     * The pair is the assertion — the runner-with-work case above is what makes
     * this one mean something.
     */
    const done = render({ canEdit: true, resolved: 16, total: 16 });
    expect(done).toContain("Game results");
    expect(done).not.toContain("Enter results");
    expect(done).toContain("16 of 16 in");
    expect(done).not.toContain("--color-bt-warning-faint");
  });

  it("never shows a MEMBER the runner's amber, however much is unmarked", () => {
    // The amber means "you are the one who has to do this". A member seeing it
    // would be told to perform an action they have no control for.
    const html = render({ canEdit: false, resolved: 0, total: 16 });
    expect(html).not.toContain("Enter results");
    expect(html).not.toContain("--color-bt-warning-faint");
    expect(html).toContain("0 of 16 in");
  });

  it("says it is a control, and says which way it opens", () => {
    /**
     * The first look read these as stat cards — reasonably, since a number
     * under a heading is what a stat card is. The fix is a chevron rather than
     * quieter numbers, because the numbers are the reason the row is worth its
     * space.
     *
     * DOWN when open, not a navigation arrow: these expand in place. Asserted
     * as the flip between two renders, since "has a chevron" is true of a
     * build that never changes it.
     */
    const closed = render({ open: null });
    expect(closed).toContain("lucide-chevron-right");
    expect(closed).not.toContain("lucide-chevron-down");

    const opened = render({ open: "picks" });
    expect(opened).toContain("lucide-chevron-down");
    // ...and only the open half flips; the other still offers to open.
    expect(opened).toContain("lucide-chevron-right");
  });

  it("marks the open half, so the panel below is attached to what opened it", () => {
    const html = render({ open: "results" });
    const at = html.indexOf('data-testid="pickem-two-up-results"');
    expect(html.slice(at, at + 120)).toContain('data-selected="true"');
    const other = html.indexOf('data-testid="pickem-two-up-picks"');
    expect(html.slice(other, other + 120)).toContain('data-selected="false"');
  });
});
