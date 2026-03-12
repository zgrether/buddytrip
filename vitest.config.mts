import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

// Load .env.local for test environment
config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
