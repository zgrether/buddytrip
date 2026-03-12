import { test, expect } from "@playwright/test";

/**
 * CompetitionSetup E2E — happy path
 *
 * Tests the competition setup screen at /trips/[tripId]/competition/setup
 */

const MOCK_USER_ID = "user-test-001";
const TRIP_ID = "trip-comp-setup-001";
const EVENT_ID = "event-001";
const TEAM_ID_EU = "team-eu-001";
const TEAM_ID_USA = "team-usa-001";
const ROUND_ID_1 = "round-001";

const MOCK_EVENT = {
  id: EVENT_ID,
  trip_id: TRIP_ID,
  title: "The Presidents Cup",
  subtitle: "Annual Golf Classic",
  motto: "May the best man win",
  location: "Pebble Beach, CA",
  dates: "Jun 15–18, 2026",
  competition_type: "RYDER_CUP",
  status: "upcoming",
};

const MOCK_TEAMS = [
  {
    id: TEAM_ID_EU,
    event_id: EVENT_ID,
    name: "Europe",
    short_name: "EUR",
    color: "#3b82f6",
    color_dim: "#1e3a8a",
  },
  {
    id: TEAM_ID_USA,
    event_id: EVENT_ID,
    name: "USA",
    short_name: "USA",
    color: "#ef4444",
    color_dim: "#7f1d1d",
  },
];

const MOCK_ROUNDS = [
  {
    id: ROUND_ID_1,
    event_id: EVENT_ID,
    day: 1,
    title: "Day 1 — Foursomes",
    course: "Pebble Beach Golf Links",
    format: "scramble",
    points_available: 10,
    is_closed: false,
  },
];

const MOCK_MEMBERS = [
  {
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    role: "Owner",
    status: "in",
    user: { id: MOCK_USER_ID, name: "Alice", email: "alice@example.com" },
  },
  {
    trip_id: TRIP_ID,
    user_id: "user-002",
    role: "Member",
    status: "in",
    user: { id: "user-002", name: "Bob", email: "bob@example.com" },
  },
];

const MOCK_ASSIGNMENTS = [
  { event_id: EVENT_ID, team_id: TEAM_ID_EU, user_id: MOCK_USER_ID },
];

async function setupMocks(
  page: import("@playwright/test").Page,
  opts: { noEvent?: boolean } = {}
) {
  await Promise.all([
    page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: MOCK_USER_ID,
            email: "alice@example.com",
          }),
        });
      } else if (url.includes("/token") || url.includes("/session")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "mock-token",
            user: { id: MOCK_USER_ID, email: "alice@example.com" },
          }),
        });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      if (url.includes("events.getByTrip")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { result: { data: opts.noEvent ? null : MOCK_EVENT } },
          ]),
        });
        return;
      }

      if (url.includes("teams.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_TEAMS } }]),
        });
        return;
      }

      if (url.includes("rounds.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_ROUNDS } }]),
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

      if (url.includes("teamAssignments.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_ASSIGNMENTS } }]),
        });
        return;
      }

      if (url.includes("events.upsert")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_EVENT } }]),
        });
        return;
      }

      if (url.includes("teams.upsert")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  id: "team-new-001",
                  event_id: EVENT_ID,
                  name: "Rest of World",
                  short_name: "ROW",
                  color: "#22c55e",
                  color_dim: "#14532d",
                },
              },
            },
          ]),
        });
        return;
      }

      if (url.includes("rounds.create")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  id: "round-new-001",
                  event_id: EVENT_ID,
                  day: 2,
                  title: "Day 2 — Singles",
                  course: "Spyglass Hill",
                  format: "singles",
                  points_available: 12,
                },
              },
            },
          ]),
        });
        return;
      }

      if (url.includes("rounds.remove")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: { id: ROUND_ID_1 } } }]),
        });
        return;
      }

      if (url.includes("teamAssignments.assign")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: { success: true } } }]),
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
}

test.describe("CompetitionSetup", () => {
  test("renders heading and three tab buttons", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    await expect(page.getByTestId("setup-heading")).toBeVisible();
    await expect(page.getByTestId("setup-tab-event")).toBeVisible();
    await expect(page.getByTestId("setup-tab-teams")).toBeVisible();
    await expect(page.getByTestId("setup-tab-rounds")).toBeVisible();
  });

  test("event tab shows pre-filled form when event exists", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    // Event tab should be active by default
    const titleInput = page.getByTestId("event-title");
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toHaveValue("The Presidents Cup");

    // Save button should say "Update Event"
    await expect(page.getByTestId("save-event-btn")).toContainText(
      "Update Event"
    );
  });

  test("event tab shows empty form when no event exists", async ({ page }) => {
    await setupMocks(page, { noEvent: true });
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    const titleInput = page.getByTestId("event-title");
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toHaveValue("");

    await expect(page.getByTestId("save-event-btn")).toContainText(
      "Create Event"
    );
  });

  test("teams tab shows existing teams and player assignment rows", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    await page.getByTestId("setup-tab-teams").click();

    await expect(page.getByTestId(`team-row-${TEAM_ID_EU}`)).toBeVisible();
    await expect(page.getByTestId(`team-row-${TEAM_ID_USA}`)).toBeVisible();

    // Player rows from members
    await expect(
      page.getByTestId(`player-row-${MOCK_USER_ID}`)
    ).toBeVisible();
    await expect(page.getByTestId("player-row-user-002")).toBeVisible();
  });

  test("teams tab: show-add-team button reveals form and submits", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    await page.getByTestId("setup-tab-teams").click();

    // Reveal the add team form
    await page.getByTestId("show-add-team-btn").click();
    await expect(page.getByTestId("team-name-input")).toBeVisible();

    // Fill in team name and short name
    await page.getByTestId("team-name-input").fill("Rest of World");
    await page.getByTestId("team-short-input").fill("ROW");

    // Submit
    await page.getByTestId("add-team-btn").click();

    // Form should close (team name input no longer visible)
    await expect(page.getByTestId("team-name-input")).not.toBeVisible();
  });

  test("rounds tab shows existing rounds with remove buttons", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    await page.getByTestId("setup-tab-rounds").click();

    await expect(
      page.getByTestId(`round-row-${ROUND_ID_1}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`remove-round-${ROUND_ID_1}`)
    ).toBeVisible();
  });

  test("rounds tab: add round form submits successfully", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    await page.getByTestId("setup-tab-rounds").click();

    // Open add round form
    await page.getByTestId("show-add-round-btn").click();
    await expect(page.getByTestId("round-title-input")).toBeVisible();

    // Fill in details
    await page.getByTestId("round-title-input").fill("Day 2 — Singles");
    await page.getByTestId("round-course-input").fill("Spyglass Hill");

    // Change format
    await page
      .getByTestId("round-format-select")
      .selectOption("singles");

    // Submit
    await page.getByTestId("save-round-btn").click();

    // Form should close
    await expect(page.getByTestId("round-title-input")).not.toBeVisible();
  });

  test("teams and rounds tabs show fallback when no event exists", async ({
    page,
  }) => {
    await setupMocks(page, { noEvent: true });
    await page.goto(`/trips/${TRIP_ID}/competition/setup`);

    await page.getByTestId("setup-tab-teams").click();
    await expect(
      page.getByText("Create an event first before adding teams.")
    ).toBeVisible();

    await page.getByTestId("setup-tab-rounds").click();
    await expect(
      page.getByText("Create an event first before adding rounds.")
    ).toBeVisible();
  });
});
