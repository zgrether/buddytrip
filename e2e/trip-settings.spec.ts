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
  test("owner drills into Trip details and edits the name", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Open settings → master menu
    const settingsBtn = page.getByTestId("trip-settings-btn");
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Drill into Trip details
    await page.getByTestId("settings-details-row").click();

    // Name input pre-filled; Save disabled until dirty
    const nameInput = page.getByTestId("settings-trip-name");
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue("BBMI 2026");
    const saveBtn = page.getByTestId("settings-save-details-btn");
    await expect(saveBtn).toBeDisabled();

    // Editing the name enables Save
    await nameInput.fill("BBMI 2027");
    await expect(saveBtn).toBeEnabled();
  });

  test("owner sees all menu sections", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();

    // Grouped master menu
    await expect(page.getByText("Trip plan")).toBeVisible();
    await expect(page.getByText("Trip management")).toBeVisible();
    await expect(page.getByText("Danger zone")).toBeVisible();

    // Rows
    await expect(page.getByTestId("settings-details-row")).toBeVisible();
    await expect(page.getByTestId("settings-transfer-row")).toBeVisible();
    await expect(page.getByTestId("settings-delete-row")).toBeVisible();
  });

  test("owner drills into Trip dates and sees the calendar", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();
    await page.getByTestId("settings-details-row").click();

    // The dates chip drills into a separate Trip dates screen with the calendar.
    await page.getByTestId("settings-dates-chip").click();
    await expect(page.getByText("Trip dates")).toBeVisible();
    await expect(page.getByTestId("settings-set-dates-btn")).toBeVisible();
    // Inline range calendar renders day cells.
    await expect(page.locator('[data-testid^="settings-day-"]').first()).toBeVisible();

    // Set dates is disabled until the range actually changes.
    await expect(page.getByTestId("settings-set-dates-btn")).toBeDisabled();
  });

  test("owner drills into Transfer ownership and sees crew", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();
    await page.getByTestId("settings-transfer-row").click();

    // Crew (excluding the current owner)
    await expect(page.getByText("Bill Smith")).toBeVisible();
    await expect(page.getByText("Buddy Jones")).toBeVisible();

    // Confirm disabled until a selection is made
    await expect(page.getByTestId("settings-confirm-transfer-btn")).toBeDisabled();
  });

  test("owner reaches the delete confirm screen", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByTestId("trip-settings-btn").click();
    await page.getByTestId("settings-delete-row").click();

    // Destructive confirm step — never fires directly from the menu row.
    await expect(page.getByText("Delete this trip?")).toBeVisible();
    await expect(page.getByTestId("settings-confirm-delete-btn")).toBeVisible();
  });
});

test.describe("TripSettings — planner view", () => {
  test("planner sees Trip details only (no management or danger zone)", async ({ page }) => {
    // Planner is user-002
    await setupMocks(page, "user-002");
    await page.goto(`/trips/${TRIP_ID}`);

    const settingsBtn = page.getByTestId("trip-settings-btn");
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Planners can edit the plan → Trip details row is present
    await expect(page.getByTestId("settings-details-row")).toBeVisible();

    // Owner-only sections are hidden for planners
    await expect(page.getByTestId("settings-transfer-row")).toHaveCount(0);
    await expect(page.getByText("Danger zone")).toHaveCount(0);
  });
});
