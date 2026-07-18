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
let courseName: string;
let courseId: string;

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

  // Handicaps is now gated on a resolved Course (W-9HOLE-01) — seed an 18-hole
  // course (1 tee, valid stroke index) so the standalone game can apply it and
  // reach Handicaps. Unique name + newest created_at → it leads the picker.
  courseName = `E2E Course ${Date.now()}`;
  const { data: course, error: cErr } = await admin
    .from("courses")
    .insert({
      name: courseName,
      hole_count: 18,
      par: Array(18).fill(4),
      handicap_index: Array.from({ length: 18 }, (_, i) => i + 1),
      has_stroke_index: true,
      tee_sets: [{ name: "White", yards: Array(18).fill(350) }],
      source: "manual",
      created_by: ownerId,
    })
    .select("id")
    .single();
  if (cErr || !course) throw new Error(`seed course failed: ${cErr?.message}`);
  courseId = course.id as string;
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
  if (courseId) await admin.from("courses").delete().eq("id", courseId);
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

/** Number of FULLY-paired (both sides set) matches persisted for the latest game.
 *  "Create game" seeds an empty-sided row, so we count only the filled ones —
 *  that's what persist-on-collapse must write. */
async function filledMatchCount(gameId: string): Promise<number> {
  const { data } = await admin.from("game_matches").select("side_a,side_b").eq("game_id", gameId);
  return (data ?? []).filter((m) => m.side_a && m.side_b).length;
}

/** Drive a fresh 1v1 to fully-set-up-but-not-enabled: create → pair MP Owner (A)
 *  vs MP Member (B) → give MP Member a stroke via the RELOCATED Handicaps row.
 *  Leaves the page on the checklist with Enable available. */
async function driveToSetupWithHandicap(page: Page) {
  await page.goto(`/trips/${tripId}/games/match/new`);
  const createBtn = page.getByRole("button", { name: "Create game" });
  await expect(createBtn).toBeVisible({ timeout: 20_000 });
  await createBtn.click();

  // T2 hard block (W-GAMEPAGE-01 §6.1): "Create game" seeds exactly ONE empty
  // match (build-as-you-go), so the Game-Play toggle's Scoring segment is DISABLED
  // until both slots fill (A2-ux: the toggle replaced the bottom Enable button).
  // No silent collapse-to-filled-count — an empty slot keeps the gate shut.
  await expect(page.getByTestId("mode-scoring")).toBeDisabled({ timeout: 20_000 });

  // Accordion toggle = the row's HEADER button (the first button in the row). When
  // a panel is expanded its body fills the row, so clicking the row CENTER would
  // land in the editor, not the header — target the header explicitly to collapse.
  const toggle = (tid: string) => page.getByTestId(tid).getByRole("button").first();

  // The accordion model: each editor expands IN PLACE beneath its row (no Sheet).
  // Tap the MATCHES row → its panel drops down → pair both slots (scoped to the
  // pairing builder so the slot-fill check isn't fooled by the player-selector
  // modal, which renders at page level OVER the panel).
  await toggle("row-matches").click();
  const pairings = page.getByTestId("match-pairings");
  await expect(pairings).toBeVisible({ timeout: 20_000 });
  // A new game opens at 0 matches (the valid empty state — just "Add match", no
  // table). "Add match" reveals a shape choice (per-match shape, A2a); pick
  // "Add singles" for a 1v1 match → two pairing slots.
  await pairings.getByRole("button", { name: "Add match" }).click();
  await pairings.getByRole("button", { name: /Add singles/ }).click();
  // Fill slot A then slot B. Each pick is gated open→pick→closed so the picks can't
  // race the picker mount/unmount: open the slot, wait for the picker, pick (scoped
  // to the picker so the click can't hit a filled-slot button), wait for it to
  // close, then confirm the slot filled (Add-player count dropped) before the next.
  // (1 match = 2 slots; the count is read only when the picker is closed.)
  const selector = page.getByTestId("player-selector");
  const addPlayer = pairings.getByRole("button", { name: "Add player" });
  await expect(addPlayer).toHaveCount(2, { timeout: 10_000 });
  await addPlayer.first().click();
  await expect(selector).toBeVisible({ timeout: 10_000 });
  await selector.getByRole("button", { name: /MP Owner/ }).click();
  await expect(selector).toBeHidden({ timeout: 10_000 });
  await expect(addPlayer).toHaveCount(1, { timeout: 10_000 }); // slot A filled
  await addPlayer.click(); // the single remaining add = slot B
  await expect(selector).toBeVisible({ timeout: 10_000 });
  await selector.getByRole("button", { name: /MP Member/ }).click();
  await expect(selector).toBeHidden({ timeout: 10_000 });
  await expect(addPlayer).toHaveCount(0, { timeout: 10_000 }); // both slots filled

  // Course is gated BEFORE Handicaps (W-9HOLE-01) — apply the seeded 18-hole course
  // so Handicaps unlocks. Draft-then-save: the pick STAGES the course (the row
  // renders the drafted snapshot); nothing is written yet. Rows are multi-open now,
  // so this no longer collapses Matches either.
  await toggle("row-course").click();
  const coursePanel = page.getByTestId("course-search-panel");
  await expect(coursePanel).toBeVisible({ timeout: 10_000 });
  await coursePanel.getByRole("button", { name: new RegExp(courseName) }).click();
  // 1 tee → applies directly; the row resolves to the course name.
  await expect(page.getByTestId("row-course")).toContainText(courseName, { timeout: 10_000 });

  // Open the HANDICAPS row — ungated once Matches + Course resolve. Both gates read
  // the DRAFT, so they open with nothing persisted yet (that's the point of the
  // refactor: cross-row derivations read one draft, not the server).
  await expect(page.getByTestId("row-handicaps")).not.toContainText(/first/, { timeout: 10_000 });
  await toggle("row-handicaps").click();

  // Give MP Member a stroke. Picking a side defaults to 1 stroke → "on hole …"; gate
  // on that so the tap can't race the just-rendered control.
  const handicaps = page.getByTestId("handicaps-section");
  await expect(handicaps).toBeVisible({ timeout: 10_000 });
  await handicaps.getByRole("button", { name: /MP Member/ }).click();
  await expect(handicaps.getByText(/on hole/i)).toBeVisible({ timeout: 10_000 });

  // NOTHING has reached the server yet — the whole page is one draft until Save.
  // This is the inverse of the old assertion here (which required the pairing to be
  // persisted by now, via the persist-on-collapse the flip deleted), and it's the
  // property worth guarding: no row may write behind the user's back.
  expect(await filledMatchCount(await latestGameId())).toBe(0);
  await expect(page.getByTestId("settings-save")).toBeEnabled({ timeout: 10_000 });
}

