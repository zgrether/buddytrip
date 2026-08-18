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
 * The spine test creates its game through the REAL in-app path — the
 * competition board's "Add a game" modal (GAME_ROUTES_AUDIT.md §0 FLAG 1/§3) —
 * with a seeded 2-team `match_play` competition + `team_assignments` (a 2-team
 * competition's pairing picker is team-bound, per side; see the helper below).
 *
 * The other two tests in this file ("dirty settings refuse to leave silently",
 * "Cancel button always leaves") still create their game via the standalone
 * `/trips/:id/games/match/new` route through `driveToSetupWithHandicap` — a
 * deliberately minimal trip + 2 members, no competition. Migrating them onto
 * the panel path is tracked as a follow-up (issue filed), not bundled here.
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
let courseName: string;
let courseId: string;
let compId: string;

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

  // Competition-attached spine (staged migration off the standalone
  // /games/match/new route — GAME_ROUTES_AUDIT.md §0 FLAG 1/§3): the real
  // in-app creation path is the competition board's "Add a game" modal, which
  // requires an existing competition (non-optional competitionId prop) with a
  // `match_play` scoring model for Match Play to appear in the format picker.
  // Same team-seed shape competitions.create itself writes (teamColors.ts).
  compId = `e2e-mp-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: compErr } = await admin.from("competitions").insert({
    id: compId, trip_id: tripId, name: "E2E MP Cup", scoring_model: "match_play", status: "upcoming",
  });
  if (compErr) throw new Error(`seed competition failed: ${compErr.message}`);
  const { data: teams, error: teamErr } = await admin
    .from("teams")
    .insert([
      { competition_id: compId, name: "Team A", short_name: "A", color: "#3b82f6", color_dim: "#0a1a2a" },
      { competition_id: compId, name: "Team B", short_name: "B", color: "#ef4444", color_dim: "#2a0a0a" },
    ])
    .select("id, name");
  if (teamErr || !teams) throw new Error(`seed teams failed: ${teamErr?.message}`);

  // A 2-team competition's match player-selector is TEAM-BOUND per side (no
  // cross-team pair — MatchGameView.tsx, "constrained to the side's team in a
  // 2-team competition"): its pool is `rosterOfTeam(team.id)` (team_assignments),
  // NOT the whole trip crew. Found live while verifying this migration — without
  // this, both sides' pickers show "Everyone's assigned" (empty pool) and the
  // pairing step hangs forever. Opposing teams so "Match 1: Team A vs Team B"
  // resolves to Owner vs Member, same pairing the standalone spine builds.
  const teamA = teams.find((t) => t.name === "Team A")!;
  const teamB = teams.find((t) => t.name === "Team B")!;
  const { error: assignErr } = await admin.from("team_assignments").insert([
    { competition_id: compId, user_id: ownerId, team_id: teamA.id },
    { competition_id: compId, user_id: memberId, team_id: teamB.id },
  ]);
  if (assignErr) throw new Error(`seed team_assignments failed: ${assignErr.message}`);
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
  if (compId) {
    await admin.from("team_assignments").delete().eq("competition_id", compId);
    await admin.from("teams").delete().eq("competition_id", compId);
    await admin.from("competitions").delete().eq("id", compId);
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
  // Exit-behavior alignment: Save COMMITS + CLOSES the panel on success. The panel
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

// ── Real-user-path spine (GAME_ROUTES_AUDIT.md §0 FLAG 1/§3) ──
//
// This creates its game through the REAL in-app path: competition board →
// "Add a game" → GameSheet modal (Match Play format) → tap the new row → the
// panel opens straight onto the SAME setup screen the standalone route's
// "Create game" click used to reach (MatchGameView's `screen` state machine
// only ever renders that pre-screen when no gameId exists yet — verified in
// Phase 0; a modal-created game always has one) — then the identical
// downstream pairing/course/handicap/save/score-entry walk.
//
// Supersedes the old standalone-route version of this test (`/games/match/new`
// — no in-app UI links there, same finding as the stroke critical-path; it
// also never attached a competition, while every real match game is created
// through this modal, competitionId being a non-optional GameSheet prop).
// Proven green ×3 and red-when-broken (creation + panel-open) before the old
// test was removed — see the PR description for the coverage-change
// judgement call this migration made deliberately.
//
// `driveToSetupWithHandicap` (the standalone-route helper below) and its two
// remaining callers — "dirty settings refuse to leave silently" and "Cancel
// button always leaves" — are UNTOUCHED: they're draft-lifecycle tests, not
// spine tests, and migrating them is tracked as a follow-up (issue filed),
// not bundled into this change.
async function driveToSetupWithHandicapViaPanel(page: Page) {
  const title = "E2E Match Spine";

  // 1. Competition board → "Add a game" (the empty-state CTA — this
  //    competition starts with zero games) → GameSheet modal.
  await page.goto(`/trips/${tripId}/leaderboard`);
  await page.getByTestId("comp-games-empty-cta").click();

  // 2. This competition's scoring_model ("match_play") offers Match Play AND
  //    Rack-n-Stack in the format picker — Match Play doesn't default-select,
  //    so pick it explicitly.
  await page.getByRole("button", { name: "Match Play", exact: true }).click();
  await page.getByPlaceholder("e.g. Day 1 Scramble").fill(title);
  await page.getByTestId("save-game").click();

  // 3. Tap the new row — a fresh match game opens straight onto the setup
  //    screen (the same one the standalone route reaches post-"Create game").
  const row = page.getByTestId("open-game-panel").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // From here down: IDENTICAL to `driveToSetupWithHandicap` from its
  // mode-scoring-disabled check onward (duplicated, not shared, per the
  // staged-rollout instruction not to touch the old helper yet).
  await expect(page.getByTestId("mode-scoring")).toBeDisabled({ timeout: 20_000 });

  const toggle = (tid: string) => page.getByTestId(tid).getByRole("button").first();

  await toggle("row-matches").click();
  const pairings = page.getByTestId("match-pairings");
  await expect(pairings).toBeVisible({ timeout: 20_000 });
  await pairings.getByRole("button", { name: "Add match" }).click();
  await pairings.getByRole("button", { name: /Add singles/ }).click();
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

  await toggle("row-course").click();
  const coursePanel = page.getByTestId("course-search-panel");
  await expect(coursePanel).toBeVisible({ timeout: 10_000 });
  await coursePanel.getByRole("button", { name: new RegExp(courseName) }).click();
  await expect(page.getByTestId("row-course")).toContainText(courseName, { timeout: 10_000 });

  await expect(page.getByTestId("row-handicaps")).not.toContainText(/first/, { timeout: 10_000 });
  await toggle("row-handicaps").click();

  const handicaps = page.getByTestId("handicaps-section");
  await expect(handicaps).toBeVisible({ timeout: 10_000 });
  await handicaps.getByRole("button", { name: /MP Member/ }).click();
  await expect(handicaps.getByText(/on hole/i)).toBeVisible({ timeout: 10_000 });

  expect(await filledMatchCount(await latestGameId())).toBe(0);
  await expect(page.getByTestId("settings-save")).toBeEnabled({ timeout: 10_000 });
}

test("match-play spine (competition-attached, real path) — create via board → pair + relocated handicap → enable → enter a hole → scorecard", async ({ page }) => {
  test.setTimeout(60_000);
  await driveToSetupWithHandicapViaPanel(page);

  // C3 readiness gate (MatchGameView.tsx `enableReady`): for a COMPETITION game
  // (gameCompId set), points-per-match > 0 joins the enable gate alongside
  // matches-filled — a cup concept the standalone spine never hits (a standalone
  // match has no points at all, so `!gameCompId` short-circuits this term).
  // Points per match starts at 0 (seen live), so bump it before Scoring unlocks.
  await page.getByTestId("total-points-stepper").getByRole("button", { name: "Increase" }).click();

  const scoringSeg = page.getByTestId("mode-scoring");
  await expect(scoringSeg).toBeEnabled({ timeout: 10_000 });
  await scoringSeg.click();

  // This save flips the Setup/Scoring toggle, so it deliberately keeps the panel
  // open and is closed by hand (#881).
  await saveSettings(page);

  expect(await filledMatchCount(await latestGameId())).toBeGreaterThan(0);

  await expect
    .poll(async () => {
      const { data } = await admin.from("games").select("scoring_enabled").eq("id", await latestGameId()).single();
      return data?.scoring_enabled;
    }, { timeout: 15_000 })
    .toBe(true);

  // Save on a freshly-completed game closes the WHOLE panel back to the board
  // (verified live and in the stroke version of this migration — see its
  // comment above) — the row reappears there. Its settings-vs-surface routing
  // reads `scoringEnabled` off the leaderboard query, which the save's
  // invalidate-then-refetch lands a beat after the panel closes — wait for the
  // row's "Ready to play" subtitle (not just visibility, which is true the
  // whole time), same fix as the stroke version, or the tap races back into
  // settings instead of the match overview (reproduced running this file's
  // 4 tests together, not in isolation — a real race, not shared-DB load).
  // This exists because of #701; remove it when that's fixed.
  const row = page.getByTestId("open-game-panel").filter({ hasText: "E2E Match Spine" });
  await expect(row).toContainText("Ready to play", { timeout: 20_000 });
  await row.click();

  const matchCard = page.getByRole("button", { name: /Match 1.*MP Owner/ });
  await expect(matchCard).toBeVisible({ timeout: 20_000 });
  await matchCard.click();

  const score4 = page.getByRole("button", { name: "Score 4", exact: true });
  await expect(score4).toBeVisible({ timeout: 20_000 });
  await score4.click();
  await page.getByRole("button", { name: "Confirm score" }).click();
  const score6 = page.getByRole("button", { name: "Score 6", exact: true });
  await expect(score6).toBeVisible({ timeout: 20_000 });
  await score6.click();
  await page.getByRole("button", { name: "Confirm score" }).click();

  // Order-agnostic on WHICH side got which value (see the stroke version of
  // this test for why the picker's click order doesn't guarantee keypad turn
  // order for a modal-created game) — assert the two distinct entered values
  // land in the exact two participant cells.
  await page.getByRole("button", { name: "Scorecard", exact: true }).click();
  const ownerCell = page.getByTestId(`score-cell-${ownerId}-1`);
  const memberCell = page.getByTestId(`score-cell-${memberId}-1`);
  await expect(ownerCell).toBeVisible({ timeout: 20_000 });
  await expect(memberCell).toBeVisible({ timeout: 20_000 });
  const [ownerText, memberText] = await Promise.all([ownerCell.textContent(), memberCell.textContent()]);
  expect([ownerText, memberText].sort()).toEqual(["4", "6"]);

  // Handicap relocation persisted the same way as the standalone spine.
  const hcap = await handicapByUser(await latestGameId());
  expect(hcap.get(memberId)).toBe(1);
  expect(hcap.get(ownerId) ?? 0).toBe(0);
});
