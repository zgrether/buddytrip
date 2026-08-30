import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PickemOtherPicks,
  PickemReadingHeader,
  sheetStateLine,
  type OtherPicksColumn,
  type OtherSheet,
} from "./PickemOtherPicks";

/**
 * Reading somebody else's sheet after the lock — the phase in which every sheet
 * is deliberately public, and which until now had nowhere to read them.
 */

const person = (over: Partial<OtherSheet> & { userId: string; name: string }): OtherSheet => ({
  picked: 16,
  total: 16,
  isGuest: false,
  points: 30,
  openable: true,
  ...over,
});

const COLUMNS: OtherPicksColumn[] = [
  {
    teamId: "t1",
    teamName: "Team Banks",
    people: [
      person({ userId: "u1", name: "Charlie", points: 53 }),
      person({ userId: "u2", name: "Bill", picked: 0, points: null, openable: false }),
      person({ userId: "u3", name: "Ann", picked: 3, points: 4 }),
    ],
  },
  {
    teamId: "t2",
    teamName: "Team Buddy",
    people: [person({ userId: "u4", name: "Rob", isGuest: true, picked: 0, points: null, openable: false })],
  },
];

const avatarFor = () => ({ avatarIcon: null, teamColor: null });

const render = (columns: OtherPicksColumn[] = COLUMNS) =>
  renderToStaticMarkup(
    <PickemOtherPicks columns={columns} avatarFor={avatarFor} onOpen={() => {}} />
  );

describe("sheetStateLine — the slot the team name used to hold", () => {
  it("says what happened, per state", () => {
    /**
     * Under a team heading, printing the team again on every row is the same
     * word four times. The slot now holds the only thing this screen cannot
     * show any other way: how far along somebody is.
     */
    expect(sheetStateLine(person({ userId: "a", name: "A", picked: 0, points: null }))).toBe(
      "Nothing submitted"
    );
    expect(
      sheetStateLine(person({ userId: "a", name: "A", picked: 3, total: 16, points: 4 }))
    ).toBe("3/16 picks submitted");
  });

  it("says NOTHING for a finished sheet", () => {
    /**
     * The absence is the design. "16/16 picks submitted" on every complete row
     * would bury the two rows that are not complete, which are the only ones
     * anybody is scanning for.
     */
    expect(sheetStateLine(person({ userId: "a", name: "A" }))).toBe(null);
  });

  it("says NOT A MEMBER on an EMPTY sheet, where the two answers differ", () => {
    /**
     * A placeholder cannot submit at all — no `auth.uid()`, so
     * `pickem_picks_write` can never match them. On an empty sheet that is not
     * "0 of 16 so far": it is why the process cannot start on its own, and it
     * is the difference between waiting for somebody and going and doing it for
     * them.
     *
     * With the branch reversed this reads "Nothing submitted", which is true
     * and useless — it sends somebody off to chase a person who structurally
     * cannot act.
     */
    expect(
      sheetStateLine(person({ userId: "a", name: "A", isGuest: true, picked: 0, points: null }))
    ).toBe("Not a member of BuddyTrip");
    // ...and the retired wording is gone.
    expect(
      sheetStateLine(person({ userId: "a", name: "A", isGuest: true, picked: 0, points: null }))
    ).not.toContain("signed up");
  });

  /**
   * ── r7 §8 · IT USED TO OUTRANK EVERY COUNT, AND THAT WAS THE BUG ─────────
   *
   * The label was returned for a guest whatever the count was, on the argument
   * that it is the PROVENANCE of the picks. The argument holds and the slot
   * still cannot carry it: this line is the one thing the screen says about
   * whether a row needs attention, so a guest with a COMPLETE sheet read as
   * unfinished business beside a member with an identical sheet that said
   * nothing at all.
   *
   * Both cases below passed under the old rule for the wrong reason — it never
   * reached the count — so they are the two that separate the builds.
   */
  it("says the COUNT for a guest who is part-way, not that they are a guest", () => {
    expect(
      sheetStateLine(
        person({ userId: "a", name: "A", isGuest: true, picked: 9, total: 16, points: null })
      )
    ).toBe("9/16 picks submitted");
  });

  it("says NOTHING for a guest whose sheet is FULL — same as anybody else", () => {
    /**
     * The reported case. Nobody has to do anything about this row, and a line
     * on it is a line the reader has to rule out.
     */
    expect(
      sheetStateLine(
        person({ userId: "a", name: "A", isGuest: true, picked: 16, total: 16, points: 40 })
      )
    ).toBe(null);
  });
});

