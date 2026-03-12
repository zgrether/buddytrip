import { test, expect } from "@playwright/test";

/**
 * TripDetail E2E — happy path
 *
 * Covers the 5-tab shell: renders trip header, switches tabs, shows comp tab
 * only when event_id is present, and shows the More tab danger zone for owners.
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

const MOCK_TRIP_WITH_EVENT = {
  ...MOCK_TRIP,
  id: "trip-with-event-001",
  title: "Ryder Cup Trip",
  event_id: "event-test-001",
};

const MOCK_MEMBERS = [
  {
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    role: "Owner",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: MOCK_USER_ID, name: "Test User", nickname: null, email: "test@example.com" },
  },
  {
    trip_id: TRIP_ID,
    user_id: "user-002",
    role: "Member",
    status: "maybe",
    joined_at: new Date().toISOString(),
    user: { id: "user-002", name: "Jane Doe", nickname: null, email: "jane@example.com" },
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

      if (url.includes("reservations.list")) {
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

test.describe("TripDetail shell", () => {
  test("renders trip title and header", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await expect(page.getByTestId("trip-title")).toContainText(
      "Scotland Golf Adventure"
    );
  });

  test("renders bottom navigation with 4 tabs (no comp when no event_id)", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await expect(page.getByTestId("tab-home")).toBeVisible();
    await expect(page.getByTestId("tab-schedule")).toBeVisible();
    await expect(page.getByTestId("tab-crew")).toBeVisible();
    await expect(page.getByTestId("tab-more")).toBeVisible();

    // Comp tab should NOT be present when event_id is null
    await expect(page.getByTestId("tab-comp")).not.toBeVisible();
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

  test("switches to Schedule tab and shows empty date poll", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("tab-schedule").click();

    // Should show "No date options yet"
    await expect(page.getByText("No date options yet")).toBeVisible();
  });

  test("switches to More tab and shows edit form and delete button for owner", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("tab-more").click();

    // Edit form visible for owner (who is also canEdit)
    await expect(page.getByTestId("edit-title")).toBeVisible();
    await expect(page.getByTestId("save-trip-btn")).toBeVisible();

    // Delete button visible for owner
    await expect(page.getByTestId("delete-trip-btn")).toBeVisible();
  });

  test("shows comp tab when trip has event_id", async ({ page }) => {
    // Override mocks for a trip with an event
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
            body: JSON.stringify([
              {
                result: {
                  data: [{ ...MOCK_MEMBERS[0], trip_id: MOCK_TRIP_WITH_EVENT.id }],
                },
              },
            ]),
          });
          return;
        }
        if (url.includes("events.getByTrip")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
              {
                result: {
                  data: {
                    id: "event-test-001",
                    title: "Ryder Cup Classic",
                    subtitle: "Europe vs USA",
                    motto: "May the best team win",
                    location: "St Andrews",
                    dates: "Jun 15–18, 2026",
                    status: "upcoming",
                    competition_type: "RYDER_CUP",
                    trip_id: MOCK_TRIP_WITH_EVENT.id,
                  },
                },
              },
            ]),
          });
          return;
        }
        if (url.includes("teams.list")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ result: { data: [] } }]),
          });
          return;
        }
        if (url.includes("rounds.list")) {
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

    // Comp tab should be visible when event_id is set
    await expect(page.getByTestId("tab-comp")).toBeVisible();

    // Click comp tab and verify event info
    await page.getByTestId("tab-comp").click();
    await expect(page.getByText("Ryder Cup Classic")).toBeVisible();
  });
});
