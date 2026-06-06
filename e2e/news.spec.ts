import { test, expect } from "@playwright/test";

/**
 * News (the Trip Board) E2E — happy path for PR4.
 *
 * Covers the rich-text renderer (heading block + bold/link/mention segments)
 * end-to-end in a real browser, and the composer's PR4 affordances (the
 * rich-text toolbar + the Heading block). Authoring-level interactions
 * (typing, execCommand bold, the @ dropdown) are intentionally NOT simulated
 * here — contentEditable + execCommand are flaky under headless; that path is
 * covered by the Vitest segment round-trip (src/server/routers/news.test.ts)
 * and manual verification. This spec asserts the stable, high-value surface:
 * the read renderer and the composer's controls.
 */

const MOCK_USER_ID = "user-test-001";
const TRIP_ID = "news-e2e-trip-001";

const MOCK_TRIP = {
  id: TRIP_ID,
  title: "Scotland Golf Adventure",
  description: "Epic links golf trip",
  location: "St Andrews, Scotland",
  start_date: new Date(Date.now() + 30 * 86400000).toISOString(),
  end_date: new Date(Date.now() + 37 * 86400000).toISOString(),
  locked_destination_title: null,
  locked_destination_location: null,
  locked_destination_at: null,
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
};

const MOCK_MEMBERS = [
  {
    id: "member-001",
    trip_id: TRIP_ID,
    user_id: MOCK_USER_ID,
    role: "Owner",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: MOCK_USER_ID, name: "Test User", nickname: null, email: "test@example.com", is_guest: false },
    memberId: MOCK_USER_ID,
    isGuest: false,
    displayName: "Test User",
  },
  {
    id: "member-002",
    trip_id: TRIP_ID,
    user_id: "user-002",
    role: "Member",
    status: "in",
    joined_at: new Date().toISOString(),
    user: { id: "user-002", name: "Jane Doe", nickname: null, email: "jane@example.com", is_guest: false },
    memberId: "user-002",
    isGuest: false,
    displayName: "Jane Doe",
  },
];

// A post exercising every PR4 capability: heading + bold run + link + mention.
const NEWS_POST = {
  id: "news-001",
  tripId: TRIP_ID,
  authorId: MOCK_USER_ID,
  pinned: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  blocks: [
    { type: "heading", text: "Saturday — Championship Day" },
    {
      type: "text",
      segments: [
        "Meet at the ",
        { text: "first tee", bold: true },
        " — details ",
        { link: "https://buddytrip.app/tee", text: "here" },
        " — nice work ",
        { mention: { userId: "user-002", name: "Jane Doe", initials: "JD", color: null } },
        "!",
      ],
    },
  ],
};

const ROSTER = [
  { userId: MOCK_USER_ID, name: "Test User", initials: "TU", color: null, avatarIcon: null, placeholder: false },
  { userId: "user-002", name: "Jane Doe", initials: "JD", color: null, avatarIcon: null, placeholder: false },
];

function reply(data: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify([{ result: { data } }]) };
}

async function setupMocks(page: import("@playwright/test").Page) {
  await page.route("**/auth/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/user")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: MOCK_USER_ID, email: "test@example.com", user_metadata: { name: "Test User" } }),
      });
    } else if (url.includes("/token") || url.includes("/session")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "mock-token", user: { id: MOCK_USER_ID, email: "test@example.com" } }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route("**/api/trpc/**", async (route) => {
    const url = route.request().url();
    const match = (name: string) => url.includes(name);

    if (match("trips.getById")) return route.fulfill(reply(MOCK_TRIP));
    if (match("tripMembers.list")) return route.fulfill(reply(MOCK_MEMBERS));
    if (match("news.list")) return route.fulfill(reply([NEWS_POST]));
    if (match("news.unreadCount")) return route.fulfill(reply(0));
    if (match("news.readState")) return route.fulfill(reply({ lastReadAt: new Date().toISOString() }));
    if (match("news.markRead")) return route.fulfill(reply({ lastReadAt: new Date().toISOString() }));
    if (match("news.roster")) return route.fulfill(reply(ROSTER));
    if (match("news.competitionDraw")) return route.fulfill(reply(null));
    if (match("datePoll.get")) return route.fulfill(reply({ id: "poll-1", windows: [] }));
    if (match("events.getByTrip")) return route.fulfill(reply(null));

    // Any other list-style query the trip page pulls needs an array (it maps
    // over the result); everything else can be null.
    return route.fulfill(reply(match(".list") ? [] : null));
  });
}

test.describe("News — rich-text rendering + composer (PR4)", () => {
  test("renders a heading, bold run, link and mention in a post", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    // Open the News panel from the title-bar tool button.
    await page.getByRole("button", { name: "News", exact: true }).click();

    // Heading block → an <h3>.
    await expect(
      page.getByRole("heading", { name: "Saturday — Championship Day" }).first()
    ).toBeVisible();

    // Bold run renders as a 700-weight span.
    const bold = page.getByText("first tee", { exact: true }).first();
    await expect(bold).toBeVisible();
    await expect(bold).toHaveCSS("font-weight", "700");

    // Link segment renders as an anchor that keeps its href.
    const link = page.getByRole("link", { name: "here" }).first();
    await expect(link).toHaveAttribute("href", "https://buddytrip.app/tee");

    // Mention renders as an inline pill carrying the person's name.
    await expect(page.getByText("Jane Doe").first()).toBeVisible();
  });

  test("composer exposes the rich-text toolbar and the Heading block", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}`);

    await page.getByRole("button", { name: "News", exact: true }).click();
    await page.getByTestId("news-new-post").first().click();

    // Rich-text toolbar (bold · italic · link · @) + the editable area.
    await expect(page.getByRole("button", { name: "Bold" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Italic" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add link" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mention crew" }).first()).toBeVisible();
    await expect(page.getByTestId("news-richtext").first()).toBeVisible();

    // Heading is an addable block; adding it reveals the title input.
    await page.getByRole("button", { name: "Heading" }).first().click();
    await expect(page.getByPlaceholder("Section title…").first()).toBeVisible();
  });
});
