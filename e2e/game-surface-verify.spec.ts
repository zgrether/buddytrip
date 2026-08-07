import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * TEMPORARY VERIFICATION for the game-surface batch (items 1–3).
 * Measures rather than asserts-and-hides: prints the numbers the spec asks to be
 * reported (space gained, title rendering at 375px, point values).
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
/** Long on purpose — item 2's truncation case. */
const GAME_NAME = "Match Play 2v2 Test 33";
const MOBILE = { width: 375, height: 812 };

let admin: SupabaseClient;
let tripId: string;
let ownerId: string;
let compId: string;
let gameId: string;
let groupId: string;

async function box(page: Page, sel: string) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) return null;
  return el.boundingBox();
}

test.beforeAll(async () => {
  admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: list } = await admin.auth.admin.listUsers();
  ownerId = list!.users.find((u) => u.email === OWNER_EMAIL)!.id;

  tripId = `e2e-gs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await admin.from("trips").insert({ id: tripId, title: "E2E Game Surface" });
  await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "GS Owner" },
  ]);

  compId = `e2e-gs-comp-${Date.now()}`;
  await admin.from("competitions").insert({
    id: compId, trip_id: tripId, name: "GS Cup", scoring_model: "points", status: "active",
  });
  await admin.from("teams").insert([
    { competition_id: compId, name: "Blue", short_name: "BLU", color: "#3b82f6", color_dim: "#0a1a2a" },
    { competition_id: compId, name: "Red", short_name: "RED", color: "#ef4444", color_dim: "#2a0a0a" },
  ]);

  gameId = crypto.randomUUID();
  await admin.from("games").insert({
    id: gameId,
    trip_id: tripId,
    competition_id: compId,
    game_type_id: "gtt_stroke_play",
    name: GAME_NAME,
    status: "active",
    scoring_enabled: true,
    points_total: 12,
    points_distribution: { type: "placement", values: [12, 6] },
    scorecard_schema: {
      units: Array.from({ length: 18 }, (_, i) => ({
        label: String(i + 1),
        metadata: { par: 4, handicap_index: i + 1 },
      })),
      unitNoun: "hole",
    },
  });
  await admin.from("game_participants").insert([
    { id: crypto.randomUUID(), game_id: gameId, user_id: ownerId },
  ]);
  // `play_groups` names the column `display_name`, not `name` — and an unchecked
  // insert error here shows up much later as an empty surface with no group to
  // tap, which is exactly how the first run of this file failed.
  groupId = crypto.randomUUID();
  const g = await admin.from("play_groups").insert({
    id: groupId, game_id: gameId, display_name: "Group 3", tee_time: null,
  });
  if (g.error) throw new Error(`seed play_group: ${g.error.message}`);
  const link = await admin
    .from("game_participants")
    .update({ play_group_id: groupId })
    .eq("game_id", gameId);
  if (link.error) throw new Error(`link participants: ${link.error.message}`);
});

test.afterAll(async () => {
  await admin.from("score_entries").delete().eq("game_id", gameId);
  await admin.from("game_participants").delete().eq("game_id", gameId);
  await admin.from("play_groups").delete().eq("game_id", gameId);
  await admin.from("games").delete().eq("id", gameId);
  await admin.from("teams").delete().eq("competition_id", compId);
  await admin.from("competitions").delete().eq("id", compId);
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

test("item 1 — entry covers the top bar on mobile; scoreboard keeps it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(MOBILE);
  await page.goto(`/trips/${tripId}/leaderboard`);
  await page.locator('[data-testid="open-game-panel"]').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="open-game-panel"]').first().click();
  await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const barOnBoard = await box(page, '[data-testid="top-bar-slot"]');
  const panelOnBoard = await box(page, '[data-testid="game-panel"]');
  const tabsOnBoard = await box(page, '[data-testid="app-tab-bar"]');

  // Drill into a group → focused entry.
  await page.locator('[data-testid="group-enter-row"]').first().click();
  await page.waitForTimeout(1500);

  const barInEntry = await box(page, '[data-testid="top-bar-slot"]');
  const panelInEntry = await box(page, '[data-testid="game-panel"]');
  const actionRow = await box(page, '[data-testid="game-action-row"]');

  console.log(`\n=== item 1: mobile (${MOBILE.width}x${MOBILE.height}) ===`);
  console.log(`  SCOREBOARD  top bar: ${barOnBoard ? `${barOnBoard.height}px at y=${barOnBoard.y}` : "absent"}`);
  console.log(`              panel top: ${panelOnBoard?.y}`);
  console.log(`              tab bar: ${tabsOnBoard ? `${tabsOnBoard.height}px` : "absent"}`);
  console.log(`  ENTRY       top bar: ${barInEntry ? `${barInEntry.height}px at y=${barInEntry.y}` : "HIDDEN"}`);
  console.log(`              panel top: ${panelInEntry?.y}`);
  console.log(`              action row (back+title): ${actionRow ? `${actionRow.height}px at y=${actionRow.y}` : "absent"}`);
  const gained = (panelOnBoard?.y ?? 0) - (panelInEntry?.y ?? 0);
  console.log(`\n  SPACE GAINED at the top: ${gained}px`);
  console.log(`  (bottom nav was already hidden on entry before this change)\n`);

  expect(barOnBoard, "scoreboard keeps the top bar").not.toBeNull();
  expect(barInEntry, "entry hides the top bar").toBeNull();
  expect(actionRow, "entry keeps back + title in the action row").not.toBeNull();
});

test("item 1 — desktop is unchanged", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/trips/${tripId}/leaderboard`);
  await page.locator('[data-testid="open-game-panel"]').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="open-game-panel"]').first().click();
  await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="group-enter-row"]').first().click();
  await page.waitForTimeout(1500);

  const bar = await box(page, '[data-testid="top-bar-slot"]');
  console.log(`\n=== item 1: desktop 1440 — top bar in entry: ${bar ? `${bar.height}px` : "HIDDEN"} ===\n`);
  expect(bar, "desktop keeps the top bar in entry").not.toBeNull();
});

