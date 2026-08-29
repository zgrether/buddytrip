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
      resolved={11}
      total={16}
      matchesLabel="7 matches"
      canEdit={false}
      open="matches"
      onOpen={() => {}}
      {...over}
    />
  );

describe("PickemTwoUp", () => {
  it("answers the question on the button rather than behind it", () => {
    const html = render();
    expect(html).toContain("34 pts");
    expect(html).toContain("11 of 16 in");
  });

  it("carries a TOTAL and not a rank, on a page whose other tabs count games", () => {
    /**
     * This read "34 pts · 3 of 16" — a total, then the reader's place among
     * sixteen SHEETS. Both tabs beside it count GAMES ("7 matches",
     * "11 of 16 in"), so "3 of 16" in that row reads as three games of sixteen,
     * and ten characters have no room to say otherwise.
     *
     * Asserted on the JOIN rather than on the numbers. Any second figure
     * appended to the total inherits the same misreading whatever it holds, and
     * the separator is the thing that appends it — so "pts ·" is the shape,
     * and it is a string the correct render cannot produce.
     *
     * NOT a regex. The first version of this line was written through a shell
     * heredoc, which ate a backslash per escape and left `/d+ pts · d+ of d+/`
     * — a pattern matching a literal "d+" that no render can contain, so it
     * passed against the OLD string too. Green, and blind. Backslash-free is
     * the fix that survives the transport (memory: backslashes die in transit).
     */
    expect(render()).not.toContain("pts ·");
  });

  it("says YOU DIDN’T PICK rather than 0 pts for somebody with no sheet", () => {
    /**
     * Zero-because-you-missed and zero-because-you-never-picked are the same
     * number and opposite facts. "0 pts · 16 of 16" reads as a bad weekend; it
     * would be describing a sheet that does not exist.
     */
    const html = render({ myPoints: null });
    expect(html).toContain("You didn’t pick");
    expect(html).not.toContain("0 pts");
    expect(html).not.toContain("of 16 ·");
  });

  it("asks the RUNNER for the results, in amber, while any are unmarked", () => {
    const html = render({ canEdit: true, resolved: 11, total: 16 });
    expect(html).toContain("Enter results");
    expect(html).toContain("5 still to play");
    // Amber TEXT, not a fill: a tab bar has one raised surface (the selected
    // tab) and a second tinted one would read as two selections.
    expect(html).toContain("--color-bt-owner");
  });

  it("stops asking once everything is marked", () => {
    /**
     * An amber "0 still to play" is a standing instruction to do nothing, which is
     * the shape this project keeps removing. With the slate complete the runner
     * is a reader like everyone else.
     *
     * The pair is the assertion — the runner-with-work case above is what makes
     * this one mean something.
     */
    const done = render({ canEdit: true, resolved: 16, total: 16 });
    expect(done).toContain("Results");
    expect(done).not.toContain("Enter results");
    expect(done).toContain("16 of 16 in");
    expect(done).not.toContain("--color-bt-owner");
  });

  it("never shows a MEMBER the runner's amber, however much is unmarked", () => {
    // The amber means "you are the one who has to do this". A member seeing it
    // would be told to perform an action they have no control for.
    const html = render({ canEdit: false, resolved: 0, total: 16 });
    expect(html).not.toContain("Enter results");
    expect(html).not.toContain("--color-bt-owner");
    expect(html).toContain("0 of 16 in");
  });

  it("is a TAB BAR — three tabs, one always selected, no chevrons", () => {
    /**
     * This replaced a pair of disclosure buttons that expanded drawers over an
     * always-rendered matches list. Two navigation models on one screen, and
     * the thing most people came to see had no control of its own.
     *
     * A tab bar SELECTS rather than discloses, so the chevrons went with the
     * drawers — and there is no closed state for the page to be in.
     */
    const html = render();
    for (const t of ["matches", "picks", "results"]) {
      expect(html, t).toContain(`data-testid="pickem-two-up-${t}"`);
    }
    expect(html).not.toContain("lucide-chevron");
    expect(html).toContain('role="tablist"');
    // Exactly one selected, always.
    expect(html.split('aria-selected="true"').length - 1).toBe(1);
  });

  it("puts MATCHES first and selects it by default", () => {
    // It is what most people opened the game to see, and it used to be the one
    // destination with no control at all.
    const html = render();
    expect(html.indexOf("pickem-two-up-matches")).toBeLessThan(
      html.indexOf("pickem-two-up-picks")
    );
    const at = html.indexOf('data-testid="pickem-two-up-matches"');
    expect(html.slice(at, at + 120)).toContain('data-selected="true"');
    expect(html).toContain("7 matches");
  });

  it("marks the selected tab, and only it", () => {
    const html = render({ open: "results" });
    const at = html.indexOf('data-testid="pickem-two-up-results"');
    expect(html.slice(at, at + 140)).toContain('data-selected="true"');
    for (const other of ["matches", "picks"]) {
      const i = html.indexOf(`data-testid="pickem-two-up-${other}"`);
      expect(html.slice(i, i + 140), other).toContain('data-selected="false"');
    }
  });
});
