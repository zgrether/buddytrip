import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "path";

/**
 * Auth setup — runs once before the critical-path test. Logs in as the seeded
 * `test-owner` through the REAL login UI so @supabase/ssr writes the session
 * cookie the middleware's server-side getUser() accepts, then saves the session
 * to storageState. The critical-path project depends on this and reuses it, so
 * it starts already-authenticated (route-mocking can't satisfy the server-side
 * auth check — that's what kept the old e2e specs from ever reaching /trips/*).
 */

const OWNER_EMAIL = "test-owner@buddytrip.app";
const OWNER_NAME = "Test Owner";
const PASSWORD = "BuddyTripTest2026!"; // same shared test password as vitest global-setup
const STORAGE = resolve(__dirname, ".auth/owner.json");

setup("authenticate as test-owner", async ({ page }) => {
  // 1. Ensure test-owner exists on the project (idempotent) — the same user
  //    vitest's global-setup creates. Self-contained so the E2E CI job doesn't
  //    depend on the vitest job having run first.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("E2E auth setup needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env");
  }
  const admin = createClient(url, serviceKey);
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw new Error(`Failed to list users: ${listErr.message}`);
  if (!list?.users?.some((u) => u.email === OWNER_EMAIL)) {
    const { error } = await admin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: OWNER_NAME },
    });
    if (error) throw new Error(`Failed to create test-owner: ${error.message}`);
  }

  // 2. Log in through the UI (the real signInWithPassword path).
  await page.goto("/login");
  await page.locator("#email").fill(OWNER_EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // 3. The middleware bounces an authenticated user off /login → wait until we
  //    leave it (proves the cookie is set and accepted).
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

  // 4. Persist the session for the dependent project.
  await page.context().storageState({ path: STORAGE });
});