test("item 2 — titles at 375px", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(MOBILE);
  await page.goto(`/trips/${tripId}/leaderboard`);
  await page.locator('[data-testid="open-game-panel"]').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="open-game-panel"]').first().click();
  await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const read = async () => {
    const t = page.locator('[data-testid="game-title"]').first();
    const text = (await t.textContent())?.trim() ?? "";
    const clipped = await t.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    return { text, clipped };
  };

  const board = await read();
  await page.locator('[data-testid="group-enter-row"]').first().click();
  await page.waitForTimeout(1500);
  const entry = await read();

  console.log(`\n=== item 2: titles at 375px (game name "${GAME_NAME}") ===`);
  console.log(`  SCOREBOARD: "${board.text}"   visually clipped: ${board.clipped}`);
  console.log(`  ENTRY:      "${entry.text}"   visually clipped: ${entry.clipped}`);

  // ── Force the overflow case ────────────────────────────────────────────────
  // The point of splitting the title is what happens when it does NOT fit. A name
  // that fits proves nothing, so rename to something that certainly overflows and
  // check the SUFFIX survives — that is the half a single truncated string eats.
  const LONG = "Saturday Afternoon Alternate Shot Championship Bracket";
  await admin.from("games").update({ name: LONG }).eq("id", gameId);
  await page.reload();
  await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="group-enter-row"]').first().click();
  await page.waitForTimeout(2000);

  const nameEl = page.locator('[data-testid="game-title"] > span').first();
  const suffixEl = page.locator('[data-testid="game-title-suffix"]');
  const nameClipped = await nameEl.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  const suffixClipped = await suffixEl.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  const suffixText = (await suffixEl.textContent())?.trim();
  const rowBox = await box(page, '[data-testid="game-action-row"]');

  console.log(`\n  LONG NAME (${LONG.length} chars) at 375px:`);
  console.log(`    game name clipped: ${nameClipped}   (expected: true — it yields width first)`);
  console.log(`    suffix clipped:    ${suffixClipped}   suffix text: "${suffixText}"`);
  console.log(`    action row height: ${rowBox?.height}px (unchanged ⇒ no wrap)\n`);

  expect(suffixClipped, "the suffix must never be clipped — it is the differentiator").toBe(false);
  expect(suffixText, "the suffix still names the group").toContain("Group 3");
});

/**
 * Item 3 — the value shown on the game surface must be the SAME number the
 * board shows for that game. A second formatter or a second source is how they
 * drift into disagreeing, which on a points screen reads as a scoring bug.
 */
test("item 3 — non-golf game value agrees with the leaderboard", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(MOBILE);

  // A manual (non-golf) game in the same competition, worth a distinctive total.
  const manualId = crypto.randomUUID();
  const WORTH = 9;
  const err = await admin.from("games").insert({
    id: manualId,
    trip_id: tripId,
    competition_id: compId,
    game_type_id: "gtt_manual",
    name: "Cornhole Final",
    status: "active",
    scoring_enabled: true,
    points_total: WORTH,
    points_distribution: { type: "placement", values: [9, 4] },
  });
  if (err.error) throw new Error(`seed manual game: ${err.error.message}`);

  try {
    await page.goto(`/trips/${tripId}/leaderboard`);
    const row = page.locator('[data-testid="open-game-panel"]').filter({ hasText: "Cornhole Final" });
    await row.first().waitFor({ state: "visible", timeout: 30_000 });
    const boardText = ((await row.first().textContent()) ?? "").replace(/\s+/g, " ");

    await row.first().click();
    await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="points-at-stake"]').first().waitFor({ timeout: 30_000 });
    const surfaceText = ((await page.locator('[data-testid="points-at-stake"]').first().textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();

    console.log(`\n=== item 3: non-golf value ===`);
    console.log(`  leaderboard row : "${boardText}"`);
    console.log(`  game surface    : "${surfaceText}"`);
    console.log(`  configured total: ${WORTH}\n`);

    expect(surfaceText).toContain(String(WORTH));
    expect(boardText, "the board shows the same number").toContain(String(WORTH));
  } finally {
    await admin.from("games").delete().eq("id", manualId);
  }
});
