import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Chat-as-a-tab-bar-action — the whole thesis of the redesign (Phase 6), and
 * previously untested at every level (0 hits for "chat" across e2e/ before
 * this file). Chat used to be a fourth `AppView`, rendered in place of
 * whichever tab was selected: opening it abandoned wherever you were, and
 * the selected tab lost its `aria-selected` state. This asserts the fix
 * directly — open chat, the underlying tab stays selected; close it, you're
 * back exactly where you were — on BOTH chrome variants (`TopNav`'s Trip/Cup
 * tabs + chat toggle at ≥1280, `AppTabBar`'s action cell below it), since
 * they're two different code paths for the same guarantee.
 *
 * Minimal seed on purpose: this is testing shell/nav behavior, not
 * competition content, so a trip with just the owner as a member is enough —
 * Cup renders its empty/no-competition state, which is all a tab-selection
 * assertion needs.
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
const PASSWORD = "BuddyTripTest2026!";

let admin: SupabaseClient;
let tripId: string;
let ownerId: string;

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

  tripId = `e2e-trip-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // PLACED, and with a competition. Both matter now, and both are part of this
  // spec's own premise rather than incidental setup: these tests are about
  // "opening chat from Cup keeps Cup selected", so the trip has to be one that
  // HAS a Cup to open chat from.
  //
  // A bare trip is idea-phase (`getEffectiveStatus` reads `locked_destination_at`),
  // and the desktop tab group is deliberately absent both then and on a trip with
  // no competition — a lone Trip tab pointing at the screen you are already on is
  // furniture, and a Cup tab whose only content is a create-a-competition prompt
  // advertises a competition that doesn't exist.
  const { error: tErr } = await admin.from("trips").insert({
    id: tripId,
    title: "E2E Chat Action",
    location: "Gulf Shores, AL",
    locked_destination_title: "Gulf Shores",
    locked_destination_location: "Gulf Shores, AL",
    locked_destination_at: new Date().toISOString(),
  });
  if (tErr) throw new Error(`seed trip failed: ${tErr.message}`);
  const { error: cErr } = await admin
    .from("competitions")
    .insert({ id: `${tripId}-comp`, trip_id: tripId, name: "E2E Cup", scoring_model: "points" });
  if (cErr) throw new Error(`seed competition failed: ${cErr.message}`);
  const { error: mErr } = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", nickname: "E2E Owner" },
  ]);
  if (mErr) throw new Error(`seed member failed: ${mErr.message}`);
});

test.afterAll(async () => {
  if (!admin || !tripId) return;
  await admin.from("competitions").delete().eq("trip_id", tripId);
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

// ── Desktop (≥1280): TopNav's Trip/Cup tabs + chat toggle + the aside column ──
test("desktop: opening chat from Cup keeps Cup selected; closing returns to Cup", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/trips/${tripId}?view=cup`);

  const cupTab = page.getByTestId("desktop-tab-cup");
  await expect(cupTab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });

  // Chat is reachable from TopNav (desktop) — the tab strip carries no Chat
  // entry any more (verification #6: "strip shows only Trip and Cup").
  await expect(page.getByTestId("desktop-tab-chat")).toHaveCount(0);
  const chatToggle = page.getByTestId("chat-button");
  await chatToggle.click();

  const chatColumn = page.getByTestId("chat-column");
  await expect(chatColumn).toBeVisible({ timeout: 10_000 });
  // The whole thesis: Cup is STILL selected while chat is open — Chat is a
  // layer, not a destination that would have stolen the selection.
  await expect(cupTab).toHaveAttribute("aria-selected", "true");

  // Close via the SAME toggle (the aside has no separate × — see ChatSheet's
  // doc comment on AppShell's `onToggleChat`).
  await chatToggle.click();
  await expect(chatColumn).toBeHidden({ timeout: 10_000 });
  await expect(cupTab).toHaveAttribute("aria-selected", "true");
});

test("desktop: opening chat from Trip keeps Trip selected; closing returns to Trip", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/trips/${tripId}?view=trip`);

  const tripTab = page.getByTestId("desktop-tab-trip");
  await expect(tripTab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });

  const chatToggle = page.getByTestId("chat-button");
  await chatToggle.click();

  const chatColumn = page.getByTestId("chat-column");
  await expect(chatColumn).toBeVisible({ timeout: 10_000 });
  await expect(tripTab).toHaveAttribute("aria-selected", "true");

  await chatToggle.click();
  await expect(chatColumn).toBeHidden({ timeout: 10_000 });
  await expect(tripTab).toHaveAttribute("aria-selected", "true");
});

// ── Mobile/tablet (<1280): AppTabBar's tinted action cell + ChatSheet ──
test("mobile: opening chat from Cup keeps Cup selected; back closes it and returns to Cup", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/trips/${tripId}?view=cup`);

  const cupTab = page.getByTestId("app-tab-cup");
  await expect(cupTab).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });

  const chatAction = page.getByTestId("app-tab-chat");
  // The action cell never claims selected state — it isn't a destination.
  await expect(chatAction).not.toHaveAttribute("aria-selected", "true");
  await chatAction.click();

  const sheet = page.getByTestId("chat-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(cupTab).toHaveAttribute("aria-selected", "true");
  await expect(chatAction).toHaveAttribute("aria-pressed", "true");

  // Back closes it (Phase 1's history-marker mechanism, reused via
  // useModalBackButton) — not a tap on the action cell this time.
  await page.goBack();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
  await expect(cupTab).toHaveAttribute("aria-selected", "true");
  await expect(chatAction).toHaveAttribute("aria-pressed", "false");
});

/**
 * THE LOAD WINDOW, ACTED IN ON PURPOSE — the bug CI actually hit.
 *
 * Until its trip read answers, the trip page renders a LOADING shell; then the
 * loaded one. #1583 wrapped only the loaded one in TripSettingsOpenerProvider,
 * so the moment the trip landed React saw a different root and threw the whole
 * shell away — and chat, whose open state lives in AppShell, closed itself. The
 * desktop chat specs failed every attempt in CI on exactly this (2026-10-11).
 *
 * So: hold the trip read, open chat INSIDE the window, release it, and chat
 * must still be open once the trip has landed. Waiting for the button to be
 * hydrated first is deliberate and is not the "polite wait" that hides the
 * window — it is a real person's tap, made after the page responds and BEFORE
 * the trip read answers, which is the window itself.
 */
test("desktop: chat opened while the trip is still loading stays open when the trip lands", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let held = 0;
  await page.route(/\/api\/trpc\/[^?]*trips\.getById/, async (route) => {
    held += 1;
    await released;
    await route.continue();
  });

  await page.goto(`/trips/${tripId}?view=cup`);
  await expect.poll(() => held, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="chat-button"]');
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }, undefined, { timeout: 20_000 });
  await page.getByTestId("chat-button").click();
  await expect(page.getByTestId("chat-column")).toBeVisible({ timeout: 10_000 });

  // The trip lands now — the shell swap happens with chat open.
  // No `page.unroute` here: it would settle the held request itself and make
  // the handler's own `route.continue()` throw. Released, the handler passes
  // everything straight through.
  release();
  // Loaded: the trip read has answered (the Trip tab reads its title).
  await expect(page.getByTestId("desktop-tab-trip")).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("chat-column")).toBeVisible();
});
