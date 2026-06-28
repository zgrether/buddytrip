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
    testTimeout: 30_000,
    exclude: ["e2e/**", "node_modules/**"],
    globalSetup: ["src/__tests__/helpers/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
