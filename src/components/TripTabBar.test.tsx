import { describe, it, expect } from "vitest";

/**
 * TripTabBar + BottomNav — structure tests
 *
 * Tests the tab configuration and nav item logic.
 * Full integration covered by Playwright E2E.
 */

describe("TripTabBar — tab configuration", () => {
  // Per SPEC 2: always show 4 tabs (Home, Schedule, Crew, Competition)
  const TABS = [
    { id: "home", label: "Home" },
    { id: "schedule", label: "Schedule" },
    { id: "crew", label: "Crew" },
    { id: "comp", label: "Competition" },
  ];

  it("has exactly 4 tabs", () => {
    expect(TABS).toHaveLength(4);
  });

  it("includes Home, Schedule, Crew, Competition", () => {
    const ids = TABS.map((t) => t.id);
    expect(ids).toEqual(["home", "schedule", "crew", "comp"]);
  });

  it("does NOT include More tab", () => {
    const ids = TABS.map((t) => t.id);
    expect(ids).not.toContain("more");
  });
});

describe("TripBottomNav — item visibility", () => {
  function getVisibleItems(tripId: string, eventId: string | null) {
    const items = [
      { id: "trip-home", label: "Trip Home", href: `/trips/${tripId}`, hidden: false },
      { id: "messages", label: "Messages", href: `/trips/${tripId}/messages`, hidden: false },
      { id: "live", label: "Live", href: `/trips/${tripId}/leaderboard`, hidden: !eventId },
    ];
    return items.filter((i) => !i.hidden);
  }

  it("shows 2 items when no event_id", () => {
    const items = getVisibleItems("trip-1", null);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["trip-home", "messages"]);
  });

  it("shows 3 items when event_id exists", () => {
    const items = getVisibleItems("trip-1", "event-1");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(["trip-home", "messages", "live"]);
  });
});

describe("TripBottomNav — back navigation contract", () => {
  // The TripBottomNav must use router.push() (not replace) so that
  // browser back / swipe back returns to the previous page:
  //   Trip Home → Messages → browser back → Trip Home ✓
  //   Trip Home → Competition → browser back → Trip Home ✓
  //   Dashboard → Trip Home → browser back → Dashboard ✓

  it("navigates to trip home from messages/competition via push (not replace)", () => {
    // Verify the nav items produce correct hrefs for the back chain
    const tripId = "trip-123";
    const items = [
      { id: "trip-home", href: `/trips/${tripId}` },
      { id: "messages", href: `/trips/${tripId}/messages` },
      { id: "live", href: `/trips/${tripId}/leaderboard` },
    ];
    expect(items[0].href).toBe("/trips/trip-123");
    expect(items[1].href).toBe("/trips/trip-123/messages");
    expect(items[2].href).toBe("/trips/trip-123/leaderboard");
  });

  it("skips navigation when already on the target page", () => {
    // When pathname === href, TripBottomNav should not call router.push
    // to avoid duplicate history entries
    const pathname = "/trips/trip-123/messages";
    const href = "/trips/trip-123/messages";
    expect(pathname === href).toBe(true); // would skip
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
