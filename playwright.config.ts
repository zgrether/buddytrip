import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local for local runs (NEXT_PUBLIC_SUPABASE_URL, service key, etc.).
// In CI these come from job env (GitHub secrets); a missing .env.local is a
// silent no-op, so this is safe in both places.
loadEnv({ path: ".env.local" });

const STORAGE_STATE = "e2e/.auth/owner.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Logs in as test-owner once and saves the session; the critical-path
    // project depends on it so it starts already-authenticated (the middleware
    // does a server-side getUser() that route-mocks can't satisfy).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // The merge-blocking CI gate: the real-UI scoring SPINES — stroke
      // (critical-path) and match-play (the reference format the config-checklist
      // + future formats build on). The other e2e/*.spec.ts files are the
      // deferred mocked set (Issue #29) and match no project, so they don't run.
      name: "critical-path",
      testMatch: /(critical-path|match-play)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
    {
      // Chat-as-a-tab-bar-action (Phase 6) — a THIRD merge-blocking spec,
      // added deliberately: chat's redesign had zero E2E coverage before this
      // (`grep -ri chat e2e/` was a clean miss), and the whole point of the
      // change — the underlying tab keeps selection while chat is open, and
      // closing returns you to it — is exactly the class of break a unit
      // test can't see (it's about which DOM node is mounted where, across a
      // real navigation + history stack). CLAUDE.md documents "two Playwright
      // specs run merge-blocking" — update that line alongside this one if
      // the count changes again.
      name: "chat-action",
      testMatch: /chat-action\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // CI runs the prebuilt app (the workflow does `npm run build` first) so
    // there's no flaky on-demand route compilation mid-test; locally, dev is
    // fine and reuses an already-running server.
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
