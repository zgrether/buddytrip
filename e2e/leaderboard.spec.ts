import { test, expect } from "@playwright/test";

/**
 * LiveLeaderboard E2E — happy path
 *
 * Tests the leaderboard screen at /trips/[tripId]/leaderboard
 */

const MOCK_USER_ID = "user-test-001";
const TRIP_ID = "trip-lb-001";
const EVENT_ID = "event-001";
const TEAM_ID_EU = "team-eu-001";
const TEAM_ID_USA = "team-usa-001";
const ROUND_ID_1 = "round-001";
const ROUND_ID_2 = "round-002";

const MOCK_EVENT = {
  id: EVENT_ID,
  trip_id: TRIP_ID,
  title: "The Presidents Cup",
  subtitle: "Annual Golf Classic",
  motto: "May the best man win",
  location: "Pebble Beach, CA",
  dates: "Jun 15–18, 2026",
  competition_type: "RYDER_CUP",
  status: "active",
};

const MOCK_TRIP = {
  id: TRIP_ID,
  title: "BBMI 2026",
  location: "Scottsdale, AZ",
  start_date: "2026-06-15",
  end_date: "2026-06-18",
  status: "planning",
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
    status: "closed",
  },
  {
    id: ROUND_ID_2,
    event_id: EVENT_ID,
    day: 2,
    title: "Day 2 — Singles",
    course: "Spyglass Hill",
    format: "stableford",
    points_available: 10,
    status: "upcoming",
  },
];

const MOCK_ROUND_SCORES = [
  { round_id: ROUND_ID_1, team_id: TEAM_ID_EU, total_points: 7 },
  { round_id: ROUND_ID_1, team_id: TEAM_ID_USA, total_points: 3 },
];

const MOCK_SIDE_EVENTS = [
  {
    id: "se-001",
    event_id: EVENT_ID,
    name: "Closest to Pin",
    icon: "🎯",
    points_available: 2,
    status: "pending",
    result: null,
  },
];

const MOCK_PLAY_GROUPS = [
  {
    id: "pg-001",
    round_id: ROUND_ID_1,
    event_id: EVENT_ID,
    name: "Group A",
    tee_time: "8:00 AM",
    player_ids: ["user-001", "user-002", "user-003", "user-004"],
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

      if (url.includes("trips.getById")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_TRIP } }]),
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

      if (url.includes("groupResults.listScoresByEvent")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_ROUND_SCORES } }]),
        });
        return;
      }

      if (url.includes("sideEvents.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_SIDE_EVENTS } }]),
        });
        return;
      }

      if (url.includes("playGroups.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_PLAY_GROUPS } }]),
        });
        return;
      }

      if (url.includes("quickInfoTiles.list")) {
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

      if (url.includes("tripMembers.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_MEMBERS } }]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: [] } }]),
      });
    }),
  ]);
}

test.describe("Leaderboard", () => {
  test("renders overview tab with scores", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/leaderboard`);

    // Title should show event name
    await expect(page.getByText("The Presidents Cup")).toBeVisible();

    // Tab bar should be visible
    await expect(page.getByTestId("leaderboard-tabs")).toBeVisible();

    // Overview tab is default — should show team scores
    const overviewTab = page.getByTestId("overview-tab");
    await expect(overviewTab).toBeVisible();

    // Team scores (EUR: 7 from round 1, USA: 3 from round 1)
    await expect(page.getByTestId(`score-${TEAM_ID_EU}`)).toHaveText("7");
    await expect(page.getByTestId(`score-${TEAM_ID_USA}`)).toHaveText("3");

    // Round row visible
    await expect(page.getByTestId(`round-row-${ROUND_ID_1}`)).toBeVisible();
  });

  test("switches between tabs", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/leaderboard`);

    // Click Groups tab
    await page.getByTestId("tab-groups").click();
    await expect(page.getByTestId("groups-tab")).toBeVisible();

    // Click Trip Info tab
    await page.getByTestId("tab-trip-info").click();
    await expect(page.getByTestId("trip-info-tab")).toBeVisible();

    // Click History tab
    await page.getByTestId("tab-history").click();
    await expect(page.getByTestId("history-tab")).toBeVisible();
  });

  test("shows empty state when no event", async ({ page }) => {
    await setupMocks(page, { noEvent: true });
    await page.goto(`/trips/${TRIP_ID}/leaderboard`);

    await expect(page.getByText("No competition set up yet.")).toBeVisible();
  });

  test("history tab shows closed rounds with winner badge", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/leaderboard`);

    await page.getByTestId("tab-history").click();
    const historyTab = page.getByTestId("history-tab");
    await expect(historyTab).toBeVisible();

    // Round 1 is closed — should appear in history
    await expect(page.getByTestId(`history-${ROUND_ID_1}`)).toBeVisible();
    // EUR won round 1 (7 > 3)
    await expect(page.getByText("EUR wins")).toBeVisible();
  });
});
