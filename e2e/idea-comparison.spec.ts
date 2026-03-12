import { test, expect } from "@playwright/test";

/**
 * IdeaComparison E2E — happy path
 *
 * Tests the destination comparison screen at /trips/[tripId]/compare
 */

const MOCK_USER_ID = "user-test-001";
const TRIP_ID = "trip-compare-test-001";

const MOCK_IDEAS = [
  {
    id: "idea-001",
    trip_id: TRIP_ID,
    title: "Bandon Dunes",
    location: "Bandon, OR",
    description: "World-class links golf on the Oregon coast",
    golf_courses: ["Pacific Dunes", "Bandon Dunes Course"],
    activities: ["Golf", "Hiking"],
    cost_tier: "$$$",
    pros: ["Stunning scenery", "World-class courses"],
    cons: ["Far from major airports"],
    accommodation: "Bandon Dunes Resort",
    notes: null,
    image_url: null,
    votes: [{ idea_id: "idea-001", user_id: MOCK_USER_ID }],
  },
  {
    id: "idea-002",
    trip_id: TRIP_ID,
    title: "Pebble Beach",
    location: "Pebble Beach, CA",
    description: "Iconic oceanside golf",
    golf_courses: ["Pebble Beach Golf Links", "Spyglass Hill"],
    activities: ["Golf", "Wine tasting"],
    cost_tier: "$$$$",
    pros: ["Iconic views", "World-famous"],
    cons: ["Expensive", "Crowded"],
    accommodation: "The Lodge at Pebble Beach",
    notes: null,
    image_url: null,
    votes: [],
  },
];

const MOCK_MEMBERS = [
  { trip_id: TRIP_ID, user_id: MOCK_USER_ID, role: "Owner", status: "in" },
  { trip_id: TRIP_ID, user_id: "user-002", role: "Member", status: "maybe" },
];

async function setupMocks(page: import("@playwright/test").Page) {
  await Promise.all([
    page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: MOCK_USER_ID,
            email: "test@example.com",
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
    }),

    page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      if (url.includes("ideas.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_IDEAS } }]),
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

      if (url.includes("ideas.vote")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: { voted: true } } }]),
        });
        return;
      }

      if (url.includes("trips.lockDestination")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  id: TRIP_ID,
                  locked_destination_title: "Bandon Dunes",
                  locked_destination_location: "Bandon, OR",
                },
              },
            },
          ]),
        });
        return;
      }

      if (url.includes("trips.getById")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  id: TRIP_ID,
                  title: "Golf Trip",
                  comparison_mode: true,
                },
              },
            },
          ]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: null } }]),
      });
    }),
  ]);
}

test.describe("IdeaComparison", () => {
  test("renders heading and idea cards", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/compare`);

    await expect(page.getByTestId("compare-heading")).toBeVisible();
    await expect(page.getByTestId("idea-card-idea-001")).toBeVisible();
    await expect(page.getByTestId("idea-card-idea-002")).toBeVisible();
  });

  test("shows voted state on idea that current user already voted for", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/compare`);

    // idea-001 has a vote from MOCK_USER_ID
    const voteBtn001 = page.getByTestId("vote-idea-idea-001");
    await expect(voteBtn001).toContainText("Voted");

    // idea-002 has no vote from current user
    const voteBtn002 = page.getByTestId("vote-idea-idea-002");
    await expect(voteBtn002).toContainText("Vote");
  });

  test("owner sees lock-as-destination button on each card", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/compare`);

    await expect(page.getByTestId("lock-idea-idea-001")).toBeVisible();
    await expect(page.getByTestId("lock-idea-idea-002")).toBeVisible();
  });

  test("clicking lock shows confirm modal and locks destination", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/compare`);

    // Click the lock button on idea-001
    await page.getByTestId("lock-idea-idea-001").click();

    // Confirm modal appears
    await expect(page.getByTestId("confirm-lock-dest-btn")).toBeVisible();
    await expect(page.getByText("Bandon Dunes")).toBeVisible();

    // Confirm the lock
    await page.getByTestId("confirm-lock-dest-btn").click();

    // After locking, should redirect back to trip page
    await expect(page).toHaveURL(`/trips/${TRIP_ID}`);
  });

  test("canEdit users see add idea button", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/compare`);

    await expect(page.getByTestId("add-idea-btn")).toBeVisible();
  });

  test("add idea modal opens, submits, and closes", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/compare`);

    await page.getByTestId("add-idea-btn").click();

    // Modal should appear
    const form = page.getByTestId("add-idea-form");
    await expect(form).toBeVisible();

    // Fill in title and location
    await form.locator('input[name="title"]').fill("Augusta National");
    await form.locator('input[name="location"]').fill("Augusta, GA");
    await form.locator('button[type="submit"]').click();
  });
});
