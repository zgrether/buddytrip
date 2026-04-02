import { test, expect } from "@playwright/test";

/**
 * TripDetail E2E — happy path
 *
 * Covers the SPEC 2 structure: trip header with LocationHero, inline tab bar
 * (Home/Schedule/Crew/Competition), context-aware bottom nav, settings modal,
 * and the planning panels on the Home tab.
 */

const MOCK_USER_ID = "user-test-001";
const TRIP_ID = "trip-detail-test-001";

const MOCK_TRIP = {
  id: TRIP_ID,
  title: "Scotland Golf Adventure",
  description: "Epic links golf trip",
  location: "St Andrews, Scotland",
  start_date: new Date(Date.now() + 30 * 86400000).toISOString(),
  end_date: new Date(Date.now() + 37 * 86400000).toISOString(),
  locked_destination_title: null,
  locked_destination_location: null,
  locked_destination_at: null,
  event_id: null,
  series_id: null,
  cost_tier: null,
  image_url: null,
  accommodation: "Fairmont St Andrews",
  notes: "Book tee times early",
  activities: ["Golf", "Whisky tasting"],
  golf_courses: ["Old Course", "Kingsbarns"],
  comparison_mode: false,
  created_at: new Date().toISOString(),
};

const MOCK_TRIP_LOCKED = {
  ...MOCK_TRIP,
  id: "trip-locked-001",
  locked_destination_title: "St Andrews",
  locked_destination_location: "St Andrews, Scotland",
  locked_destination_at: new Date().toISOString(),
};

const MOCK_TRIP_WITH_EVENT = {
  ...MOCK_TRIP,
  id: "trip-with-event-001",
  title: "Ryder Cup Trip",
  event_id: "event-test-001",
};

const MOCK_MEMBERS = [
  {
    id: "member-001",
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    role: "Owner",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: MOCK_USER_ID, name: "Test User", nickname: null, email: "test@example.com", is_guest: false },
    memberId: MOCK_USER_ID,
    isGuest: false,
    displayName: "Test User",
  },
  {
    id: "member-002",
    trip_id: TRIP_ID,
    user_id: "user-002",
    role: "Member",
    status: "maybe",
    joined_at: new Date().toISOString(),
    user: { id: "user-002", name: "Jane Doe", nickname: null, email: "jane@example.com", is_guest: false },
    memberId: "user-002",
    isGuest: false,
    displayName: "Jane Doe",
  },
];

const MOCK_QUICK_TILES = [
  {
    id: "tile-001",
    trip_id: TRIP_ID,
    label: "Hotel",
    value: "Fairmont St Andrews",
    icon: "hotel",
    sort_order: 0,
    created_by: null,
    created_at: new Date().toISOString(),
  },
];

function setupMocks(page: import("@playwright/test").Page, tripData = MOCK_TRIP) {
  return Promise.all([
    // Auth
    page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: MOCK_USER_ID,
            email: "test@example.com",
            user_metadata: { name: "Test User" },
          }),
        });
      } else if (url.includes("/token") || url.includes("/session")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "mock-token",
            user: { id: MOCK_USER_ID, email: "test@example.com" },
          }),
        });
      } else {
        await route.continue();
      }
    }),

    // tRPC
    page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      if (url.includes("trips.getById")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: tripData } }]),
        });
        return;
      }

      if (url.includes("tripMembers.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_MEMBERS } }]),
        });
        return;
      }

      if (url.includes("quickInfoTiles.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_QUICK_TILES } }]),
        });
        return;
      }

      if (url.includes("datePoll.get")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: { id: "poll-1", windows: [] } } }]),
        });
        return;
      }

      if (url.includes("ideas.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: [] } }]),
        });
        return;
      }

      if (url.includes("reservations.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: [] } }]),
        });
        return;
      }

      if (url.includes("expenses.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: [] } }]),
        });
        return;
      }

      if (url.includes("events.getByTrip")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: null } }]),
        });
        return;
      }

      // Fallback
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: null } }]),
      });
    }),
  ]);
}

