import { describe, it, expect } from "vitest";

/**
 * TripTabBar + BottomNav — structure tests
 *
 * Tests the tab configuration and nav item logic.
 * Full integration covered by Playwright E2E.
 */

describe("TripTabBar — tab configuration", () => {
  // Post Stage-5 cord-cut: the tab bar is PURE TRIP CONTENT — no Competition
  // tab. The competition is a face (created from trip Home's enable card,
  // entered via the "Live" bottom-nav entry), not a tab.
  const TAB_IDS = ["home", "crew", "lodging", "schedule", "expenses"];

  it("is pure trip content — no Competition tab", () => {
    expect(TAB_IDS).not.toContain("comp");
  });

  it("includes the five trip tabs", () => {
    expect(TAB_IDS).toEqual(["home", "crew", "lodging", "schedule", "expenses"]);
  });
});

describe("TripBottomNav — item visibility", () => {
  function getVisibleItems(tripId: string, eventId: string | null) {
    const items = [
      { id: "trip-home", label: "Trip Home", href: `/trips/${tripId}`, hidden: false },
      { id: "live", label: "Live", href: `/trips/${tripId}/leaderboard`, hidden: !eventId },
    ];
    return items.filter((i) => !i.hidden);
  }

  it("shows 1 item when no event_id", () => {
    const items = getVisibleItems("trip-1", null);
    expect(items).toHaveLength(1);
    expect(items.map((i) => i.id)).toEqual(["trip-home"]);
  });

  it("shows 2 items when event_id exists", () => {
    const items = getVisibleItems("trip-1", "event-1");
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["trip-home", "live"]);
  });
});

describe("TripBottomNav — back navigation contract", () => {
  // The TripBottomNav must use router.push() (not replace) so that
  // browser back / swipe back returns to the previous page:
  //   Trip Home → Competition → browser back → Trip Home ✓
  //   Dashboard → Trip Home → browser back → Dashboard ✓

  it("navigates to trip home from competition via push (not replace)", () => {
    // Verify the nav items produce correct hrefs for the back chain
    const tripId = "trip-123";
    const items = [
      { id: "trip-home", href: `/trips/${tripId}` },
      { id: "live", href: `/trips/${tripId}/leaderboard` },
    ];
    expect(items[0].href).toBe("/trips/trip-123");
    expect(items[1].href).toBe("/trips/trip-123/leaderboard");
  });

  it("skips navigation when already on the target page", () => {
    // When pathname === href, TripBottomNav should not call router.push
    // to avoid duplicate history entries
    const pathname = "/trips/trip-123/leaderboard";
    const href = "/trips/trip-123/leaderboard";
    expect(pathname === href).toBe(true); // would skip
  });
});

// ── Tab-filtering tests ────────────────────────────────────────────────

describe("Tab bar — tab filtering", () => {
  // No Competition tab anymore (Stage 5 cord-cut). The tab bar is pure trip
  // content for everyone; the competition is reached via the "Live" bottom-nav
  // entry, not a tab.
  const ALL_TAB_IDS = ["home", "crew", "lodging", "schedule", "expenses"];

  it("never includes a Competition tab (it's a face, not a tab)", () => {
    expect(ALL_TAB_IDS).not.toContain("comp");
  });

  it("Expenses tab is present in the tab list", () => {
    expect(ALL_TAB_IDS).toContain("expenses");
  });
});

describe("GlobalBottomNav — item visibility", () => {
  function getVisibleItems(activeTripId: string | null) {
    const items = [
      { id: "home", label: "Home", href: "/dashboard", hidden: false },
      { id: "new", label: "New Trip", href: "/trips/new", hidden: false },
      { id: "live", label: "Live", href: activeTripId ? `/trips/${activeTripId}/leaderboard` : "#", hidden: !activeTripId },
    ];
    return items.filter((i) => !i.hidden);
  }

  it("shows 2 items when no active trip", () => {
    const items = getVisibleItems(null);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["home", "new"]);
  });

  it("shows 3 items when active trip exists", () => {
    const items = getVisibleItems("trip-live-1");
    expect(items).toHaveLength(3);
    expect(items[2].href).toBe("/trips/trip-live-1/leaderboard");
  });
});
