import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Match-play E2E — the SECOND merge-blocking spine, alongside the stroke
 * critical-path. Match-play is the reference format the config-checklist + future
 * formats build on, so its core path gets a repeatable gate instead of by-hand
 * verification: **create a 1v1 match game → set the pairing → enter a hole → the
 * scorecard reflects it**, driven through the real UI as the logged-in owner
 * (storageState from auth.setup.ts).
 *
 * Standalone (no competition) on purpose: a 1v1 match with no competition pairs
 * from the whole trip crew, so the seed is the same minimal trip + 2 members as
 * the stroke spine — the match-specific surface (pairing builder, single-match
 * entry) is what's actually walked. Runs against the remote project; a UNIQUE
 * trip per run + full teardown.
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

  tripId = `e2e-mp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: tErr } = await admin.from("trips").insert({ id: tripId, title: "E2E Match Play" });
  if (tErr) throw new Error(`seed trip failed: ${tErr.message}`);
  // Trip-scoped nicknames make the player picker deterministic regardless of the
  // shared users' drifting account names.
  const { error: mErr } = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "MP Owner" },
    { trip_id: tripId, user_id: memberId, role: "Member", status: "in", nickname: "MP Member" },
  ]);
  if (mErr) throw new Error(`seed members failed: ${mErr.message}`);
});

test.afterAll(async () => {
  if (!admin || !tripId) return;
  const { data: games } = await admin.from("games").select("id").eq("trip_id", tripId);
  for (const g of games ?? []) {
    await admin.from("score_entries").delete().eq("game_id", g.id);
    await admin.from("game_matches").delete().eq("game_id", g.id);
    await admin.from("game_participants").delete().eq("game_id", g.id);
    await admin.from("games").delete().eq("id", g.id);
  }
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

/** Latest game in the trip (tests run serially; each makes one game). */
async function latestGameId(): Promise<string> {
  const { data } = await admin
    .from("games").select("id").eq("trip_id", tripId)
    .order("created_at", { ascending: false }).limit(1).single();
  return data!.id as string;
}
async function handicapByUser(gameId: string): Promise<Map<string, number>> {
  const { data } = await admin
    .from("game_participants").select("user_id, handicap_strokes").eq("game_id", gameId);
  return new Map((data ?? []).map((p) => [p.user_id as string, p.handicap_strokes as number]));
}

/** Drive a fresh 1v1 to fully-set-up-but-not-enabled: create → pair MP Owner (A)
 *  vs MP Member (B) → give MP Member a stroke via the RELOCATED Handicaps row.
 *  Leaves the page on the checklist with Save / Enable available. */
async function driveToSetupWithHandicap(page: Page) {
  await page.goto(`/trips/${tripId}/games/match/new`);
  const createBtn = page.getByRole("button", { name: "Create game" });
  await expect(createBtn).toBeVisible({ timeout: 20_000 });
  await createBtn.click();

  // Pair each slot — tap "Add player", pick from the selector. After slot A fills,
  // the remaining "Add player" is slot B.
  const addPlayer = page.getByRole("button", { name: "Add player" });
  await expect(addPlayer.first()).toBeVisible({ timeout: 20_000 });
  await addPlayer.first().click();
  await page.getByRole("button", { name: /MP Owner/ }).click();
  await expect(page.getByRole("button", { name: /MP Owner/ })).toBeVisible(); // slot A filled
  await addPlayer.first().click();
  await page.getByRole("button", { name: /MP Member/ }).click();

  // Give MP Member a stroke via the RELOCATED Handicaps row (no longer inline in
  // the pairing builder). Scoped to the handicaps section so it's the relocated
  // control, not a pairing slot. Picking a side defaults to 1 stroke → the control
  // resolves to "on hole …"; gate on that so the tap can't silently race the row.
  const handicaps = page.getByTestId("handicaps-section");
  await expect(handicaps).toBeVisible({ timeout: 10_000 });
  await handicaps.getByRole("button", { name: /MP Member/ }).click();
  await expect(handicaps.getByText(/on hole/i)).toBeVisible({ timeout: 10_000 });
}

test("match-play spine — pair + relocated handicap → enable → enter a hole → scorecard", async ({ page }) => {
  test.setTimeout(60_000);
  await driveToSetupWithHandicap(page);

  // Enable scoring → the overview. Gate on the button being ENABLED — that's
  // the signal both slots are filled (filledCount > 0), so the click can't race
  // an incomplete pairing and trip the collapse confirm.
  const enableBtn = page.getByRole("button", { name: "Enable scoring" });
  await expect(enableBtn).toBeEnabled({ timeout: 10_000 });
  await enableBtn.click();

  // 4. Open the single match (the strip card button) → the per-hole entry view.
  const matchCard = page.getByRole("button", { name: /Match 1.*MP Owner/ });
  await expect(matchCard).toBeVisible({ timeout: 20_000 });
  await matchCard.click();

  // 5. Enter hole 1 for both sides. The keypad targets the first un-scored
  //    participant (side A = MP Owner), then Confirm advances to side B. Distinct
  //    values so the assertion can't pass on coincidence (Owner 4 beats Member 6).
  const score4 = page.getByRole("button", { name: "Score 4", exact: true });
  await expect(score4).toBeVisible({ timeout: 20_000 });
  await score4.click();
  await page.getByRole("button", { name: "Confirm score" }).click();
  const score6 = page.getByRole("button", { name: "Score 6", exact: true });
  await expect(score6).toBeVisible({ timeout: 20_000 });
  await score6.click();
  await page.getByRole("button", { name: "Confirm score" }).click();

  // 6. Open the scorecard grid and assert BOTH gross scores landed in the right
  //    cells (keyed by participant id = user id, hole "1"). The relocated handicap
  //    affects NET, not these gross cells.
  await page.getByRole("button", { name: "Scorecard grid" }).click();
  await expect(page.getByTestId(`score-cell-${ownerId}-1`)).toHaveText("4");
  await expect(page.getByTestId(`score-cell-${memberId}-1`)).toHaveText("6");

  // The handicap RELOCATION, gated end-to-end: the stroke set in the relocated row
  // persisted (setHandicap → game_participants.handicap_strokes; recipient = n,
  // other side = 0). This same saveSetup is what the decoupled "Save setup" CTA
  // calls (minus enableScoring), so the enable-decouple's persistence rides on it.
  const hcap = await handicapByUser(await latestGameId());
  expect(hcap.get(memberId)).toBe(1);
  expect(hcap.get(ownerId)).toBe(0);
});
