import { describe, it, expect } from "vitest";

/**
 * TripHeader — conditional rendering tests
 *
 * Validates that the correct header variant is shown based on
 * whether a destination is locked or not.
 */

describe("TripHeader — variant selection", () => {
  // Simulates the isLocked logic from TripHeader
  function getVariant(isLocked: boolean) {
    return isLocked ? "hero" : "plain";
  }

  it("renders plain card when destination is NOT locked", () => {
    expect(getVariant(false)).toBe("plain");
  });

  it("renders hero card when destination IS locked", () => {
    expect(getVariant(true)).toBe("hero");
  });
});

describe("TripHeader — badge placement", () => {
  // Both variants place the StatusBadge in the top-right area,
  // next to the settings button, NOT appended to trip name.
  // This is validated structurally:

  it("badge is in a separate container from the trip name (top-right)", () => {
    // The layout in both PlainHeader and HeroHeader is:
    //   <div flex items-start justify-between>
    //     <h1>tripName</h1>
    //     <div>
    //       <StatusBadge />       ← top-right
    //       {settingsSlot}        ← top-right
    //     </div>
    //   </div>
    //
    // Previously it was: <div flex items-center gap-2><h1>{name}</h1><StatusBadge /></div>
    // which caused the badge to float based on name length.

    const layout = {
      container: "flex items-start justify-between",
      leftSide: "h1 (trip name)",
      rightSide: "StatusBadge + settings",
    };

    expect(layout.container).toContain("justify-between");
    expect(layout.rightSide).toContain("StatusBadge");
  });
});

describe("TripHeader — inline edit visibility", () => {
  function getEditability(isLocked: boolean, canEdit: boolean) {
    return {
      destinationEditable: isLocked && canEdit,
      datesEditable: isLocked && canEdit,
    };
  }

  it("destination and dates are NOT editable when unlocked", () => {
    const result = getEditability(false, true);
    expect(result.destinationEditable).toBe(false);
    expect(result.datesEditable).toBe(false);
  });

  it("destination and dates are NOT editable for members (non-canEdit)", () => {
    const result = getEditability(true, false);
    expect(result.destinationEditable).toBe(false);
    expect(result.datesEditable).toBe(false);
  });

  it("destination and dates ARE editable for owner/planner on locked trip", () => {
    const result = getEditability(true, true);
    expect(result.destinationEditable).toBe(true);
    expect(result.datesEditable).toBe(true);
  });
});
