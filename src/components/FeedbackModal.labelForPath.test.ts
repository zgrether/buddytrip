import { describe, it, expect } from "vitest";
import { labelForPath } from "./FeedbackModal";

/**
 * `labelForPath` tells a feedback report which screen the user was on.
 *
 * WHY THIS EXISTS NOW. Its per-tab branch has been dead since it was written:
 * it reads the active tab from `?tab=`, and the trip page kept tab state in
 * `useState` and never wrote the URL back (IA-1). So every report from any trip
 * tab was labelled just "Trip" — the six labels below were unreachable in
 * production (NAV_AUDIT_2.md §1.1). Phase 2 makes the URL the source of truth,
 * which brings them back for free; these lock that they resolve.
 */

describe("labelForPath — per-tab labels (reachable again after Phase 2)", () => {
  it.each([
    ["home", "Trip · Home"],
    ["crew", "Trip · Crew"],
    ["lodging", "Trip · Lodging"],
    ["schedule", "Trip · Schedule"],
    ["expenses", "Trip · Expenses"],
    ["comp", "Trip · Competition"],
  ])("?tab=%s → %s", (tab, expected) => {
    expect(labelForPath("/trips/abc123", tab)).toBe(expected);
  });

  it("treats a missing tab as Home, which is what the URL now means", () => {
    // The Home tab deliberately writes NO `?tab=` (a bare trip URL is the
    // canonical Home link), so the no-param fallback and `?tab=home` have to
    // agree — otherwise the same screen reports two different labels depending
    // on whether the user arrived by tap or by deep link.
    expect(labelForPath("/trips/abc123", null)).toBe("Trip · Home");
    expect(labelForPath("/trips/abc123", "home")).toBe("Trip · Home");
  });

  it("passes an unknown tab through rather than mislabelling it", () => {
    expect(labelForPath("/trips/abc123", "nonsense")).toBe("Trip · nonsense");
  });

  it("still labels the non-trip screens", () => {
    expect(labelForPath("/dashboard", null)).toBe("Dashboard");
    expect(labelForPath("/login", null)).toBe("Login");
    expect(labelForPath("/", null)).toBe("Landing");
  });

  it("has no /profile arm — preferences is an overlay, not a route", () => {
    // Deliberate, not an omission. The route is gone, so the path can't occur;
    // the arms are removed rather than left as dead lookups. Documented here
    // because this is the referrer class that dies SILENTLY (a lookup, not a
    // link) — the assertion is what makes a re-add visible. The fallback is the
    // raw path, which is also the honest answer: if that string ever shows up on
    // a feedback report, a route came back.
    expect(labelForPath("/profile", null)).toBe("/profile");
  });
});