test.describe("TripDetail — SPEC 2 structure", () => {
  test("renders trip title and header with TBD state", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await expect(page.getByTestId("trip-title")).toContainText(
      "Scotland Golf Adventure"
    );

    // Should show location since trip has one
    await expect(page.getByText("St Andrews, Scotland")).toBeVisible();
  });

  test("shows inline tab bar with 4 tabs: Home, Schedule, Crew, Competition", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Inline tab bar (in body, not bottom nav)
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await expect(page.getByTestId("tab-schedule")).toBeVisible();
    await expect(page.getByTestId("tab-crew")).toBeVisible();
    await expect(page.getByTestId("tab-comp")).toBeVisible();
  });

  test("shows trip bottom nav with Trip Home and Messages", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Context-aware bottom nav for inside a trip
    await expect(page.getByTestId("nav-trip-home")).toBeVisible();
    await expect(page.getByTestId("nav-messages")).toBeVisible();
    // Live should be hidden (no event_id)
    await expect(page.getByTestId("nav-live")).not.toBeVisible();
  });

  test("shows settings icon for owner and opens settings modal", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    const settingsBtn = page.getByTestId("trip-settings-btn");
    await expect(settingsBtn).toBeVisible();

    await settingsBtn.click();

    // Settings modal should appear with trip name input and delete button
    await expect(page.getByTestId("settings-trip-name")).toBeVisible();
    await expect(page.getByTestId("settings-delete-btn")).toBeVisible();
  });

  test("switches to Crew tab and shows members list", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("tab-crew").click();

    // Should show members
    await expect(page.getByTestId(`member-${MOCK_USER_ID}`)).toBeVisible();
    await expect(page.getByTestId("member-user-002")).toBeVisible();

    // RSVP selector should be visible (current user is "in")
    await expect(page.getByTestId("rsvp-in")).toBeVisible();
    await expect(page.getByTestId("rsvp-out")).toBeVisible();
  });

  test("switches to Schedule tab and shows date poll + expenses", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("tab-schedule").click();

    // Should show date poll section
    await expect(page.getByText("No date options yet")).toBeVisible();

    // Expenses section should be present (moved from More tab)
    await expect(page.getByText("Expenses")).toBeVisible();
    await expect(page.getByText("No expenses recorded yet")).toBeVisible();
  });

  test("shows planning progress arc for owner", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Planning progress arc visible for canEdit users
    await expect(page.getByText("Planning Progress")).toBeVisible();
    await expect(page.getByText(/Destination locked/)).toBeVisible();
    await expect(page.getByText(/Dates set/)).toBeVisible();
  });

  test("shows date summary card on Home tab", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Trip has dates set, so should show "Dates Locked" card
    await expect(page.getByText("Dates Locked")).toBeVisible();
  });

  test("shows comp tab always and displays setup CTA when no event", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Competition tab is always visible now
    await page.getByTestId("tab-comp").click();

    // No event — should show setup CTA
    await expect(page.getByText("No competition set up yet")).toBeVisible();
    await expect(page.getByTestId("setup-competition-btn")).toBeVisible();
  });

  test("shows comp tab with event info when trip has event_id", async ({
    page,
  }) => {
    await Promise.all([
      page.route("**/auth/v1/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/user")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: MOCK_USER_ID,
              email: "test@example.com",
            }),
          });
        } else {
          await route.continue();
        }
      }),
      page.route("**/api/trpc/**", async (route) => {
        const url = route.request().url();

        if (url.includes("trips.getById")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ result: { data: MOCK_TRIP_WITH_EVENT } }]),
          });
          return;
        }
        if (url.includes("tripMembers.list")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{
              result: {
                data: [{ ...MOCK_MEMBERS[0], trip_id: MOCK_TRIP_WITH_EVENT.id }],
              },
            }]),
          });
          return;
        }
        if (url.includes("events.getByTrip")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{
              result: {
                data: {
                  id: "event-test-001",
                  title: "Ryder Cup Classic",
                  subtitle: "Europe vs USA",
                  motto: "May the best team win",
                  location: "St Andrews",
                  dates: "Jun 15–18, 2026",
                  status: "upcoming",
                  trip_id: MOCK_TRIP_WITH_EVENT.id,
                },
              },
            }]),
          });
          return;
        }
        if (url.includes("teams.list") || url.includes("rounds.list")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ result: { data: [] } }]),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: null } }]),
        });
      }),
    ]);

    await page.goto(`/trips/${MOCK_TRIP_WITH_EVENT.id}`);

    // Bottom nav should show Live link when event_id exists
    await expect(page.getByTestId("nav-live")).toBeVisible();

    // Click comp tab and verify event info
    await page.getByTestId("tab-comp").click();
    await expect(page.getByText("Ryder Cup Classic")).toBeVisible();
  });
});
