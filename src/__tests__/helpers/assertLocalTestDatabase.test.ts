import { describe, it, expect } from "vitest";
import {
  assertLocalTestDatabase,
  isLocalDatabaseUrl,
  REMOTE_DB_OPT_IN,
} from "./assertLocalTestDatabase";

/**
 * The guard that stops the suite writing to production.
 *
 * Worth testing rather than trusting, because a guard that silently admits
 * everything is indistinguishable from a working one — which is precisely the
 * failure it was written for. So the assertions here are that it REFUSES the
 * real prod URL, not merely that it accepts localhost: a function returning
 * void unconditionally would pass the happy-path check alone.
 */

const PROD_URL = "https://nezhuwyfirrbmyojpiyx.supabase.co";
const LOCAL_URL = "http://127.0.0.1:54321";

describe("assertLocalTestDatabase", () => {
  it("REFUSES the production project URL", () => {
    expect(() => assertLocalTestDatabase(PROD_URL, {})).toThrow(/NON-LOCAL database/);
  });

  it("refuses any remote host, not just the one we got caught by", () => {
    for (const url of [
      "https://example.supabase.co",
      "https://db.some-other-project.supabase.co",
      "http://10.0.0.5:54321",
      "https://staging.bbmi.app",
    ]) {
      expect(() => assertLocalTestDatabase(url, {})).toThrow(/NON-LOCAL database/);
    }
  });

  it("refuses a missing or unparseable URL — unknown is not local", () => {
    expect(() => assertLocalTestDatabase(undefined, {})).toThrow(/NON-LOCAL database/);
    expect(() => assertLocalTestDatabase("", {})).toThrow(/NON-LOCAL database/);
    expect(() => assertLocalTestDatabase("not-a-url", {})).toThrow(/NON-LOCAL database/);
  });

  it("allows the local stack in every form the CLI and CI report it", () => {
    for (const url of [
      LOCAL_URL,
      "http://localhost:54321",
      "http://127.0.0.1:54321/rest/v1",
      "http://0.0.0.0:54321",
    ]) {
      expect(() => assertLocalTestDatabase(url, {})).not.toThrow();
    }
  });

  it("allows a remote URL ONLY with the explicit opt-in", () => {
    expect(() => assertLocalTestDatabase(PROD_URL, {})).toThrow();
    expect(() =>
      assertLocalTestDatabase(PROD_URL, { [REMOTE_DB_OPT_IN]: "1" })
    ).not.toThrow();
  });

  it("names the offending URL in the message, so the fix is obvious", () => {
    // The failure this guard exists for was invisible; its refusal must not be.
    expect(() => assertLocalTestDatabase(PROD_URL, {})).toThrow(
      new RegExp(PROD_URL.replace(/[.]/g, "\\."))
    );
  });

  it("isLocalDatabaseUrl does not match a host that merely CONTAINS localhost", () => {
    // Substring matching would admit `https://localhost.evil.example.com`.
    expect(isLocalDatabaseUrl("https://localhost.attacker.example.com")).toBe(false);
    expect(isLocalDatabaseUrl("https://notlocalhost:54321")).toBe(false);
    expect(isLocalDatabaseUrl("http://localhost:54321")).toBe(true);
  });
});
