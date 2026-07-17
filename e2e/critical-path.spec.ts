import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Critical-path E2E (the merge-blocking gate) — the GAME-SCORING SPINE, driven
 * through the real UI as the logged-in owner (storageState from auth.setup.ts).
 *
 * Honestly scoped: the trip + crew are SEEDED via the admin client (fast, stable
 * scaffolding — not the thing under test); the spine that's actually walked is
 * **create a stroke-play game → enter scores → the scorecard reflects them**.
 * That's the class of break unit tests miss and that's bitten this project:
 * an unreachable setup state, a dead scorecard button, a score that doesn't
 * surface. The fuller competition-run-to-leaderboard walk on real data is the
 * BBMI-replay follow-on (a heavier acceptance test, not this per-push smoke).
 *
 * Runs against the remote project (same model as the vitest suite): a UNIQUE
 * trip per run + full teardown, so reruns never collide and nothing is left.
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
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name },
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

  // Unique trip per run (vitest isolation pattern). Owner + one member so the
  // stroke game's 2–4-player picker has two crew to pick.
  tripId = `e2e-trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: tErr } = await admin.from("trips").insert({ id: tripId, title: "E2E Critical Path" });
  if (tErr) throw new Error(`seed trip failed: ${tErr.message}`);
  // Trip-scoped nicknames make the player picker deterministic regardless of the
  // shared users' account names (which drift as other tests rename them) — and
  // they mutate nothing outside this throwaway trip.
  const { error: mErr } = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "E2E Owner" },
    { trip_id: tripId, user_id: memberId, role: "Member", status: "in", nickname: "E2E Member" },
  ]);
  if (mErr) throw new Error(`seed members failed: ${mErr.message}`);
});

test.afterAll(async () => {
  if (!admin || !tripId) return;
  // Tear down everything this run created — games (+ score_entries,
  // game_participants) then the trip + memberships. Bulletproof: explicit, and
  // ordered child-first so no FK blocks the delete.
  const { data: games } = await admin.from("games").select("id").eq("trip_id", tripId);
  for (const g of games ?? []) {
    await admin.from("score_entries").delete().eq("game_id", g.id);
    await admin.from("game_participants").delete().eq("game_id", g.id);
    await admin.from("games").delete().eq("id", g.id);
  }
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

test("scoring spine — stroke game: create → enter scores → scorecard reflects them", async ({ page }) => {
  // Each UI step here is a round-trip to the REMOTE DB (create, enable + a
  // follow-up game refetch, score writes), so give the whole spine generous
  // headroom over the 30s default — a slow round-trip shouldn't read as a break.
  test.setTimeout(60_000);

  // 1. New stroke-play game for this trip (owner is authenticated via storageState).
  await page.goto(`/trips/${tripId}/games/new`);

  // 2. Pick the two crew, start the game.
  await page.getByRole("button", { name: "E2E Owner", exact: true }).click();
  await page.getByRole("button", { name: "E2E Member", exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();

  // 3. Enable scoring → reach the score-entry view. The setup-mode scoreboard is a
  //    PASS-THROUGH (A2-ux correction): open the ONE settings page via the "set it up"
  //    button, then flip the Setup/Scoring toggle's Scoring segment. Draft-then-save (P2):
  //    the toggle STAGES go-live into the page's composite draft — SAVE commits it (one
  //    atomic save_game_config). The old "scoring-lock-banner" live-lock signal is GONE
  //    (the P2 lie-sweep removed the frozen-settings lock — settings stay editable when
  //    live); the "now live, transition complete" signal is now the draft clearing to
  //    "Saved" after the commit. Wait for it BEFORE leaving — Back on a still-dirty draft
  //    raises the discard prompt. Then the back arrow returns to the game page, now in
  //    scoring mode → the keypad mounts.
  await page.getByTestId("setup-go-to-settings").click();
  const scoringSeg = page.getByTestId("mode-scoring");
  await expect(scoringSeg).toBeEnabled({ timeout: 20_000 });
  await scoringSeg.click();
  const saveBtn = page.getByTestId("settings-save");
  await expect(saveBtn).toBeEnabled({ timeout: 20_000 });
  await saveBtn.click();
  await expect(page.getByTestId("settings-dirty-hint")).toHaveText("Saved", { timeout: 20_000 });
  await page.getByRole("button", { name: "Back" }).click();

  // 4. Enter hole 1 for both players (confirm auto-advances to the next player).
  //    Distinct values so the assertion can't pass on par/coincidence. Wait for
  //    each keypad key to be present before tapping rather than assuming it has
  //    already rendered (the view settles between players on each confirm).
  const score7 = page.getByRole("button", { name: "Score 7", exact: true });
  await expect(score7).toBeVisible({ timeout: 20_000 });
  await score7.click();
  await page.getByRole("button", { name: "Confirm score" }).click();

  const score3 = page.getByRole("button", { name: "Score 3", exact: true });
  await expect(score3).toBeVisible({ timeout: 20_000 });
  await score3.click();
  await page.getByRole("button", { name: "Confirm score" }).click();

  // 5. Open the review scorecard and assert BOTH entered scores surface in the
  //    EXACT right cells (keyed by participant id = user id, hole "1") — "a score
  //    shows up where it should". Test-id selectors, not brittle text.
  await page.getByRole("button", { name: "Scorecard", exact: true }).click();

  await expect(page.getByTestId(`score-cell-${ownerId}-1`)).toHaveText("7");
  await expect(page.getByTestId(`score-cell-${memberId}-1`)).toHaveText("3");
});
