import { test, expect } from "@playwright/test";

/**
 * Smoke tests for the Itinerary Panel on the Home tab.
 *
 * The aggregation/sorting/bucketing logic is exhaustively tested in the
 * Vitest unit suite (`src/app/trips/[tripId]/components/itinerary.test.ts`).
 * These tests verify the route loads without runtime errors after the panel
 * was added to HomeTab.
 */
test.describe("Itinerary Panel smoke", () => {
  test("trip detail page loads (or redirects to login) without crashing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/trips/test-trip-id");

    // Either we hit the trip page or we are bounced to login — both are fine
    // as long as there are no uncaught exceptions from the panel render.
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("login page loads without errors after itinerary panel changes", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/login");
    await expect(page.getByText("BuddyTrip")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
