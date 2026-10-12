import { describe, it, expect } from "vitest";
import { railKeyMarks } from "./ContextRail";

/**
 * The rail key explains the marks ON SCREEN, so its input is the rendered rows.
 *
 * The bug this pins: the key was three hardcoded entries, so a plain Member with
 * no cups read "Owner · Organizer · Cup" — a legend for three marks, none of
 * which any row painted.
 *
 * ── Why the assertions are exact arrays, not `.toContain` ───────────────────
 * The defect was EXTRA entries, not missing ones. A `toContain("Owner")` check
 * passes against the old hardcoded key, which always contained everything —
 * it would have been decorative. Asserting the whole array is what makes the
 * over-full key inexpressible.
 */

describe("railKeyMarks", () => {
  it("a plain member with no cups gets NO key at all", () => {
    const { roles, cup } = railKeyMarks([
      { myRole: "Member", hasCompetition: false },
      { myRole: "Member", hasCompetition: null },
    ]);
    // The whole key row is dropped on this — the reported case.
    expect(roles).toEqual([]);
    expect(cup).toBe(false);
  });

  it("names ONLY the role actually held on some row", () => {
    expect(railKeyMarks([{ myRole: "Owner" }, { myRole: "Member" }]).roles).toEqual(["Owner"]);
    expect(railKeyMarks([{ myRole: "Organizer" }, { myRole: "Member" }]).roles).toEqual([
      "Organizer",
    ]);
  });

  it("names both when both are held across DIFFERENT trips", () => {
    // The multi-trip case that rules out deriving from a single viewer role.
    expect(
      railKeyMarks([{ myRole: "Owner" }, { myRole: "Organizer" }, { myRole: "Member" }]).roles
    ).toEqual(["Owner", "Organizer"]);
  });

  it("orders Owner before Organizer regardless of row order", () => {
    // Fixed order, so the key doesn't reshuffle as trips are added or re-sorted.
    expect(railKeyMarks([{ myRole: "Organizer" }, { myRole: "Owner" }]).roles).toEqual([
      "Owner",
      "Organizer",
    ]);
  });

  it("the cup mark is independent of any role", () => {
    // A member of a trip that has a cup: cup explained, no role edge to explain.
    const { roles, cup } = railKeyMarks([{ myRole: "Member", hasCompetition: true }]);
    expect(roles).toEqual([]);
    expect(cup).toBe(true);
  });

  it("cup is true only on an explicit true — null/undefined are not a cup", () => {
    expect(railKeyMarks([{ hasCompetition: null }, { hasCompetition: undefined }]).cup).toBe(false);
    expect(railKeyMarks([{ hasCompetition: false }, { hasCompetition: true }]).cup).toBe(true);
  });

  it("an unknown or missing role paints nothing", () => {
    // `badgedRole` is the shared source; Member and anything unrecognised are
    // both "no mark", and the key must not invent one.
    expect(railKeyMarks([{ myRole: null }, { myRole: undefined }, { myRole: "Planner" }]).roles)
      .toEqual([]);
  });

  it("no rows → no key", () => {
    expect(railKeyMarks([])).toEqual({ roles: [], cup: false });
  });
});
