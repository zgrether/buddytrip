import { test, expect } from "@playwright/test";

/**
 * Notifications E2E — happy path
 *
 * Strategy: intercept tRPC batch calls at the network layer so we don't
 * need a live Supabase session. Auth is mocked by intercepting the
 * Supabase session endpoint too.
 */

const MOCK_USER_ID = "user-test-001";

const MOCK_TRIPS = [
  {
    id: "trip-notif-1",
    title: "BBMI 2026",
    location: "Scottsdale, AZ",
    start_date: "2026-09-15",
    end_date: "2026-09-20",
    locked_destination_title: "Scottsdale",
    myRole: "Owner",
    myStatus: "in",
    created_at: new Date().toISOString(),
  },
];

const MOCK_NOTIFICATIONS = [
  {
    id: "notif-1",
    type: "rsvp_response",
    trip_id: "trip-notif-1",
    actor_id: "user-test-002",
    payload: {
      responder_name: "Mike",
      rsvp_status: "in",
      trip_name: "BBMI 2026",
      trip_id: "trip-notif-1",
    },
    created_at: new Date(Date.now() - 120000).toISOString(), // 2 min ago
    read: false,
  },
  {
    id: "notif-2",
    type: "destination_locked",
    trip_id: "trip-notif-1",
    actor_id: "user-test-001",
    payload: {
      destination_name: "Scottsdale",
      trip_name: "BBMI 2026",
      trip_id: "trip-notif-1",
    },
    created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    read: true,
  },
  {
    id: "notif-3",
    type: "dates_locked",
    trip_id: "trip-notif-1",
    actor_id: "user-test-001",
    payload: {
      date_range: "Sep 15 – 20",
      trip_name: "BBMI 2026",
      trip_id: "trip-notif-1",
    },
    created_at: new Date(Date.now() - 86400000).toISOString(), // yesterday
    read: true,
  },
];

/** Build a tRPC batch response with a single result payload. */
function tRPCResult(data: unknown) {
  return [{ result: { data } }];
}

function setupMocks(page: import("@playwright/test").Page) {
  return page.route("**/*", async (route) => {
    const url = route.request().url();

    // Auth session mock
    if (url.includes("/auth/v1/token") || url.includes("/auth/v1/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock-token",
          token_type: "bearer",
          user: { id: MOCK_USER_ID, email: "test@example.com" },
        }),
      });
    }

    // tRPC calls
    if (url.includes("/api/trpc/")) {
      const input = new URL(url).searchParams.get("input");

      if (url.includes("users.getMe")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tRPCResult({ id: MOCK_USER_ID, name: "Test User" })),
        });
      }

      if (url.includes("trips.list")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tRPCResult(MOCK_TRIPS)),
        });
      }

      if (url.includes("notifications.list")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tRPCResult(MOCK_NOTIFICATIONS)),
        });
      }

      if (url.includes("notifications.markAllRead")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tRPCResult({ marked: 1 })),
        });
      }

      // Default: return empty for unknown tRPC calls
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(tRPCResult(null)),
      });
    }

    return route.continue();
  });
}

test.describe("Notification panel", () => {
  test("bell icon shows badge when unread notifications exist", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/dashboard");
    await page.waitForSelector('[data-testid="notification-bell"]');

    const badge = page.locator('[data-testid="notification-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("1"); // 1 unread notification
  });

  test("notification panel shows correct text for rsvp_response", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/dashboard");
    await page.click('[data-testid="notification-bell"]');

    const dropdown = page.locator('[data-testid="notification-dropdown"]');
    await expect(dropdown).toBeVisible();

    // Check rsvp_response notification text
    await expect(dropdown).toContainText("Mike is in for BBMI 2026");
  });

  test("notification panel shows correct text for destination_locked", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/dashboard");
    await page.click('[data-testid="notification-bell"]');

    const dropdown = page.locator('[data-testid="notification-dropdown"]');
    await expect(dropdown).toContainText("BBMI 2026 destination is set");
  });

  test("clicking notification navigates to correct trip", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/dashboard");
    await page.click('[data-testid="notification-bell"]');

    // Click the first notification (rsvp_response)
    const firstNotif = page.locator('[data-testid="notification-dropdown"] button').first();
    // Wait for navigation on click — note it may not fully load due to mocks
    await firstNotif.click();
    await page.waitForURL(/\/trips\/trip-notif-1/);
    expect(page.url()).toContain("/trips/trip-notif-1");
  });

  test("empty state shows when no notifications", async ({ page }) => {
    // Override notifications to return empty
    await page.route("**/*", async (route) => {
      const url = route.request().url();

      if (url.includes("/auth/v1/token") || url.includes("/auth/v1/user")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "mock-token",
            token_type: "bearer",
            user: { id: MOCK_USER_ID, email: "test@example.com" },
          }),
        });
      }

      if (url.includes("/api/trpc/")) {
        if (url.includes("users.getMe")) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(tRPCResult({ id: MOCK_USER_ID, name: "Test User" })),
          });
        }
        if (url.includes("trips.list")) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(tRPCResult(MOCK_TRIPS)),
          });
        }
        if (url.includes("notifications.list")) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(tRPCResult([])),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tRPCResult(null)),
        });
      }

      return route.continue();
    });

    await page.goto("/dashboard");
    await page.click('[data-testid="notification-bell"]');

    const dropdown = page.locator('[data-testid="notification-dropdown"]');
    await expect(dropdown).toContainText("No notifications yet");
  });
});
