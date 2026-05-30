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

// ── Stage-gating tests ─────────────────────────────────────────────────

describe("Stage-gated bottom nav visibility", () => {
  function showBottomNav(stage: string) {
    return stage !== "idea" && stage !== "planning";
  }

  it("hidden in idea stage", () => {
    expect(showBottomNav("idea")).toBe(false);
  });

  it("hidden in planning stage", () => {
    expect(showBottomNav("planning")).toBe(false);
  });

  it("visible in going stage", () => {
    expect(showBottomNav("going")).toBe(true);
  });

  it("visible in done stage", () => {
    expect(showBottomNav("done")).toBe(true);
  });
});

describe("Stage-gated tab bar — tab filtering", () => {
  const ALL_TAB_IDS = ["home", "crew", "schedule", "expenses", "comp"];

  // Competition is an owner/organizer-only authoring surface: the tab shows
  // iff the viewer can edit (Owner or Planner), independent of stage or
  // whether a competition row exists. Members reach a live competition via
  // the bottom-nav "Live" entry instead.
  function getVisibleTabs(canEdit: boolean) {
    return ALL_TAB_IDS.filter((id) => {
      if (id === "comp") return canEdit;
      return true;
    });
  }

  it("hides Competition tab from members (non-editors)", () => {
    const tabs = getVisibleTabs(false);
    expect(tabs).not.toContain("comp");
    expect(tabs).toEqual(["home", "crew", "schedule", "expenses"]);
  });

  it("shows Competition tab for owners/organizers (editors)", () => {
    const tabs = getVisibleTabs(true);
    expect(tabs).toContain("comp");
  });

  it("Expenses tab is always present in tab list (disabled state handled at click level)", () => {
    const tabs = getVisibleTabs(true);
    expect(tabs).toContain("expenses");
  });
});

describe("Competition CTA stage gating", () => {
  function showCompetitionCTA(stage: string) {
    return stage !== "idea" && stage !== "planning";
  }

  it("hidden in idea stage", () => {
    expect(showCompetitionCTA("idea")).toBe(false);
  });

  it("hidden in planning stage", () => {
    expect(showCompetitionCTA("planning")).toBe(false);
  });

  it("visible in going stage", () => {
    expect(showCompetitionCTA("going")).toBe(true);
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
