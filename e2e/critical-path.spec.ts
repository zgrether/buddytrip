import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Critical-path E2E (the merge-blocking gate) — the GAME-SCORING SPINE, driven
 * through the real UI as the logged-in owner (storageState from auth.setup.ts).
 *
 * Honestly scoped: the trip + crew + a competition (2 seeded teams) are SEEDED
 * via the admin client (fast, stable scaffolding — not the thing under test);
 * the spine that's actually walked is **the competition board's "Add a game"
 * modal → a stroke-play game → enter scores → the scorecard reflects them**.
 * That's the class of break unit tests miss and that's bitten this project:
 * an unreachable setup state, a dead scorecard button, a score that doesn't
 * surface. The fuller competition-run-to-leaderboard walk on real data is the
 * BBMI-replay follow-on (a heavier acceptance test, not this per-push smoke).
 *
 * Creation goes through the REAL in-app path (GAME_ROUTES_AUDIT.md §0 FLAG
 * 1/§3) — the competition board, not the standalone `/games/new` route no UI
 * links to. See the single test below for the full walk.
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
let compId: string;

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

  // Competition-attached spine (staged migration off the standalone /games/new
  // route — GAME_ROUTES_AUDIT.md §0 FLAG 1/§3): the real in-app creation path is
  // the competition board's "Add a game" modal, which requires an existing
  // competition (non-optional competitionId prop) with a `points`-compatible
  // scoring model for Stroke Play to appear in the format picker. Seeded
  // directly (bypassing competitions.create) so this beforeAll stays a single
  // fast round-trip; teams are seeded in the SAME shape competitions.create
  // itself writes (src/lib/teamColors.ts) so the board's zero-teams empty state
  // never intercepts the games panel.
  compId = `e2e-comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: compErr } = await admin.from("competitions").insert({
    id: compId, trip_id: tripId, name: "E2E Cup", scoring_model: "points", status: "upcoming",
  });
  if (compErr) throw new Error(`seed competition failed: ${compErr.message}`);
  const { error: teamErr } = await admin.from("teams").insert([
    { competition_id: compId, name: "Team A", short_name: "A", color: "#3b82f6", color_dim: "#0a1a2a" },
    { competition_id: compId, name: "Team B", short_name: "B", color: "#ef4444", color_dim: "#2a0a0a" },
  ]);
  if (teamErr) throw new Error(`seed teams failed: ${teamErr.message}`);
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
  if (compId) {
    await admin.from("teams").delete().eq("competition_id", compId);
    await admin.from("competitions").delete().eq("id", compId);
  }
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

// ── Real-user-path spine (GAME_ROUTES_AUDIT.md §0 FLAG 1/§3) ──
//
// This creates its game through the REAL in-app path: competition board →
// "Add a game" → GameSheet modal → tap the new row → panel opens straight into
// settings → mandatory groupings (RackGroupBuilder, since a modal-created game
// starts with an EMPTY roster — players are added here, not on a pre-screen) →
// Save → the panel closes back to the board (the freshly-completed game has
// nothing else to show yet) → tap the row again → the panel reopens on the
// stroke surface → group-enter-row → score entry → scorecard assertions.
//
// Supersedes the old standalone-route version of this test (`/games/new`, no
// in-app UI links there — `gameHref()` requires an existing gameId, and the
// `<Link>` fallback in GameRow is dead for every known format because
// `opensAsPanel` allowlists them all — see gameRoutes.ts; it also never
// attached a competition, while every real game is created through this
// modal, competitionId being a non-optional GameSheet prop). Proven green ×3
// and red-when-broken (creation + panel-open) before the old test was removed
// — see the PR description for the coverage-change judgement call this
// migration made deliberately.
test("scoring spine (competition-attached, real path) — stroke game: create via board → enter scores → scorecard reflects them", async ({ page }) => {
  test.setTimeout(60_000);
  const title = "E2E Stroke Spine";

  // 1. Competition board → "Add a game" (the empty-state CTA, since this
  //    competition starts with zero games) → GameSheet modal.
  await page.goto(`/trips/${tripId}/leaderboard`);
  await page.getByTestId("comp-games-empty-cta").click();

  // 2. Format defaults to the sole points-compatible golf format for this
  //    competition's scoring_model ("points") — Stroke Play. Click it anyway
  //    rather than relying on the default selection.
  await page.getByRole("button", { name: "Stroke Play", exact: true }).click();
  await page.getByPlaceholder("e.g. Day 1 Scramble").fill(title);
  await page.getByTestId("save-game").click();

  // 3. The new row appears on the board ("New" section); tap it — a fresh,
  //    unconfigured game opens straight into settings (?game=<id>&settings=1).
  const row = page.getByTestId("open-game-panel").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });
  const configHashLoaded = page.waitForResponse(
    (r) => r.url().includes("games.configHash") && r.status() === 200,
    { timeout: 20_000 },
  );
  await row.click();
  // useConfigDraft freezes its dirty-check baseline only while untouched AND once
  // games.configHash has resolved (src/hooks/useConfigDraft.ts) — editing the draft
  // before that first resolves leaves the baseline null for the rest of the
  // session, permanently disabling Save. Wait for it before touching anything.
  // This exists because of #700; remove it when that's fixed.
  await configHashLoaded;

  // 4. Mandatory groupings: expand, add one group, add both crew via the
  //    CombinedPicker (shared RackGroupBuilder — supports multi-add, closed
  //    with "Done").
  await page.getByTestId("row-groupings").click();
  await page.getByRole("button", { name: "Add group" }).click();
  await page.getByRole("button", { name: "Add player" }).click();
  await page.getByRole("button", { name: "E2E Owner" }).click();
  await page.getByRole("button", { name: "E2E Member" }).click();
  // exact: true — a substring match on "Done" also hits "This can't be undone."
  // on the Delete-game danger-zone row sitting underneath the picker portal.
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // 5. Go live and save — one atomic save_game_config (CLAUDE.md #18).
  const scoringSeg = page.getByTestId("mode-scoring");
  await expect(scoringSeg).toBeEnabled({ timeout: 20_000 });
  await scoringSeg.click();
  const saveBtn = page.getByTestId("settings-save");
  await expect(saveBtn).toBeEnabled({ timeout: 20_000 });
  await saveBtn.click();

  // 6. Save on a freshly-completed game closes the WHOLE panel back to the
  //    board (nothing else was open underneath) — the row reappears there.
  //    Its settings-vs-surface routing (GameRow's `setupMode`) reads
  //    `scoringEnabled` off the leaderboard query, which the save's
  //    invalidate-then-refetch lands a beat after the panel closes — wait for
  //    the row's "Ready to play" subtitle (not just visibility, which is true
  //    the whole time) before tapping it again, or the second tap can race
  //    back into settings instead of the stroke surface.
  //    This exists because of #701; remove it when that's fixed.
  await expect(row).toContainText("Ready to play", { timeout: 20_000 });
  await row.click();
  await page.getByTestId("group-enter-row").first().click();

  // 7. Enter hole 1 for both players — same downstream steps as the standalone
  //    spine above (shared score-entry UI, entry-path-agnostic).
  const score7 = page.getByRole("button", { name: "Score 7", exact: true });
  await expect(score7).toBeVisible({ timeout: 20_000 });
  await score7.click();
  await page.getByRole("button", { name: "Confirm score" }).click();

  const score3 = page.getByRole("button", { name: "Score 3", exact: true });
  await expect(score3).toBeVisible({ timeout: 20_000 });
  await score3.click();
  await page.getByRole("button", { name: "Confirm score" }).click();

  // 8. Scorecard reflects both entered scores. Order-agnostic on WHICH participant
  //    got which value: the picker's click order (Owner, then Member) doesn't
  //    determine keypad turn order, unlike the standalone spine above where
  //    "Start game" seeds the roster in pick order. What this proves is
  //    unchanged from the standalone spine — two distinct entered values land in
  //    the exact two participant cells, not a shared/wrong/missing one.
  await page.getByRole("button", { name: "Scorecard", exact: true }).click();
  const ownerCell = page.getByTestId(`score-cell-${ownerId}-1`);
  const memberCell = page.getByTestId(`score-cell-${memberId}-1`);
  await expect(ownerCell).toBeVisible({ timeout: 20_000 });
  await expect(memberCell).toBeVisible({ timeout: 20_000 });
  const [ownerText, memberText] = await Promise.all([ownerCell.textContent(), memberCell.textContent()]);
  expect([ownerText, memberText].sort()).toEqual(["3", "7"]);
});

// ── Regression: editing settings before games.configHash resolves ──────────────
//
// The settings page paints off `games.getById`, which lands in a DIFFERENT tRPC
// batch from `games.configHash` — so the panel is fully interactive while the
// hash is still in flight, and GameRow deep-links an unconfigured game straight
// to `?settings=1`, making that the ordinary path rather than an exotic one.
//
// useConfigDraft used to guard its baseline freeze on `anyTouched`, so touching
// the draft first meant a baseline was NEVER frozen: `dirty` (which requires
// one) stayed false and Save was dead for the rest of the session, with no error
// and no self-correction when the hash finally arrived. The draft outbox made it
// worse — disabled while the hash was pending, its own base ref kept its ""
// seed, so the mirrored edit could never be recovered and was deleted on reload.
//
// Fails on main (Save never enables); passes here. Deliberately asserts BOTH
// halves: Save recovers AND the outbox entry carries a real fingerprint.
test("settings edited before configHash resolves still saves (baseline-freeze regression)", async ({ page }) => {
  test.setTimeout(60_000);
  const title = "E2E Hash Race";
  const HASH_DELAY_MS = 4_000;

  // A brand-new game, so its configHash has never been fetched this session —
  // TanStack serves a cached hash on re-open, which masks the race entirely.
  await page.goto(`/trips/${tripId}/leaderboard`);
  // Either affordance opens the modal — which one renders depends on whether the
  // spine test above already put a game on this board, and both tests must pass
  // when run alone (`-g`) as well as in file order.
  const addGame = page.getByTestId("comp-games-empty-cta").or(page.getByTestId("comp-add-game"));
  await expect(addGame).toBeVisible({ timeout: 20_000 });
  await addGame.click();
  await page.getByRole("button", { name: "Stroke Play", exact: true }).click();
  await page.getByPlaceholder("e.g. Day 1 Scramble").fill(title);
  await page.getByTestId("save-game").click();

  const row = page.getByTestId("open-game-panel").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });

  // Hold the hash back so the edit below lands inside the window. This also
  // delays listOrganizers/playGroups, which share its batch — the same coupling
  // production has, and exactly why `ready` must cover them before a late freeze.
  await page.route(/games\.configHash/, async (route) => {
    await new Promise((r) => setTimeout(r, HASH_DELAY_MS));
    await route.continue();
  });

  await row.click();

  // Edit immediately — the panel is interactive well before the hash returns.
  const stepper = page.getByTestId("total-points-stepper");
  await expect(stepper).toBeVisible({ timeout: 20_000 });
  await stepper.getByRole("button", { name: "Increase" }).click();

  // THE REGRESSION: Save must become live once the hash lands. On main the
  // baseline never freezes after a touch, so this never flips and times out.
  const saveBtn = page.getByTestId("settings-save");
  await expect(saveBtn).toBeEnabled({ timeout: 25_000 });

  // The outbox half: the mirrored edit must carry the real frozen fingerprint,
  // not the "" that made it unrecoverable (and got it deleted on reload).
  const outboxBase = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("bt.setupDraft.v1:stroke:"));
    return k ? (JSON.parse(localStorage.getItem(k) as string) as { base: string }).base : null;
  });
  expect(outboxBase).toBeTruthy();
  expect(outboxBase).not.toBe("");

  // …and the save actually lands (panel closes on a committed save).
  await page.unroute(/games\.configHash/);
  await saveBtn.click();
  await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

  // Server truth: the edited value persisted.
  const { data } = await admin
    .from("games").select("points_total").eq("trip_id", tripId).eq("name", title).single();
  expect(Number(data?.points_total)).toBe(1);
});