/** The page's ONE commit. Save is disabled until the draft differs from the frozen
 *  baseline, so gating on enabled also proves the dirty check saw the edits. */
async function saveSettings(page: Page) {
  const save = page.getByTestId("settings-save");
  await expect(save).toBeEnabled({ timeout: 10_000 });
  await save.click();
  // Exit-behavior alignment: Save now COMMITS + CLOSES the panel on success. The panel
  // going away IS the landed-save signal — a failure keeps it OPEN with the inline error
  // banner (readiness / conflict / frozen), so the save-bar staying visible would fail
  // here and name the regression. (Was: wait for the "Saved" hint + a separate ✕ close.)
  await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });
}

/**
 * Confirm-on-leave (P1.7). Draft-then-save made a back-press a data-loss path — the
 * whole page is one draft that only commits on Save — so BOTH exits must be gated.
 * The browser-back leg is the one worth driving in a real browser: popstate fires
 * AFTER the entry is consumed, so staying put means pushing a replacement on, and
 * getting that wrong strands the user (or lets the next back escape the page).
 */
test("dirty settings refuse to leave silently — browser back and the arrow both gate", async ({ page }) => {
  test.setTimeout(60_000);
  await driveToSetupWithHandicap(page); // leaves a dirty, never-saved draft

  const prompt = page.getByTestId("discard-changes-prompt");

  // 1. OS/browser back → gated, and "Keep editing" leaves us exactly where we were.
  await page.goBack();
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("discard-prompt-keep").click();
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId("match-pairings")).toBeVisible(); // still on settings

  // A second back-press must still be caught — i.e. the guard really did put an
  // entry back, rather than letting this one escape the page.
  await page.goBack();
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("discard-prompt-keep").click();
  await expect(prompt).toBeHidden();

  // 2. The slide-over's ✕ ("Close settings") → the same gate (nothing popped on this
  //    path). It routes through the guarded closeConfig, which raises the prompt when
  //    the draft is dirty. (The old in-header "Back" arrow is gone — Settings Overhaul
  //    P1 moved settings into a body-portaled slide-over dismissed by the ✕.)
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(prompt).toBeVisible({ timeout: 10_000 });

  // 3. Discard → the draft is dropped and we actually leave. Nothing was ever
  //    written, which is the whole point of the gate existing.
  await page.getByTestId("discard-prompt-discard").click();
  await expect(prompt).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("match-pairings")).toBeHidden({ timeout: 10_000 });
  expect(await filledMatchCount(await latestGameId())).toBe(0);
});

