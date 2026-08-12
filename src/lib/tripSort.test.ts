import { describe, it, expect } from "vitest";
import { compareActive, comparePast, compareIdea, type SortableTrip } from "./tripSort";

/**
 * These comparators exist to stop two surfaces ordering one list two ways, so
 * the tests are written against the ORDER a list comes out in, not against the
 * sign of a single comparison — a comparator can be self-consistent and still
 * produce the wrong list.
 */

const t = (title: string, extra: Partial<SortableTrip> = {}): SortableTrip => ({ title, ...extra });

const titles = (rows: SortableTrip[], cmp: (a: SortableTrip, b: SortableTrip) => number) =>
  [...rows].sort(cmp).map((r) => r.title);

describe("compareActive", () => {
  it("puts the soonest date first", () => {
    const rows = [
      t("October", { start_date: "2026-10-01" }),
      t("June", { start_date: "2026-06-01" }),
      t("August", { start_date: "2026-08-15" }),
    ];
    expect(titles(rows, compareActive)).toEqual(["June", "August", "October"]);
  });

  it("puts dates-TBD last, alphabetically among themselves", () => {
    const rows = [
      t("Zeta TBD"),
      t("Dated", { start_date: "2026-09-01" }),
      t("alpha TBD"),
      t("Mid TBD"),
    ];
    expect(titles(rows, compareActive)).toEqual(["Dated", "alpha TBD", "Mid TBD", "Zeta TBD"]);
  });

  it("treats an end-date-only trip as DATED, not TBD", () => {
    // "Dates TBD" is what the row renders when it has NEITHER date, so a trip
    // with only an end date must not fall into the TBD bucket — the split here
    // and the label on the row have to mean the same thing.
    const rows = [t("No dates"), t("End only", { end_date: "2026-07-04" })];
    expect(titles(rows, compareActive)).toEqual(["End only", "No dates"]);
  });

  it("breaks equal dates by title, so the order is deterministic", () => {
    const rows = [
      t("Whistler", { start_date: "2026-06-01" }),
      t("Bandon", { start_date: "2026-06-01" }),
    ];
    expect(titles(rows, compareActive)).toEqual(["Bandon", "Whistler"]);
  });
});

describe("comparePast", () => {
  it("puts the most recent first", () => {
    const rows = [
      t("Two years ago", { end_date: "2024-05-01" }),
      t("Last month", { end_date: "2026-07-10" }),
      t("Last year", { end_date: "2025-09-20" }),
    ];
    expect(titles(rows, comparePast)).toEqual(["Last month", "Last year", "Two years ago"]);
  });

  it("orders by END date, not start", () => {
    const rows = [
      t("Started first, ended first", { start_date: "2026-01-01", end_date: "2026-01-05" }),
      t("Started second, ended last", { start_date: "2026-01-02", end_date: "2026-03-01" }),
    ];
    expect(titles(rows, comparePast)[0]).toBe("Started second, ended last");
  });
});

describe("compareIdea", () => {
  it("puts the most recently touched first, falling back to created_at", () => {
    const rows = [
      t("Stale", { updated_at: "2026-01-01T00:00:00Z" }),
      t("Fresh", { updated_at: "2026-08-01T00:00:00Z" }),
      t("Never updated", { created_at: "2026-05-01T00:00:00Z" }),
    ];
    expect(titles(rows, compareIdea)).toEqual(["Fresh", "Never updated", "Stale"]);
  });
});

describe("the two surfaces cannot diverge", () => {
  it("orders a merged Active set the same as the dashboard's two halves concatenated", () => {
    // The rail merges `now` + `upcoming` into one section; the dashboard keeps
    // them apart and renders `now` above `upcoming`. Since `now` is by
    // definition the set whose start dates have arrived, sorting the merged set
    // must reproduce the concatenation — this is the property that lets ONE
    // comparator serve both sectionings.
    const now = [
      t("In progress B", { start_date: "2026-08-10" }),
      t("In progress A", { start_date: "2026-08-09" }),
    ];
    const upcoming = [
      t("Later", { start_date: "2026-12-01" }),
      t("Sooner", { start_date: "2026-09-01" }),
    ];
    const dashboard = [...now.sort(compareActive), ...upcoming.sort(compareActive)].map((r) => r.title);
    const rail = titles([...now, ...upcoming], compareActive);
    expect(rail).toEqual(dashboard);
  });
});
