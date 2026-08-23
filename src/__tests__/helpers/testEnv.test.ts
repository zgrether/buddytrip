import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadTestEnv, resolvedSupabaseUrl, TEST_ENV_FILE, LOCAL_ENV_FILE } from "./testEnv";
import { assertLocalTestDatabase } from "./assertLocalTestDatabase";

/**
 * The guard has to judge what the run RESOLVES, not one file it happens to read.
 *
 * Zach's condition when the split was agreed: "If the guard reads one file and
 * vitest loads another, you'd have a guard that can't see the thing it's
 * guarding." That is the failure these tests exist to make impossible, so they
 * exercise the loader and the guard TOGETHER against fixture files, rather than
 * checking each in isolation and assuming they meet.
 *
 * The decisive case is the last one: with `.env.test` absent and `.env.local`
 * pointing at production, the resolved value must be the production URL AND the
 * guard must throw on it. A guard wired to the wrong source would resolve local,
 * stay quiet, and let the suite write to prod — which is exactly what happened
 * before any of this existed.
 */

const LOCAL_URL = "http://127.0.0.1:54321";
const PROD_URL = "https://nezhuwyfirrbmyojpiyx.supabase.co";

let dir: string;

function writeEnv(file: string, lines: string[]) {
  writeFileSync(join(dir, file), lines.join("\n"), "utf8");
}

/** A fresh, empty environment — never the real one. */
function emptyEnv(): NodeJS.ProcessEnv {
  return {} as NodeJS.ProcessEnv;
}

describe("test env resolution + the guard that reads it", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "bt-env-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers .env.test over .env.local for the database", () => {
    writeEnv(TEST_ENV_FILE, [`NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL}`]);
    writeEnv(LOCAL_ENV_FILE, [`NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}`]);

    const env = loadTestEnv(dir, emptyEnv());

    expect(resolvedSupabaseUrl(env)).toBe(LOCAL_URL);
    expect(() => assertLocalTestDatabase(resolvedSupabaseUrl(env), env)).not.toThrow();
  });

  it("still takes everything .env.test does not mention from .env.local", () => {
    // The split must not cost the run its other credentials — mail, OAuth, the
    // golf course API. If it did, the fix would break the suite a different way.
    writeEnv(TEST_ENV_FILE, [`NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL}`]);
    writeEnv(LOCAL_ENV_FILE, [
      `NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}`,
      "RESEND_API_KEY=re_from_local",
      "GOLFCOURSE_API_KEY=gc_from_local",
    ]);

    const env = loadTestEnv(dir, emptyEnv());

    expect(resolvedSupabaseUrl(env)).toBe(LOCAL_URL);
    expect(env.RESEND_API_KEY).toBe("re_from_local");
    expect(env.GOLFCOURSE_API_KEY).toBe("gc_from_local");
  });

  it("lets a real environment variable (CI) beat both files", () => {
    // CI writes the ephemeral stack's URL into $GITHUB_ENV after `supabase
    // start`, so it arrives as a genuine env var. Neither file may override it.
    writeEnv(TEST_ENV_FILE, [`NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL}`]);
    writeEnv(LOCAL_ENV_FILE, [`NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}`]);

    const ciUrl = "http://127.0.0.1:64321";
    const preset = emptyEnv();
    preset.NEXT_PUBLIC_SUPABASE_URL = ciUrl;

    expect(resolvedSupabaseUrl(loadTestEnv(dir, preset))).toBe(ciUrl);
  });

  it("THE ONE THAT MATTERS: with .env.test missing, the guard sees .env.local's prod URL and refuses", () => {
    rmSync(join(dir, TEST_ENV_FILE), { force: true });
    writeEnv(LOCAL_ENV_FILE, [`NEXT_PUBLIC_SUPABASE_URL=${PROD_URL}`]);

    const env = loadTestEnv(dir, emptyEnv());

    // The resolution falls through to .env.local...
    expect(resolvedSupabaseUrl(env)).toBe(PROD_URL);
    // ...and the guard, reading that same resolution, stops the run.
    expect(() => assertLocalTestDatabase(resolvedSupabaseUrl(env), env)).toThrow(
      /NON-LOCAL database/
    );
  });

  it("a missing .env.local as well leaves nothing resolved — still refused", () => {
    rmSync(join(dir, TEST_ENV_FILE), { force: true });
    rmSync(join(dir, LOCAL_ENV_FILE), { force: true });

    const env = loadTestEnv(dir, emptyEnv());

    expect(resolvedSupabaseUrl(env)).toBeUndefined();
    expect(() => assertLocalTestDatabase(resolvedSupabaseUrl(env), env)).toThrow(
      /NON-LOCAL database/
    );
  });
});
