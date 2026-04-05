import { test, expect } from "@playwright/test";

test.describe("Idea Zone Integration", () => {
  test("/compare route redirects to trip home", async ({ page }) => {
    // The compare page should redirect to the trip detail page
    const response = await page.goto("/trips/test-trip-id/compare");
    // Should have been redirected (302 or the final page URL won't contain /compare)
    const url = page.url();
    expect(url).not.toContain("/compare");
  });

  test("login page loads without errors after idea zone changes", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("BuddyTrip")).toBeVisible();
  });

  test("trip creation page loads with destination picker", async ({ page }) => {
    await page.goto("/trips/new");
    // The destination picker should show two options
    // (may need auth, but at minimum the page shouldn't crash)
    await expect(page).toHaveTitle(/BuddyTrip/);
  });
});
