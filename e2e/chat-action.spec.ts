import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Chat-as-a-tab-bar-action — the whole thesis of the redesign (Phase 6), and
 * previously untested at every level (0 hits for "chat" across e2e/ before
 * this file). Chat used to be a fourth `AppView`, rendered in place of
 * whichever tab was selected: opening it abandoned wherever you were, and
 * the selected tab lost its `aria-selected` state. This asserts the fix
 * directly — open chat, the underlying tab stays selected; close it, you're
 * back exactly where you were — on BOTH chrome variants (`DesktopTabStrip` +
 * `TopNav`'s toggle at ≥1280, `AppTabBar`'s tinted action cell below it),
 * since they're two different code paths for the same guarantee.
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
  const { error: tErr } = await admin.from("trips").insert({ id: tripId, title: "E2E Chat Action" });
  if (tErr) throw new Error(`seed trip failed: ${tErr.message}`);
  const { error: mErr } = await admin.from("trip_members").insert([
    { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in", nickname: "E2E Owner" },
  ]);
  if (mErr) throw new Error(`seed member failed: ${mErr.message}`);
});

test.afterAll(async () => {
  if (!admin || !tripId) return;
  await admin.from("trip_members").delete().eq("trip_id", tripId);
  await admin.from("trips").delete().eq("id", tripId);
});

// ── Desktop (≥1280): DesktopTabStrip + TopNav's toggle + the aside column ──
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