/**
 * Exit-behavior alignment: the bottom Cancel button is ALWAYS enabled and means "leave."
 * On a dirty draft it DISCARDS + CLOSES directly — no confirm prompt (Cancel IS the
 * decision), unlike the ✕/back which raise the prompt. Nothing is written.
 */
test("Cancel button always leaves — discards the draft and closes, no prompt", async ({ page }) => {
  test.setTimeout(60_000);
  await driveToSetupWithHandicap(page); // dirty, never-saved draft

  await expect(page.getByTestId("settings-cancel")).toBeEnabled();
  await page.getByTestId("settings-cancel").click();
  // No prompt (Cancel decides), the panel closes, and nothing landed.
  await expect(page.getByTestId("discard-changes-prompt")).toBeHidden();
  await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("match-pairings")).toBeHidden({ timeout: 10_000 });
  expect(await filledMatchCount(await latestGameId())).toBe(0);
});

test("match-play spine — pair + relocated handicap → enable → enter a hole → scorecard", async ({ page }) => {
  test.setTimeout(60_000);
  await driveToSetupWithHandicap(page);

  // Switch to Scoring (A2-ux: the Game-Play toggle's Scoring segment replaced the
  // bottom Enable button). Gate on it being ENABLED — under the T2 hard block that's
  // the signal EVERY match is fully paired (the single match here), so the click
  // can't race an incomplete pairing.
  const scoringSeg = page.getByTestId("mode-scoring");
  await expect(scoringSeg).toBeEnabled({ timeout: 10_000 });
  await scoringSeg.click();

  // Draft-then-save: the flip is a DRAFT field, so going live is not a separate
  // transaction — Save commits the pairing, the course, the handicap AND
  // scoring_enabled in ONE atomic write (the old saveSetup()+enableScoring two-step
  // collapsed into this). Nothing was live before this click.
  await saveSettings(page);

  // The config landed together with the flip.
  expect(await filledMatchCount(await latestGameId())).toBeGreaterThan(0);

  // "Now live" — the config + the scoring flip landed together. The old
  // "This game is live" lock banner (the previous signal) was deleted in the freeze
  // redesign (§3.5: the lock no longer follows scoring mode), so assert the REAL
  // server state instead. The settings back arrow then returns to the game page,
  // which is now in scoring mode → overview.
  await expect
    .poll(async () => {
      const { data } = await admin.from("games").select("scoring_enabled").eq("id", await latestGameId()).single();
      return data?.scoring_enabled;
    }, { timeout: 15_000 })
    .toBe(true);
  // No explicit close: Save already committed AND closed the panel (exit-behavior
  // alignment), landing back on the game page — now in scoring mode.

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
  await page.getByRole("button", { name: "Scorecard", exact: true }).click();
  await expect(page.getByTestId(`score-cell-${ownerId}-1`)).toHaveText("4");
  await expect(page.getByTestId(`score-cell-${memberId}-1`)).toHaveText("6");

  // The handicap RELOCATION, gated end-to-end: the stroke set in the relocated row
  // persisted (game_participants.handicap_strokes; recipient = n, other side = 0).
  // Under draft-then-save the page's single Save wrote it — the signed draft handicap
  // is pre-split into per-side strokes by configDraftToPayload and written by the
  // RPC, rather than committed by the Handicaps panel collapsing.
  const hcap = await handicapByUser(await latestGameId());
  expect(hcap.get(memberId)).toBe(1);
  // The non-recipient has NO strokes. Read it the way the app does (`effectiveStrokes`
  // → `?? 0`) rather than pinning the storage shape: `save_game_config` writes
  // NULLIF(strokes, 0), so "none" persists as NULL, where the old per-row setHandicap
  // wrote a literal 0. Behaviourally identical — every reader normalises — so assert
  // the meaning, not the encoding.
  expect(hcap.get(ownerId) ?? 0).toBe(0);
});
