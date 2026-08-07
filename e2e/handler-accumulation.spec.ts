import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * PHASE 0 MEASUREMENT — how many HANDLERS are on the score-events channel?
 *
 * The outage spec reads N duplicate `faceBootstrap,leaderboard` pairs in one tRPC
 * batch as N accumulated handlers. There are actually two multipliers:
 *
 *     pairs  =  broadcasts delivered in the tick  ×  handlers on the channel
 *
 * `broadcastAmplification.measure.test.ts` pins the first factor (a reset over a
 * 4×18 round emits 73 broadcasts). This file pins the SECOND, by firing exactly
 * ONE broadcast and counting the pairs it produces — so the number read here IS
 * the handler count, with the broadcast factor held at 1.
 *
 * The single broadcast is a one-row `corrections_open` flip on a DECOY game in the
 * same competition (the topic is per-competition, so any game reaches every
 * subscriber) — chosen so the open panel's own UI doesn't react and add traffic
 * that would be mistaken for handlers.
 *
 * Run it (needs a PRODUCTION build on :3000 and the local Supabase stack):
 *
 *     npm run build
 *     MEASURE=1 npx playwright test --project=measure-handlers --reporter=list
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
const PASSWORD = "BuddyTripTest2026!";
const PANEL_GAME_NAME = "Panel Game";
const CYCLES = 20;

let admin: SupabaseClient;
let tripId: string;
let ownerId: string;
let compId: string;
let panelGameId: string;
let decoyGameId: string;
const gameIds: string[] = [];

interface FetchRecord {
  url: string;
  at: number;
}
declare global {
  interface Window {
    __log: FetchRecord[];
  }
}

async function ensureUser(email: string, name: string): Promise<string> {
  const { data: list, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const found = list?.users?.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error: createErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name },
  });
  if (createErr || !data.user) throw new Error(`createUser failed: ${createErr?.message}`);
  return data.user.id;
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  admin = createClient(url, key);
  ownerId = await ensureUser(OWNER_EMAIL, "Test Owner");

  tripId = `e2e-acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await admin.from("trips").insert({ id: tripId, title: "E2E Handler Accumulation" });
  if (t.error) throw new Error(`seed trip: ${t.error.message}`);
  const m = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "Acc Owner" },
  ]);
  if (m.error) throw new Error(`seed member: ${m.error.message}`);

  compId = `e2e-acc-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const c = await admin.from("competitions").insert({
    id: compId, trip_id: tripId, name: "Acc Cup", scoring_model: "points", status: "active",
  });
  if (c.error) throw new Error(`seed competition: ${c.error.message}`);

  const { data: teams, error: teamErr } = await admin
    .from("teams")
    .insert([
      { competition_id: compId, name: "Blue", short_name: "BLU", color: "#3b82f6", color_dim: "#0a1a2a" },
      { competition_id: compId, name: "Red", short_name: "RED", color: "#ef4444", color_dim: "#2a0a0a" },
    ])
    .select("id");
  if (teamErr || !teams) throw new Error(`seed teams: ${teamErr?.message}`);
  await admin.from("team_assignments").insert([
    { competition_id: compId, team_id: (teams as { id: string }[])[0].id, user_id: ownerId },
  ]);

  for (const name of [PANEL_GAME_NAME, "Decoy Game"]) {
    const id = crypto.randomUUID();
    const g = await admin.from("games").insert({
      id, trip_id: tripId, competition_id: compId,
      game_type_id: "gtt_manual", name,
      points_distribution: { type: "placement", values: [5, 3] }, points_total: 8,
      status: "active", scoring_enabled: true, corrections_open: false,
    });
    if (g.error) throw new Error(`seed game ${name}: ${g.error.message}`);
    gameIds.push(id);
    if (name === PANEL_GAME_NAME) panelGameId = id; else decoyGameId = id;
  }
});

test.afterAll(async () => {
  if (gameIds.length) {
    await admin.from("score_entries").delete().in("game_id", gameIds);
    await admin.from("game_results").delete().in("game_id", gameIds);
    await admin.from("games").delete().in("id", gameIds);
  }
  await admin.from("team_assignments").delete().eq("competition_id", compId);
  await admin.from("teams").delete().eq("competition_id", compId);
  await admin.from("competitions").delete().eq("id", compId);
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__log = [];
    const orig = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const req = args[0];
      const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
      window.__log.push({ url, at: performance.now() });
      return orig.apply(window, args);
    } as typeof fetch;
  });
}

/**
 * Count the refetches one broadcast produced. With the broadcast factor held at
 * 1, this IS the handler count — each handler invalidates faceBootstrap AND
 * leaderboard exactly once.
 *
 * BOTH are counted, because neither alone is valid everywhere: `faceBootstrap`
 * is only mounted where the Live face is, so on the standalone game route
 * `invalidate()` matches no active query and refetches NOTHING — reading that
 * as "0 handlers" would be an artifact of the probe, not a property of the app.
 * `leaderboard` is active in all three configurations.
 */
