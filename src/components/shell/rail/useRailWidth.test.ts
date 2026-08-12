import { describe, it, expect } from "vitest";
import {
  clampRailWidth,
  decodeStoredWidth,
  RAIL_MAX_PX,
  RAIL_MIN_PX,
  RAIL_DEFAULT_PX,
  RAIL_COLLAPSED_PX,
  RAIL_CONTRACTED_PX,
  RAIL_ART_MIN_PX,
  RAIL_STRIP_PX,
} from "./useRailWidth";

describe("clampRailWidth — the drag range", () => {
  it("stops at the ceiling", () => {
    expect(clampRailWidth(9999)).toBe(RAIL_MAX_PX);
  });

  it("stops at the absolute floor when no measured floor is given a chance", () => {
    expect(clampRailWidth(10, RAIL_MIN_PX)).toBe(RAIL_MIN_PX);
  });

  it("respects a measured floor above the absolute one", () => {
    expect(clampRailWidth(180, 233)).toBe(233);
  });

  it("never respects a floor BELOW the absolute one", () => {
    // A caller measuring a very short set of names must not be able to drive
    // the rail under the width where the headers and the key stop fitting.
    expect(clampRailWidth(50, 40)).toBe(RAIL_MIN_PX);
  });

  it("NEVER returns the collapsed value — collapsing is the button's job", () => {
    // This is what keeps the two controls from being two ways to say one thing.
    for (const px of [-500, -1, 0, 1, 60, 199]) {
      expect(clampRailWidth(px, RAIL_MIN_PX)).toBeGreaterThan(RAIL_COLLAPSED_PX);
    }
  });
});

describe("decodeStoredWidth — the read half of persistence (#902)", () => {
  it("round-trips a dragged width", () => {
    expect(decodeStoredWidth(String(317))).toBe(317);
  });

  it("round-trips COLLAPSED rather than clamping it up to the floor", () => {
    // The trap. Clamping here would make the collapse un-persistable: the write
    // succeeds, the reload comes back at the minimum, and the bug reads as
    // "collapse doesn't stick" rather than as a decode error.
    expect(decodeStoredWidth("0")).toBe(RAIL_COLLAPSED_PX);
  });

  it("falls back to the default for anything unparseable", () => {
    // Includes the stale v1 boolean, which is deliberately ignored rather than
    // migrated.
    for (const raw of [null, "", "  ", "true", "false", "wide", "NaN"]) {
      expect(decodeStoredWidth(raw)).toBe(RAIL_DEFAULT_PX);
    }
  });

  it("clamps a stored value that is out of range", () => {
    expect(decodeStoredWidth("5000")).toBe(RAIL_MAX_PX);
    expect(decodeStoredWidth("120")).toBe(RAIL_MIN_PX);
  });

  it("agrees with the server snapshot's default", () => {
    // getServerSnapshot returns RAIL_DEFAULT_PX; a first visit with no stored
    // value must decode to the SAME number or hydration paints one width with
    // the other width's contents — the exact #902 failure.
    expect(decodeStoredWidth(null)).toBe(RAIL_DEFAULT_PX);
  });
});

describe("the constants are mutually consistent", () => {
  it("orders the range", () => {
    expect(RAIL_COLLAPSED_PX).toBeLessThan(RAIL_MIN_PX);
    expect(RAIL_MIN_PX).toBeLessThan(RAIL_CONTRACTED_PX);
    expect(RAIL_CONTRACTED_PX).toBeLessThan(RAIL_MAX_PX);
    expect(RAIL_DEFAULT_PX).toBeGreaterThanOrEqual(RAIL_MIN_PX);
    expect(RAIL_DEFAULT_PX).toBeLessThanOrEqual(RAIL_MAX_PX);
  });

  it("keeps the art threshold reachable from both sides", () => {
    // If it sat outside the range the art would be permanently on or off, and
    // the threshold would be a lie rather than a setting.
    expect(RAIL_ART_MIN_PX).toBeGreaterThan(RAIL_MIN_PX);
    expect(RAIL_ART_MIN_PX).toBeLessThan(RAIL_MAX_PX);
  });

  it("collapses to the strip alone, which is what the tabs must follow", () => {
    // `--bt-rail-width` is RAIL_STRIP_PX + width, so collapsed publishes the
    // strip's own width and nothing else.
    expect(RAIL_STRIP_PX + RAIL_COLLAPSED_PX).toBe(RAIL_STRIP_PX);
  });
});
