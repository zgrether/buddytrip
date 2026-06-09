import { test, expect, type Page } from "@playwright/test";

/**
 * Stroke-play game (Slice A) — happy path: create → enter all 18 holes for 4
 * players → finish → final standings with a tie at position 2.
 *
 * ⚠️ DEFERRED (Issue #29): Playwright is NOT run in CI yet — it needs the
 * auth-redirect fix + global-setup. This spec is authored to the same mocked
 * pattern as the other e2e specs and joins the deferred set; it will run once
 * the e2e infra lands. Authored without a local run, so it may need a tweak
 * then. The scoring logic itself (ranking, 1-2-2-4 ties) is covered by the
 * Vitest router + unit tests, which DO run in CI.
 */

const MOCK_USER_ID = "user-test-001";
// UUID-shaped so the route param skips slug resolution (used directly).
const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const GAME_ID = "game-e2e-001";

const MEMBERS = [
  { user_id: "u1", displayName: "Ann", user: { id: "u1", name: "Ann" }, role: "Owner", status: "in" },
  { user_id: "u2", displayName: "Ben", user: { id: "u2", name: "Ben" }, role: "Member", status: "in" },
  { user_id: "u3", displayName: "Cal", user: { id: "u3", name: "Cal" }, role: "Member", status: "in" },
  { user_id: "u4", displayName: "Dee", user: { id: "u4", name: "Dee" }, role: "Member", status: "in" },
];

const GAME = {
  id: GAME_ID,
  trip_id: TRIP_ID,
  competition_id: null,
  game_type_id: "gtt_stroke_play",
  name: null,
  status: "pending",
};

const PARTICIPANTS = MEMBERS.map((m, i) => ({
  id: `p${i}`,
  game_id: GAME_ID,
  user_id: m.user_id,
  play_group_id: null,
  team_id: null,
}));

// Final standings — Ben & Cal tie at position 2.
const STANDINGS = [
  { entityId: "u1", rawScore: 72, position: 1 },
  { entityId: "u2", rawScore: 90, position: 2 },
  { entityId: "u3", rawScore: 90, position: 2 },
  { entityId: "u4", rawScore: 108, position: 4 },
];

async function setupMocks(page: Page) {
  await Promise.all([
    page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: MOCK_USER_ID, email: "alice@example.com" }) });
      } else if (url.includes("/token") || url.includes("/session")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-token", user: { id: MOCK_USER_ID, email: "alice@example.com" } }) });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();
      const send = (data: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ result: { data } }]) });

      if (url.includes("tripMembers.list")) return send(MEMBERS);
      if (url.includes("games.addParticipants")) return send(PARTICIPANTS);
      if (url.includes("games.create")) return send(GAME);
      if (url.includes("games.finish")) return send({ standings: STANDINGS });
      if (url.includes("scores.upsertEntry")) return send({ id: "se", value: 5, participant_type: "user" });
      if (url.includes("scores.deleteEntry")) return send({ ok: true });

      // Unmatched batch — return one null per batched call so the count matches.
      const m = url.match(/input=([^&]+)/);
      let count = 1;
      if (m) {
        try {
          count = Object.keys(JSON.parse(decodeURIComponent(m[1]))).length || 1;
        } catch {
          count = 1;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(Array.from({ length: count }, () => ({ result: { data: null } }))),
      });
    }),
  ]);
}

test.describe("Stroke-play game (Slice A)", () => {
  test("create → enter all 18 holes → finish → standings with a tie", async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/trips/${TRIP_ID}/games/new`);

    // Pick 4 players, then start.
    for (const name of ["Ann", "Ben", "Cal", "Dee"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("button", { name: "Start game" }).click();

    // Entry view (count + label from scorecard_schema, not a hardcoded literal).
    await expect(page.getByText("Hole 1 of 18")).toBeVisible();

    // Enter every hole for all 4 players. The value is irrelevant — finish is
    // mocked — we just need all cells filled to reveal the Finish CTA.
    for (let h = 1; h <= 18; h++) {
      for (let p = 0; p < 4; p++) {
        await page.getByRole("button", { name: "Score 5" }).click();
        await page.getByRole("button", { name: "Confirm score" }).click();
      }
      if (h < 18) {
        await page.getByRole("button", { name: new RegExp(`^Hole ${h + 1}`) }).click();
      }
    }

    await page.getByRole("button", { name: "Finish" }).click();

    // Final screen — tie at position 2 rendered on both tied cards.
    await expect(page.getByText("Game over")).toBeVisible();
    await expect(page.getByText("Tied for 2nd")).toHaveCount(2);
  });
});
