import { test, expect } from "@playwright/test";

test.describe("RSVP system", () => {
  test("login page renders without errors (smoke test)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("BuddyTrip")).toBeVisible();
  });
});
