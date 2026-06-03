import { test, expect } from "@playwright/test";

/**
 * TripSettings E2E — happy paths
 *
 * Covers: owner rename flow, owner transfer ownership flow,
 * planner view (dimmed management rows).
 */

const MOCK_USER_ID = "user-settings-001";
const TRIP_ID = "trip-settings-test-001";

const MOCK_TRIP = {
  id: TRIP_ID,
  title: "BBMI 2026",
  description: "Annual golf trip",
  location: "Gulf Shores, AL",
  start_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  end_date: new Date(Date.now() + 37 * 86400000).toISOString().slice(0, 10),
  locked_destination_title: "Gulf Shores",
  locked_destination_location: "Gulf Shores, AL",
  locked_destination_at: new Date().toISOString(),
  event_id: null,
  series_id: null,
  cost_tier: null,
  image_url: null,
  accommodation: null,
  notes: null,
  activities: [],
  golf_courses: [],
  comparison_mode: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_MEMBERS = [
  {
    id: "member-001",
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    role: "Owner",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: MOCK_USER_ID, name: "Zach Grether", nickname: "Zach", email: "zach@example.com", is_guest: false },
    memberId: MOCK_USER_ID,
    isGuest: false,
    displayName: "Zach",
  },
  {
    id: "member-002",
    trip_id: TRIP_ID,
    user_id: "user-002",
    role: "Planner",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: "user-002", name: "Bill Smith", nickname: null, email: "bill@example.com", is_guest: false },
    memberId: "user-002",
    isGuest: false,
    displayName: "Bill Smith",
  },
  {
    id: "member-003",
    trip_id: TRIP_ID,
    user_id: "user-003",
    role: "Member",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: "user-003", name: "Buddy Jones", nickname: null, email: "buddy@example.com", is_guest: false },
    memberId: "user-003",
    isGuest: false,
    displayName: "Buddy Jones",
  },
];

function setupMocks(
  page: import("@playwright/test").Page,
  userId = MOCK_USER_ID,
  tripData = MOCK_TRIP,
) {
  return Promise.all([
    // Auth
    page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: userId,
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
            user: { id: userId, email: "test@example.com" },
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

      if (url.includes("trips.renameTripName")) {
        const newName = "Renamed Trip";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: { id: TRIP_ID, name: newName } } }]),
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

      // All other tRPC calls return empty data
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: null } }]),
      });
    }),
  ]);
}

test.describe("TripSettings — owner flows", () => {
  test("owner opens settings and renames trip", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Open settings
    const settingsBtn = page.getByTestId("trip-settings-btn");
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Trip name input should be visible with current name
    const nameInput = page.getByTestId("settings-trip-name");
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue("BBMI 2026");

    // Rename button should be disabled (no change yet)
    const renameBtn = page.getByTestId("settings-rename-btn");
    await expect(renameBtn).toBeDisabled();

    // Change the name
    await nameInput.fill("BBMI 2027");
    await expect(renameBtn).toBeEnabled();
  });

  test("owner sees all management sections", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();

    // Should see trip management section
    await expect(page.getByText("Trip management")).toBeVisible();

    // Transfer, Save, Delete buttons should be visible
    await expect(page.getByTestId("settings-transfer-btn")).toBeVisible();
    await expect(page.getByTestId("settings-save-trip-btn")).toBeVisible();
    await expect(page.getByTestId("settings-delete-btn")).toBeVisible();

    // Danger zone label should be visible
    await expect(page.getByText("Danger zone")).toBeVisible();
  });

  test("owner picks a trip-date range with the DatePicker", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();

    // Expand the "Change dates" section, which now hosts the shared DatePicker.
    await page.getByTestId("settings-change-dates-btn").click();

    // Open the popover calendar.
    const trigger = page.getByTestId("settings-dates-picker");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Use a quick preset to fill a valid range, then commit with Apply.
    await dialog.getByText("This weekend").click();
    await dialog.getByRole("button", { name: "Apply" }).click();

    // The trigger now reflects the chosen range with a nights tag.
    await expect(trigger).toContainText("night");
  });

  test("owner can expand transfer ownership and see crew members", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();
    await page.getByTestId("settings-transfer-btn").click();

    // Should see crew members (excluding current owner)
    await expect(page.getByText("Bill Smith")).toBeVisible();
    await expect(page.getByText("Buddy Jones")).toBeVisible();

    // Current owner should NOT be in the list
    await expect(page.getByText("Zach")).not.toBeVisible();

    // Confirm button should be disabled until selection
    await expect(page.getByTestId("settings-confirm-transfer-btn")).toBeDisabled();
  });
});

test.describe("TripSettings — planner view", () => {
  test("planner sees name input but dimmed management rows", async ({ page }) => {
    // Planner is user-002
    await setupMocks(page, "user-002");
    await page.goto(`/trips/${TRIP_ID}`);

    const settingsBtn = page.getByTestId("trip-settings-btn");
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Name input should be visible (planners can rename)
    await expect(page.getByTestId("settings-trip-name")).toBeVisible();
    await expect(page.getByTestId("settings-rename-btn")).toBeVisible();

    // Management rows should show "These actions require owner access"
    await expect(page.getByText("These actions require owner access")).toBeVisible();

    // Danger zone should NOT be visible for planner
    await expect(page.getByText("Danger zone")).not.toBeVisible();
  });
});
