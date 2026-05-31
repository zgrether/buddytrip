import { test, expect } from "@playwright/test";

/**
 * Dashboard E2E — happy path
 *
 * Strategy: intercept tRPC batch calls at the network layer so we don't
 * need a live Supabase session. Auth is mocked by intercepting the
 * Supabase session endpoint too.
 */

const MOCK_USER_ID = "user-test-001";

const MOCK_TRIPS = [
  {
    id: "trip-live-1",
    title: "Pebble Beach Golf Trip",
    location: "Pebble Beach, CA",
    start_date: new Date(Date.now() - 86400000).toISOString(), // yesterday
    end_date: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    locked_destination_title: "Pebble Beach",
    myRole: "Owner",
    myStatus: "in",
    created_at: new Date().toISOString(),
  },
  {
    id: "trip-ready-1",
    title: "Scotland Golf Adventure",
    location: "St Andrews, Scotland",
    start_date: new Date(Date.now() + 30 * 86400000).toISOString(),
    end_date: new Date(Date.now() + 37 * 86400000).toISOString(),
    locked_destination_title: "St Andrews",
    myRole: "Planner",
    myStatus: "in",
    created_at: new Date().toISOString(),
  },
  {
    id: "trip-upcoming-1",
    title: "Augusta Weekend",
    location: null,
    start_date: null,
    end_date: null,
    locked_destination_title: null,
    myRole: "Member",
    myStatus: "maybe",
    created_at: new Date().toISOString(),
  },
];

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // ── Mock Supabase auth ──────────────────────────────────────────────────
    await page.route("**/auth/v1/**", async (route) => {
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
    });

    // ── Mock tRPC batch endpoint ────────────────────────────────────────────
    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      // Decode which procedures are being requested
      if (url.includes("trips.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { result: { data: MOCK_TRIPS } },
          ]),
        });
        return;
      }

      await route.continue();
    });
  });

  test("renders trip sections with trip cards", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for the dashboard to finish loading
    await expect(page.locator('[data-testid="section-live"]')).toBeVisible({
      timeout: 10_000,
    });

    // Live section
    await expect(
      page.locator('[data-testid="section-live"]')
    ).toContainText("Live");
    await expect(
      page.locator('[data-testid="trip-card-trip-live-1"]')
    ).toBeVisible();

    // Ready section
    await expect(
      page.locator('[data-testid="section-ready"]')
    ).toContainText("Ready");
    await expect(
      page.locator('[data-testid="trip-card-trip-ready-1"]')
    ).toBeVisible();

    // Upcoming section
    await expect(
      page.locator('[data-testid="section-upcoming"]')
    ).toContainText("Upcoming");
    await expect(
      page.locator('[data-testid="trip-card-trip-upcoming-1"]')
    ).toBeVisible();
  });

  test("shows empty state when user has no trips", async ({ page }) => {
    // Override trips.list to return empty
    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();
      if (url.includes("trips.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: [] } }]),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/dashboard");

    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="create-first-trip"]')
    ).toBeVisible();
  });

  test("past trips section is collapsible", async ({ page }) => {
    const pastTrip = {
      id: "trip-past-1",
      title: "Myrtle Beach 2024",
      location: "Myrtle Beach, SC",
      start_date: new Date("2024-06-01").toISOString(),
      end_date: new Date("2024-06-07").toISOString(),
      locked_destination_title: "Myrtle Beach",
      myRole: "Owner",
      myStatus: "in",
      created_at: new Date("2024-05-01").toISOString(),
    };

    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();
      if (url.includes("trips.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: [pastTrip] } }]),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/dashboard");

    // Past toggle should be visible but trips collapsed by default
    await expect(page.locator('[data-testid="past-toggle"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="trip-card-trip-past-1"]')
    ).not.toBeVisible();

    // Expand
    await page.locator('[data-testid="past-toggle"]').click();
    await expect(
      page.locator('[data-testid="trip-card-trip-past-1"]')
    ).toBeVisible();

    // Collapse
    await page.locator('[data-testid="past-toggle"]').click();
    await expect(
      page.locator('[data-testid="trip-card-trip-past-1"]')
    ).not.toBeVisible();
  });

  test("FAB navigates to /trips/new", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for trips to load (FAB only shown when hasAnyTrips)
    await expect(page.locator('[data-testid="section-live"]')).toBeVisible({
      timeout: 10_000,
    });

    await page.locator('[data-testid="fab-new-trip"]').click();
    await expect(page).toHaveURL(/\/trips\/new/);
  });
});
