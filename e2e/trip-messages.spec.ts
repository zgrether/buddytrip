import { test, expect } from "@playwright/test";

/**
 * TripMessages E2E — happy path
 *
 * Tests the trip messages screen at /trips/[tripId]/messages
 */

const MOCK_USER_ID = "user-test-001";
const TRIP_ID = "trip-msg-test-001";
const EVENT_ID = "event-001";
const TEAM_ID = "team-eu-001";

const MOCK_MESSAGES_TRIP = [
  {
    id: "msg-001",
    trip_id: TRIP_ID,
    user_id: "user-002",
    channel: "trip",
    team_id: null,
    text: "Hey everyone, excited for the trip!",
    created_at: "2026-06-14T09:00:00.000Z",
  },
  {
    id: "msg-002",
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    channel: "trip",
    team_id: null,
    text: "Can't wait!",
    created_at: "2026-06-14T09:01:00.000Z",
  },
];

const MOCK_MESSAGES_TEAM = [
  {
    id: "msg-003",
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    channel: "team",
    team_id: TEAM_ID,
    text: "Team strategy: play aggressive on day 1",
    created_at: "2026-06-14T10:00:00.000Z",
  },
];

const MOCK_MEMBERS = [
  {
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    role: "Owner",
    status: "in",
    user: { id: MOCK_USER_ID, name: "Alice", email: "alice@example.com" },
  },
  {
    trip_id: TRIP_ID,
    user_id: "user-002",
    role: "Member",
    status: "in",
    user: { id: "user-002", name: "Bob", email: "bob@example.com" },
  },
];

const MOCK_EVENT = {
  id: EVENT_ID,
  trip_id: TRIP_ID,
  title: "The Presidents Cup",
  location: "Pebble Beach, CA",
  dates: "Jun 15–18, 2026",
};

const MOCK_TEAMS = [
  {
    id: TEAM_ID,
    event_id: EVENT_ID,
    name: "Europe",
    short_name: "EUR",
    color: "#3b82f6",
    color_dim: "#1e3a8a",
  },
];

const MOCK_ASSIGNMENTS = [
  { event_id: EVENT_ID, team_id: TEAM_ID, user_id: MOCK_USER_ID },
];

async function setupMocks(page: import("@playwright/test").Page) {
  await Promise.all([
    page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: MOCK_USER_ID, email: "alice@example.com" }),
        });
      } else if (url.includes("/token") || url.includes("/session")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "mock-token",
            user: { id: MOCK_USER_ID, email: "alice@example.com" },
          }),
        });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();

      if (url.includes("messages.list")) {
        // Return team messages if teamId param is present, else trip messages
        const isTeam = url.includes("team");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: isTeam ? MOCK_MESSAGES_TEAM : MOCK_MESSAGES_TRIP,
              },
            },
          ]),
        });
        return;
      }

      if (url.includes("messages.send")) {
        const body = route.request().postDataJSON() as { text?: string }[];
        const input = Array.isArray(body) ? body[0] : body;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  id: "msg-new-001",
                  trip_id: TRIP_ID,
                  user_id: MOCK_USER_ID,
                  channel: "trip",
                  team_id: null,
                  text: (input as { text?: string })?.text ?? "Hello",
                  created_at: new Date().toISOString(),
                },
              },
            },
          ]),
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

      if (url.includes("events.getByTrip")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_EVENT } }]),
        });
        return;
      }

      if (url.includes("teams.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_TEAMS } }]),
        });
        return;
      }

      if (url.includes("teamAssignments.list")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_ASSIGNMENTS } }]),
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

test.describe("TripMessages", () => {
  test("renders heading and trip chat channel button", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    await expect(page.getByTestId("messages-heading")).toBeVisible();
    await expect(page.getByTestId("channel-trip")).toBeVisible();
  });

  test("shows trip chat messages in the message list", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    const list = page.getByTestId("message-list");
    await expect(list).toBeVisible();

    // Both messages should appear
    await expect(page.getByTestId("message-msg-001")).toBeVisible();
    await expect(page.getByTestId("message-msg-002")).toBeVisible();

    // Bob's message text
    await expect(page.getByText("Hey everyone, excited for the trip!")).toBeVisible();
    // Alice's (my) message
    await expect(page.getByText("Can't wait!")).toBeVisible();
  });

  test("shows team channel button for assigned team", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    // EUR team channel button should appear since user is assigned to that team
    await expect(page.getByTestId(`channel-team-${TEAM_ID}`)).toBeVisible();
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    const sendBtn = page.getByTestId("send-btn");
    await expect(sendBtn).toBeDisabled();
  });

  test("typing a message enables send button", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    const input = page.getByTestId("message-input");
    await input.fill("Hello team!");

    const sendBtn = page.getByTestId("send-btn");
    await expect(sendBtn).toBeEnabled();
  });

  test("sends message optimistically when send button clicked", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    const input = page.getByTestId("message-input");
    await input.fill("Test optimistic message");
    await page.getByTestId("send-btn").click();

    // Optimistic message should appear in the list immediately
    await expect(page.getByText("Test optimistic message")).toBeVisible();

    // Input should be cleared
    await expect(input).toHaveValue("");
  });

  test("pressing Enter sends the message", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    const input = page.getByTestId("message-input");
    await input.fill("Enter key send test");
    await input.press("Enter");

    await expect(page.getByText("Enter key send test")).toBeVisible();
    await expect(input).toHaveValue("");
  });

  test("switching to team channel shows team messages", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/messages`);

    // Switch to EUR team channel
    await page.getByTestId(`channel-team-${TEAM_ID}`).click();

    // Team message should be visible
    await expect(
      page.getByText("Team strategy: play aggressive on day 1")
    ).toBeVisible();
  });
});
