import { config } from "dotenv";
import { resolve } from "path";

/**
 * The ONE place the test run resolves its environment.
 *
 * ── Why one place ─────────────────────────────────────────────────────────
 *
 * `vitest.config.mts` and `global-setup.ts` each used to call `dotenv.config()`
 * on `.env.local` independently. Two loaders reading one file happened to agree,
 * but nothing made them: the guard that refuses a non-local database reads what
 * the loader produced, so a guard reading one resolution while the clients use
 * another is a guard that cannot see the thing it is guarding. Both callers now
 * go through this function, so there is no second resolution to drift from.
 *
 * ── Precedence, and why this order ────────────────────────────────────────
 *
 *   1. real process env  — CI writes API_URL/ANON_KEY/SERVICE_ROLE_KEY into
 *      `$GITHUB_ENV` after `supabase start`, so they arrive as genuine env vars
 *   2. `.env.test`       — the LOCAL stack, for running tests
 *   3. `.env.local`      — everything else the app needs (API keys, mail, OAuth)
 *
 * `dotenv` does not overwrite a key that is already set, so "first wins" gives
 * exactly this order with no override flags. CI therefore beats both files, and
 * `.env.test` beats `.env.local` for the Supabase trio while `.env.local` still
 * supplies every key `.env.test` does not mention.
 *
 * ── Why the split exists at all ───────────────────────────────────────────
 *
 * `.env.local` is what `next dev` reads, so pointing it at the local stack to
 * protect the test suite silently changed which data the APP shows — a cost
 * nobody asked for, paid to fix an unrelated problem. One file cannot serve a
 * dev server that wants production data and a test suite that must never touch
 * it. Two files can.
 */

export const TEST_ENV_FILE = ".env.test";
export const LOCAL_ENV_FILE = ".env.local";

/**
 * Populates `env` from `.env.test` then `.env.local`, relative to `rootDir`.
 *
 * `env` is injectable so the precedence can be tested against fixture files
 * instead of the developer's real environment — the alternative is asserting
 * this behaviour by reading the same code that implements it.
 */
export function loadTestEnv(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  for (const file of [TEST_ENV_FILE, LOCAL_ENV_FILE]) {
    config({ path: resolve(rootDir, file), processEnv: env, quiet: true });
  }
  return env;
}

/**
 * The Supabase URL the run will actually use, AFTER loading. The guard reads
 * this rather than any single file, so it judges the resolution the Supabase
 * clients are about to be built from.
 */
export function resolvedSupabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.NEXT_PUBLIC_SUPABASE_URL;
}
