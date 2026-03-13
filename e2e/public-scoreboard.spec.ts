import { test, expect } from "@playwright/test";

// ── Mock data ────────────────────────────────────────────────────────────

const SHARE_CODE = "sb-test123";
const SCOREBOARD_DATA = {
  result: {
    data: {
      tripId: "trip-1",
      event: {
        id: "evt-1",
        trip_id: "trip-1",
        title: "Ryder Cup 2026",
        subtitle: "Scottsdale, AZ",
        location: "Scottsdale",
        dates: "Mar 15-18",
      },
      teams: [
        { id: "t-a", event_id: "evt-1", name: "Europe", short_name: "EUR", color: "#3b82f6", color_dim: "#3b82f644" },
        { id: "t-b", event_id: "evt-1", name: "USA", short_name: "USA", color: "#ef4444", color_dim: "#ef444444" },
      ],
      rounds: [
        { id: "r1", event_id: "evt-1", day: 1, title: "Day 1", course: "TPC", format: "scramble", points_available: 4, status: "closed" },
        { id: "r2", event_id: "evt-1", day: 2, title: "Day 2", course: "TPC", format: "stableford", points_available: 4, status: "active" },
      ],
      sideEvents: [],
      roundScores: [
        { round_id: "r1", team_id: "t-a", total_points: 2.5 },
        { round_id: "r1", team_id: "t-b", total_points: 1.5 },
      ],
    },
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Public Scoreboard", () => {
  test.beforeEach(async ({ page }) => {
    // Mock tRPC batch endpoint
    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      if (url.includes("scoreboardShares.getScoreboard")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([SCOREBOARD_DATA]),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: null } }]),
      });
    });
  });

  test("renders public scoreboard with event title", async ({ page }) => {
    await page.goto(`/scoreboard/${SHARE_CODE}`);
    const scoreboard = page.locator('[data-testid="public-scoreboard"]');
    await expect(scoreboard).toBeVisible();
    await expect(page.locator("h1")).toContainText("Ryder Cup 2026");
  });

  test("shows team scores", async ({ page }) => {
    await page.goto(`/scoreboard/${SHARE_CODE}`);
    await expect(page.locator("text=EUR")).toBeVisible();
    await expect(page.locator("text=USA")).toBeVisible();
  });

  test("shows LIVE badge", async ({ page }) => {
    await page.goto(`/scoreboard/${SHARE_CODE}`);
    await expect(page.locator("text=LIVE")).toBeVisible();
  });

  test("shows rounds table with day info", async ({ page }) => {
    await page.goto(`/scoreboard/${SHARE_CODE}`);
    await expect(page.locator("text=Day 1")).toBeVisible();
    await expect(page.locator("text=Day 2")).toBeVisible();
    await expect(page.locator("text=TOTAL")).toBeVisible();
  });

  test("shows powered by BuddyTrip", async ({ page }) => {
    await page.goto(`/scoreboard/${SHARE_CODE}`);
    await expect(page.locator("text=Powered by BuddyTrip")).toBeVisible();
  });
});
