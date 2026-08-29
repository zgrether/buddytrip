import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PickemOtherPicks,
  PickemReadingHeader,
  sortOtherSheets,
  type OtherSheet,
} from "./PickemOtherPicks";

/**
 * Reading somebody else's sheet after the lock — the phase in which every sheet
 * is deliberately public, and which until now had nowhere to read them.
 */

const FIELD: OtherSheet[] = [
  { userId: "u1", name: "Charlie", team: "Team Banks", points: 53 },
  { userId: "u2", name: "Bill", team: "Team Banks", points: null },
  { userId: "u3", name: "Jeremy", team: "Team Buddy", points: 6 },
];

const avatarFor = () => ({ avatarIcon: null, teamColor: null });

const render = (sheets: OtherSheet[] = sortOtherSheets(FIELD)) =>
  renderToStaticMarkup(
    <PickemOtherPicks sheets={sheets} avatarFor={avatarFor} onOpen={() => {}} />
  );

describe("sortOtherSheets", () => {
  it("ranks by points, and sinks the people with no sheet BELOW the low scores", () => {
    /**
     * The decisive case, and the reason a plain numeric sort will not do:
     * treating a missing sheet as 0 would file Bill next to Jeremy's 6 as
     * though they had comparable weekends. One of them picked badly; the other
     * did not pick. Same region of the list, opposite facts.
     */
    expect(sortOtherSheets(FIELD).map((s) => s.name)).toEqual(["Charlie", "Jeremy", "Bill"]);
  });

  it("breaks a tie by name rather than by input order", () => {
    // Two identical sheets have no ranking between them, so the list must at
    // least be STABLE across renders — input order is not.
    const tied: OtherSheet[] = [
      { userId: "b", name: "Ty", team: null, points: 20 },
      { userId: "a", name: "Ali", team: null, points: 20 },
    ];
    expect(sortOtherSheets(tied).map((s) => s.name)).toEqual(["Ali", "Ty"]);
    expect(sortOtherSheets([...tied].reverse()).map((s) => s.name)).toEqual(["Ali", "Ty"]);
  });

  it("does not mutate what it is given", () => {
    const input = [...FIELD];
    sortOtherSheets(input);
    expect(input.map((s) => s.name)).toEqual(["Charlie", "Bill", "Jeremy"]);
  });
});

describe("PickemOtherPicks", () => {
  it("gives a non-submitter a ROW, not an omission", () => {
    /**
     * Rendering only the sheets would show two rows where there are three
     * people, and nothing on screen could tell a short field from a dropped
     * one. Bill is the whole reason this list is built from the field rather
     * than from the sheets.
     */
    const html = render();
    expect(html).toContain("Bill");
    expect(html).toContain("Didn’t pick");
    expect((html.match(/data-testid="pickem-other-picks-row"/g) ?? []).length).toBe(3);
  });

  it("does not open a sheet that does not exist", () => {
    /**
     * The row is a statement, not a door.
     *
     * Asserted on the DISABLED attribute rather than on a class, because
     * Tailwind renders `disabled:` variants into the markup whether or not they
     * apply — a `not.toContain("disabled")` here would fail against correct
     * output and pass against nothing.
     *
     * Sliced PER ROW, so it says which row is shut rather than that something
     * somewhere on the page is. The pair is the assertion: exactly one row is
     * closed, and the ones that are not carry a total.
     */
    const rows = render()
      .split("<button")
      .filter((r) => r.includes('data-testid="pickem-other-picks-row"'));
    expect(rows.length).toBe(3);
    const shut = rows.filter((r) => r.includes('disabled=""'));
    expect(shut.length).toBe(1);
    expect(shut[0]).toContain("Bill");
    expect(shut[0]).toContain("Didn’t pick");
    for (const open of rows.filter((r) => !r.includes('disabled=""'))) {
      expect(open).toContain("pts");
      expect(open).not.toContain("Didn’t pick");
    }
  });

  it("says nobody else is here rather than rendering an empty list", () => {
    const html = render([]);
    expect(html).toContain("Nobody else yet");
    expect(html).not.toContain('data-testid="pickem-other-picks-row"');
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
