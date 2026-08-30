import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheetsList } from "./PickemSheetsList";
import type { ProxyTarget } from "./PickemProxyPanel";

/**
 * Screen I — the sheets list.
 *
 * The two rules that must survive any redesign of this surface are that the
 * LIST IS THE PERMISSION and that a GUEST READS DIFFERENTLY, so those are the
 * two things asserted hardest.
 */

const t = (over: Partial<ProxyTarget> & { userId: string }): ProxyTarget => ({
  name: over.userId.toUpperCase(),
  submitted: false,
  isGuest: false,
  side: null,
  ...over,
});

const AVATARS = () => ({ avatarIcon: null, teamColor: null });

const render = (over: Partial<Parameters<typeof PickemSheetsList>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemSheetsList
      targets={[
        t({ userId: "a", name: "Ann", submitted: true, side: "Cubs" }),
        t({ userId: "b", name: "Bo", side: "Aces" }),
        t({ userId: "c", name: "Cy", isGuest: true, side: "Aces" }),
      ]}
      runner
      scopeName="Aces"
      avatarFor={AVATARS}
      onPick={() => {}}
      {...over}
    />
  );

describe("the list is the permission", () => {
  it("renders exactly what it was given, and filters nothing", () => {
    /**
     * `pickem_sheet_status` already returned only the people this caller may
     * act for. Anything this component decided to hide or show would be a
     * SECOND copy of `_pickem_can_proxy_for`, and two copies drift.
     *
     * So the assertion is a count: three in, three out, whoever they are.
     */
    const html = render();
    expect(html.split('data-testid="pickem-proxy-target-').length - 1).toBe(3);
    for (const name of ["Ann", "Bo", "Cy"]) expect(html, name).toContain(name);
  });

  it("changes only the TITLE between a runner and a captain, never the rows", () => {
    /**
     * The one thing `canEdit` decides on this screen is what to call the list.
     * If it ever started deciding CONTENTS, that would be the client-side role
     * check the rule forbids — so the rows are asserted identical across both.
     */
    const asRunner = render({ runner: true });
    const asCaptain = render({ runner: false });

    /**
     * The TITLE is gone with the page — this is a sub-tab now, and a heading
     * under a tab of the same name is the duplicate-heading bug this feature
     * keeps producing. What `runner` still decides is the SCOPE line, which is
     * the same distinction in the place that had no other job.
     */
    expect(asRunner).not.toContain("Everyone’s sheets");
    expect(asCaptain).not.toContain("Your team’s sheets");
    expect(asRunner).toContain("Everyone but you");
    expect(asCaptain).toContain("Aces · your");

    const rows = (html: string) =>
      [...html.matchAll(/data-testid="pickem-proxy-target-([a-z]+)"/g)].map((m) => m[1]);
    expect(rows(asRunner)).toEqual(rows(asCaptain));
    expect(rows(asRunner)).toHaveLength(3);
  });

  it("scopes the line to the viewer's team for a captain", () => {
    expect(render({ runner: true })).toContain("Everyone but you · 3 sheets");
    expect(render({ runner: false })).toContain("Aces · your 3 teammates");
  });

  it("falls back to the neutral scope when the viewer has no team", () => {
    // A captain-shaped viewer with no roster row would otherwise read
    // "null · your 3 teammates".
    const html = render({ runner: false, scopeName: null });
    expect(html).toContain("Everyone but you");
    expect(html).not.toContain("null");
  });
});

describe("a guest reads differently, and structurally must", () => {
  it("says HASN'T SIGNED UP for a guest and NO SHEET YET for everyone else", () => {
    /**
     * A guest has no `auth.uid()`, so `pickem_picks_write` can never match them
     * — they can never enter their own sheet. "Nothing submitted" implies they might
     * yet do it and sends somebody off to chase a person who cannot act.
     */
    const html = render();
    expect(html).toContain("Hasn’t signed up");
    expect(html).toContain("Nothing submitted");
  });

  it("puts the guest first, where the chasing starts", () => {
    /**
     * Asserted on the row ids, not on where the names appear in the markup: an
     * inline chevron's `viewBox` attribute contains the substring "Bo", so a
     * name's index is a position in the HTML rather than a position in the
     * list. Caught by this test failing against a correctly ordered render.
     */
    const rows = [...render().matchAll(/data-testid="pickem-proxy-target-([a-z]+)"/g)].map(
      (m) => m[1]
    );
    expect(rows).toEqual(["c", "b", "a"]);
  });
});

describe("it is a sub-tab, not a page", () => {
  it("carries no title, no back chevron and no way to open itself", () => {
    /**
     * It was its own screen, reached from a Sheets button above the sheet, with
     * a chevron and a heading. That made two routes to somebody else's picks on
     * one game — this before the lock, "Other picks" after — which is two names
     * for one job.
     *
     * All three go together, and the assertion covers all three, because
     * removing any one of them alone leaves the surface half a page.
     */
    const html = render();
    expect(html).not.toContain('data-testid="pickem-sheets-back"');
    expect(html).not.toContain('data-testid="pickem-sheets-open"');
    // The TITLES, both of them — asserted as the strings rather than as a
    // markup shape. The first version of this line looked for "sheets</span>"
    // and failed against a correct render, because the scope line legitimately
    // ends "· 3 sheets" inside a span. A shape assertion here cannot tell a
    // heading from a count; the words can.
    expect(html).not.toContain("Everyone’s sheets");
    expect(html).not.toContain("Your team’s sheets");
    // ...and the rows are still all there, so this is not passing on an empty
    // render.
    expect(
      [...html.matchAll(/data-testid="pickem-proxy-target-([a-z]+)"/g)]
    ).toHaveLength(3);
  });
});

describe("what the scope line says", () => {
  it("counts who is MISSING, not how many people there are", () => {
    // Carried from the panel this replaced: the number a captain acts on is
    // how many are still to come.
    expect(render()).toContain("2 still to come");
  });

  it("says everyone is in rather than showing a zero", () => {
    const html = render({
      targets: [t({ userId: "a", name: "Ann", submitted: true })],
    });
    expect(html).toContain("Everyone’s in");
    expect(html).not.toContain("0 still to come");
  });

  it("shows each person's side, and omits the line when they have none", () => {
    const html = render({
      targets: [t({ userId: "a", name: "Ann", side: "Cubs" }), t({ userId: "b", name: "Bo" })],
    });
    expect(html).toContain("Cubs");
    expect(html).not.toContain(">null<");
  });
});

/**
 * DELETED: the `PickemSheetsButton` cases.
 *
 * The button was the way into this list when the list was a page. There is no
 * page, so there is no way in to test — the sub-tab bar is the control, and the
 * one rule the button carried (render only when the server has given the viewer
 * somebody to act for, decided on the ROW COUNT and never on a role) moved to
 * that bar with it.
 */
