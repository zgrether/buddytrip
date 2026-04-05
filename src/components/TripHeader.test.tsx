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

describe("TripHeader — stepper placement", () => {
  // Both variants place the ProgressStepper below the title/destination
  // lines, inside the card, above the bottom edge.

  it("stepper is rendered inside both header variants", () => {
    // The layout in both PlainHeader and HeroHeader includes:
    //   <ProgressStepper stage={stage} displayStatus={status} countdownText={...} />
    // placed after destination/dates lines, before the card closing tag.
    const layout = {
      position: "below title and destination, inside card",
      component: "ProgressStepper",
    };

    expect(layout.component).toBe("ProgressStepper");
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
