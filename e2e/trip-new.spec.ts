import { test, expect } from "@playwright/test";

const MOCK_USER = { id: "user-search-1", name: "Alice Smith", email: "alice@example.com" };
const NEW_TRIP_ID = "trip-new-test-001";

test.describe("TripNew wizard", () => {
  test.beforeEach(async ({ page }) => {
    // Mock crypto.randomUUID to return predictable ID
    await page.addInitScript(() => {
      (crypto as { randomUUID: () => string }).randomUUID = () => "trip-new-test-001";
    });

    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      if (url.includes("users.search")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: [MOCK_USER] } }]),
        });
        return;
      }
      if (url.includes("trips.create")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  id: NEW_TRIP_ID,
                  title: "Scotland Golf Adventure",
                  created_at: new Date().toISOString(),
                },
              },
            },
          ]),
        });
        return;
      }
      if (url.includes("tripMembers.add")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: { trip_id: NEW_TRIP_ID } } }]),
        });
        return;
      }
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
  });

  test("step 1: name input and invite flow", async ({ page }) => {
    await page.goto("/trips/new");

    // Step 1 should be visible
    await expect(page.locator('[data-testid="trip-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="step1-next"]')).toBeDisabled();

    // Type a name
    await page.locator('[data-testid="trip-name-input"]').fill("Scotland Golf Adventure");
    await expect(page.locator('[data-testid="step1-next"]')).toBeEnabled();

    // Search for a co-planner
    await page.locator('[data-testid="invite-search"]').fill("alice@");
    await expect(
      page.locator(`[data-testid="search-result-${MOCK_USER.id}"]`)
    ).toBeVisible({ timeout: 5000 });

    // Add the invite
    await page.locator(`[data-testid="search-result-${MOCK_USER.id}"]`).click();
    await expect(
      page.locator(`[data-testid="invite-${MOCK_USER.id}"]`)
    ).toBeVisible();

    // Advance to step 2
    await page.locator('[data-testid="step1-next"]').click();
    await expect(page.locator('[data-testid="trip-location-input"]')).toBeVisible();
  });

  test("step 2: can go back to step 1", async ({ page }) => {
    await page.goto("/trips/new");
    await page.locator('[data-testid="trip-name-input"]').fill("Test Trip");
    await page.locator('[data-testid="step1-next"]').click();

    await expect(page.locator('[data-testid="trip-location-input"]')).toBeVisible();
    await page.locator('[data-testid="step2-back"]').click();
    await expect(page.locator('[data-testid="trip-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="trip-name-input"]')).toHaveValue("Test Trip");
  });

  test("happy path: create trip navigates to trip detail", async ({ page }) => {
    await page.goto("/trips/new");

    // Step 1
    await page.locator('[data-testid="trip-name-input"]').fill("Scotland Golf Adventure");
    await page.locator('[data-testid="step1-next"]').click();

    // Step 2
    await page.locator('[data-testid="trip-location-input"]').fill("St Andrews, Scotland");
    await page.locator('[data-testid="trip-start-date"]').fill("2026-09-01");
    await page.locator('[data-testid="trip-end-date"]').fill("2026-09-08");

    await page.locator('[data-testid="step2-create"]').click();

    // Should navigate to the new trip
    await expect(page).toHaveURL(new RegExp(`/trips/${NEW_TRIP_ID}`), {
      timeout: 10_000,
    });
  });
});
