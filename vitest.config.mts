import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

// Load .env.local for test environment
config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  // Match the Next app's automatic JSX runtime so component .tsx files (which omit
  // `import React`) render under react-dom/server in tests (the row-pattern
  // primitives are the first such test).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Server-router tests run against the shared REMOTE Supabase project and do
    // many sequential round-trips per test (setPairings → setHandicap → score
    // entries → finish). Under CI load a single round-trip can spike to several
    // seconds, tipping a heavy test past the old 30s default and flaking the
    // merge gate (e.g. matches.test.ts "closed-out 3&2"). 60s gives real
    // headroom; a genuinely hung test still fails, just 30s later.
    testTimeout: 60_000,
    // Hooks (beforeAll: createTrip → addTripMember → createCompetition) hit the SAME
    // shared remote Supabase and the SAME CI-load latency spikes as tests, but vitest
    // defaults hookTimeout to 10s — so under concurrent load (every new integration suite
    // adds a beforeAll) the setup hooks flake the gate ("Hook timed out in 10000ms" on
    // games.saveConfig / matches) while the 60s tests pass. Match it to testTimeout; a
    // genuinely hung hook still fails, just with real headroom.
    hookTimeout: 60_000,
    exclude: ["e2e/**", "node_modules/**"],
    globalSetup: ["src/__tests__/helpers/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
