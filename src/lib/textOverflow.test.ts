import { describe, it, expect } from "vitest";
import { isOverflowingBox, shouldShowExpandAffordance } from "./textOverflow";

describe("isOverflowingBox", () => {
  it("overflowing when scrollWidth exceeds clientWidth", () => {
    expect(isOverflowingBox(240, 180)).toBe(true);
  });

  it("not overflowing when they're equal (fits exactly)", () => {
    expect(isOverflowingBox(180, 180)).toBe(false);
  });

  it("not overflowing when scrollWidth is smaller — the direction must not invert", () => {
    expect(isOverflowingBox(100, 180)).toBe(false);
  });
});

describe("shouldShowExpandAffordance", () => {
  it("hidden when not overflowing and not expanded — no chevron on a card that fits", () => {
    expect(shouldShowExpandAffordance(false, false)).toBe(false);
  });

  it("shown when overflowing, even collapsed", () => {
    expect(shouldShowExpandAffordance(true, false)).toBe(true);
  });

  it("stays shown once expanded, even if no longer overflowing", () => {
    // e.g. a resize widened the card mid-read — the reader still needs a way
    // back to collapsed, so this must not flip false just because the text
    // would now fit on one line.
    expect(shouldShowExpandAffordance(false, true)).toBe(true);
  });

  it("shown when both true", () => {
    expect(shouldShowExpandAffordance(true, true)).toBe(true);
  });
});