async function countHandlerInvalidations(page: Page): Promise<{ boot: number; lb: number }> {
  const log = await page.evaluate(() => window.__log);
  let boot = 0;
  let lb = 0;
  for (const r of log) {
    const m = r.url.match(/\/api\/trpc\/([^?]+)/);
    if (!m) continue;
    const ops = decodeURIComponent(m[1]).split(",");
    boot += ops.filter((o) => o === "competitions.faceBootstrap").length;
    lb += ops.filter((o) => o === "competitions.leaderboard").length;
  }
  return { boot, lb };
}

/** Fire exactly ONE broadcast, then let the resulting refetches land. */
async function fireOneBroadcastAndCount(page: Page, flip: boolean): Promise<{ boot: number; lb: number }> {
  await page.evaluate(() => {
    window.__log = [];
  });
  const { error } = await admin
    .from("games")
    .update({ corrections_open: flip })
    .eq("id", decoyGameId);
  if (error) throw new Error(`decoy flip failed: ${error.message}`);
  // Broadcast delivery + the batch it triggers. Generous: undercounting here
  // would read as "no leak" and is the failure mode that matters.
  await page.waitForTimeout(4000);
  return countHandlerInvalidations(page);
}

test.describe("score-events handler accumulation", () => {
  test("handlers per configuration, and across mount/unmount cycles", async ({ page }) => {
    test.setTimeout(600_000);
    await instrument(page);

    const results: string[] = [];
    let flip = true;

    // ── Configuration A: board alone ────────────────────────────────────────
    await page.goto(`/trips/${tripId}/leaderboard`);
    await page.locator('[data-testid="competition-leaderboard"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    const boardAlone = await fireOneBroadcastAndCount(page, flip);
    flip = !flip;
    results.push(`board alone             -> faceBootstrap x${boardAlone.boot}   leaderboard x${boardAlone.lb}`);

    // ── Configuration B: board + open game panel ────────────────────────────
    const row = page.locator('[data-testid="open-game-panel"]').filter({ hasText: PANEL_GAME_NAME });
    await row.first().waitFor({ state: "visible", timeout: 30_000 });
    await row.first().click();
    await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    const boardPlusPanel = await fireOneBroadcastAndCount(page, flip);
    flip = !flip;
    results.push(`board + open game panel -> faceBootstrap x${boardPlusPanel.boot}   leaderboard x${boardPlusPanel.lb}`);

    // ── Configuration C: standalone game route ──────────────────────────────
    // The subscription here is gated on `game.competition_id`, which arrives with
    // the getById response — so this needs the page genuinely SETTLED, not just
    // navigated. A short wait reports 0 handlers and reads as "standalone gets no
    // live updates", which would be a wrong finding drawn from an impatient probe.
    await page.goto(`/trips/${tripId}/games/manual?game=${panelGameId}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(8000);
    const standalone = await fireOneBroadcastAndCount(page, flip);
    flip = !flip;
    results.push(`standalone game route   -> faceBootstrap x${standalone.boot}   leaderboard x${standalone.lb}`);

    // ── The acceptance criterion: 20 open/close cycles on the panel ─────────
    await page.goto(`/trips/${tripId}/leaderboard`);
    await page.locator('[data-testid="competition-leaderboard"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);

    const sequence: number[] = [];
    for (let i = 0; i < CYCLES; i++) {
      const r = page.locator('[data-testid="open-game-panel"]').filter({ hasText: PANEL_GAME_NAME });
      await r.first().waitFor({ state: "visible", timeout: 30_000 });
      await r.first().click();
      await page.locator('[data-testid="game-panel"]').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
      // Close the panel the way a user does — back returns to the board (#12).
      await page.goBack();
      await page.locator('[data-testid="competition-leaderboard"]').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);

      const n = await fireOneBroadcastAndCount(page, flip);
      flip = !flip;
      sequence.push(n.lb);
    }

    console.log(`\n=== handlers on competition_events (one broadcast = one stimulus) ===`);
    for (const r of results) console.log(`  ${r}`);
    console.log(`\n--- board-only handler count after each open/close cycle ---`);
    console.log(`  cycle:  ${sequence.map((_, i) => String(i + 1).padStart(3)).join("")}`);
    console.log(`  count:  ${sequence.map((n) => String(n).padStart(3)).join("")}`);
    const grew = sequence[sequence.length - 1] > sequence[0];
    console.log(
      `\n  first=${sequence[0]}  last=${sequence[sequence.length - 1]}  ` +
        `max=${Math.max(...sequence)}  => ${grew ? "GROWING (leak)" : "STABLE (no leak on this path)"}\n`
    );

    expect(sequence.length).toBe(CYCLES);
  });
});
