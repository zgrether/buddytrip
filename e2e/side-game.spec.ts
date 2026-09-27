import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SIDE-GAME SPINE (merge-blocking) — PR 6's definition of done: a game on a trip
 * with NO competition goes the whole way, through the real UI as the owner.
 *
 *   create (Games tab → Add a game) → set up (group the players) → go live
 *   (Scoring + Save) → the board shows it Ready → score → it shows Live →
 *   finalize → it shows in Completed with its WINNER, never team zeros.
 *
 * Written after a look found a side game could not be taken live. It could — the
 * save landed (verified in production) — but every "tell the board" call in the
 * game views was `if (competitionId)`, so the Games page kept its cached
 * "New · Tap to set up" row and the game read as stuck. A server test passes
 * against that bug; only the assembled screen shows it, which is why this is an
 * E2E and why it waits on the ROW, not on the database.
 *
 * Scaffolding is seeded (the trip, the crew, the scores for holes 2–18 — the
 * keypad is covered by the stroke spine); what is walked is every screen a side
 * game passes through. A unique trip per run, torn down after.
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
const MEMBER_EMAIL = "test-member@buddytrip.app";
const PASSWORD = "BuddyTripTest2026!";

let admin: SupabaseClient;
let tripId: string;
let ownerId: string;
let memberId: string;

async function ensureUser(email: string, name: string): Promise<string> {
  const { data: list, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const found = list?.users?.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error: createErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name },
  });
  if (createErr || !data.user) throw new Error(`createUser ${email} failed: ${createErr?.message}`);
  return data.user.id;
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  admin = createClient(url, key);
  ownerId = await ensureUser(OWNER_EMAIL, "Test Owner");
  memberId = await ensureUser(MEMBER_EMAIL, "Test Member");

  // A PLACED trip (the Games tab unlocks on a destination) with NO competition —
  // the whole point. Trip nicknames keep names deterministic whatever the shared
  // accounts are called; the winner line reads the trip display name.
  tripId = `e2e-side-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: tErr } = await admin
    .from("trips")
    .insert({ id: tripId, title: "E2E Side Game", locked_destination_title: "E2E Links" });
  if (tErr) throw new Error(`seed trip failed: ${tErr.message}`);
  const { error: mErr } = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "E2E Owner" },
    { trip_id: tripId, user_id: memberId, role: "Member", status: "in", nickname: "E2E Member" },
  ]);
  if (mErr) throw new Error(`seed members failed: ${mErr.message}`);
});

test.afterAll(async () => {
  if (!admin || !tripId) return;
  const { data: games } = await admin.from("games").select("id").eq("trip_id", tripId);
  for (const g of games ?? []) {
    await admin.from("game_results").delete().eq("game_id", g.id);
    await admin.from("score_entries").delete().eq("game_id", g.id);
    await admin.from("game_participants").delete().eq("game_id", g.id);
    await admin.from("play_groups").delete().eq("game_id", g.id);
    await admin.from("games").delete().eq("id", g.id);
  }
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

test("side game spine — create → set up → live → score → finalize → winner in Completed", async ({ page }) => {
  test.setTimeout(120_000);
  const title = "E2E Practice Round";

  // 1. The Games tab on a trip with no competition: the invitation to start one
  //    (owner), and the games list's own empty state.
  await page.goto(`/trips/${tripId}?view=cup`);
  await expect(page.getByTestId("start-competition-card")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("comp-games-empty-cta").click();

  // 2. Add a game — no "counts toward" (there is no competition to count
  //    toward), golf formats only.
  await expect(page.getByTestId("counts-toward")).toHaveCount(0);
  await page.getByRole("button", { name: "Stroke Play", exact: true }).click();
  await page.getByPlaceholder("e.g. Day 1 Scramble").fill(title);
  await page.getByTestId("save-game").click();

  // 3. It lands in the sections as a SIDE game, New.
  const row = page.getByTestId("open-game-panel").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByTestId("side-game-tag")).toBeVisible();
  await expect(page.getByTestId("games-section-skeleton")).toContainText(title);
  await row.click();

  // 4. Set up: group both players. A side game has no points — no Total Points
  //    stepper, no Point Distribution, no BOARD roll-up (ruling 27).
  await page.getByTestId("row-groupings").click();
  await page.getByRole("button", { name: "Add group" }).click();
  await page.getByRole("button", { name: "Add player" }).click();
  await page.getByRole("button", { name: "E2E Owner" }).click();
  await page.getByRole("button", { name: "E2E Member" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("total-points-stepper")).toHaveCount(0);
  await expect(page.getByTestId("row-point-distribution")).toHaveCount(0);

  // 5. Go live: Scoring + Save. A landed save closes the settings.
  const scoringSeg = page.getByTestId("mode-scoring");
  await expect(scoringSeg).toBeEnabled({ timeout: 20_000 });
  await scoringSeg.click();
  const saveBtn = page.getByTestId("settings-save");
  await expect(saveBtn).toBeEnabled({ timeout: 20_000 });
  await saveBtn.click();
  await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

  // 6. THE BUG THIS SPEC EXISTS FOR: the board must say the game is live-ready.
  //    Before the fix the save landed and the row stayed "New · Tap to set up",
  //    because nothing told the side board. Assert the ROW, not the database.
  await expect(row).toContainText("Ready to play", { timeout: 20_000 });
  await expect(page.getByTestId("games-section-ready")).toContainText(title);

  // 7. Score hole 1 for both through the keypad.
  await row.click();
  await page.getByTestId("group-enter-row").first().click();
  for (let i = 0; i < 2; i++) {
    const four = page.getByRole("button", { name: "Score 4", exact: true });
    await expect(four).toBeVisible({ timeout: 20_000 });
    await four.click();
    await page.getByRole("button", { name: "Confirm score" }).click();
  }

  // 8. Back on the board it reads LIVE — a side game has no score broadcast, so
  //    this is the board refetching on reveal.
  await page.goto(`/trips/${tripId}?view=cup`);
  await expect(page.getByTestId("games-section-on-tap")).toContainText(title, { timeout: 20_000 });

  // 9. Holes 2–18 seeded (keypad already proven above): the owner shoots 4s, the
  //    member 5s, so the owner wins outright.
  const { data: game } = await admin.from("games").select("id").eq("trip_id", tripId).eq("name", title).single();
  const gameId = (game as { id: string }).id;
  const rows = [
    ...Array.from({ length: 17 }, (_, i) => ({ participant_id: ownerId, unit_label: String(i + 2), value: 4, submitted_by: ownerId })),
    ...Array.from({ length: 17 }, (_, i) => ({ participant_id: memberId, unit_label: String(i + 2), value: 5, submitted_by: memberId })),
  ].map((r) => ({ id: `e2e-se-${gameId}-${r.participant_id}-${r.unit_label}`, game_id: gameId, participant_type: "user", ...r }));
  const { error: seErr } = await admin.from("score_entries").insert(rows);
  if (seErr) throw new Error(`seed scores failed: ${seErr.message}`);

  // 10. Finalize from the game.
  await page.getByTestId("open-game-panel").filter({ hasText: title }).click();
  const finalize = page.getByTestId("game-finalize").getByRole("button");
  await expect(finalize).toBeEnabled({ timeout: 30_000 });
  await finalize.click();

  // 11. Completed, with the WINNER — never team zeros (a side game has no teams).
  await page.goto(`/trips/${tripId}?view=cup`);
  const completed = page.getByTestId("games-section-completed");
  await expect(completed).toContainText(title, { timeout: 20_000 });
  await expect(completed.getByTestId("side-game-winners")).toContainText("E2E Owner");
});