describe("PickemOtherPicks", () => {
  it("groups by team, and keeps each team's ROSTER order", () => {
    /**
     * Not alphabetical and not by score. It is the order the team is written
     * down in everywhere else in the app, and a list that reorders itself as
     * results land is one nobody can learn.
     *
     * Asserted against a column whose roster order is neither: Charlie (53),
     * Bill (none), Ann (4) is not alphabetical, and it is not descending by
     * points either, so a build that sorted by either would fail.
     */
    const html = render();
    expect(html).toContain("Team Banks");
    expect(html).toContain("Team Buddy");
    const order = [...html.matchAll(/data-testid="pickem-other-picks-row"/g)].length;
    expect(order).toBe(4);
    expect(html.indexOf("Charlie")).toBeLessThan(html.indexOf("Bill"));
    expect(html.indexOf("Bill")).toBeLessThan(html.indexOf("Ann"));
  });

  it("wraps into columns on width rather than on a breakpoint", () => {
    // Two teams give two columns on a phone; four give four on a desktop, and
    // nothing in the component has to know which.
    expect(render()).toContain("repeat(auto-fit, minmax(150px, 1fr))");
  });

  it("gives a non-submitter a ROW, not an omission", () => {
    /**
     * Rendering only the sheets would show three rows where there are four
     * people, and nothing on screen could tell a short field from a dropped
     * one.
     */
    const html = render();
    expect(html).toContain("Bill");
    expect(html).toContain("Nothing submitted");
  });

  it("does not open a sheet that does not exist", () => {
    /**
     * The row is a statement, not a door.
     *
     * Asserted on the DISABLED attribute rather than a class, because Tailwind
     * renders `disabled:` variants into the markup whether or not they apply —
     * a `not.toContain("disabled")` would fail against correct output.
     *
     * Sliced per row, so it says WHICH rows are shut: the two with no sheet.
     */
    const rows = render()
      .split("<button")
      .filter((r) => r.includes('data-testid="pickem-other-picks-row"'));
    expect(rows).toHaveLength(4);
    const shut = rows.filter((r) => r.includes('disabled=""'));
    expect(shut).toHaveLength(2);
    expect(shut.some((r) => r.includes("Bill"))).toBe(true);
    expect(shut.some((r) => r.includes("Rob"))).toBe(true);
  });

  it("shows a PARTIAL sheet's progress and still opens it", () => {
    // Partial is a real, readable sheet — it has rows — so it is a door as well
    // as a statement. The pair with the case above is what makes "openable"
    // mean "has a sheet" rather than "is finished".
    const rows = render()
      .split("<button")
      .filter((r) => r.includes('data-testid="pickem-other-picks-row"'));
    const ann = rows.find((r) => r.includes("Ann"))!;
    expect(ann).toContain("3/16 picks submitted");
    expect(ann).not.toContain('disabled=""');
  });

  it("says nobody else is here rather than rendering empty columns", () => {
    const html = render([{ teamId: "t1", teamName: "Team Banks", people: [] }]);
    expect(html).toContain("Nobody else yet");
    expect(html).not.toContain('data-testid="pickem-other-picks-row"');
    // ...and it does not print a heading over nothing.
    expect(html).not.toContain("Team Banks");
  });
});

describe("PickemReadingHeader", () => {
  it("is a TITLE, not the proxy warning band", () => {
    /**
     * The first build reused `PickemProxyBanner`, which put "You're entering
     * Charlie's sheet · saving replaces it" over a surface that cannot be
     * entered or saved. Every clause was false and it was the loudest thing on
     * the page.
     *
     * Asserted as the absence of the WRITE language rather than of that
     * component, because the defect is the claim: any header that turns up here
     * promising a save is the same bug whatever renders it.
     */
    const html = renderToStaticMarkup(
      <PickemReadingHeader name="Charlie" onBack={() => {}} />
    );
    expect(html).toContain("Charlie");
    expect(html).toContain("picks");
    expect(html).not.toContain("entering");
    expect(html).not.toContain("saving");
    expect(html).not.toContain("replaces");
  });
});
