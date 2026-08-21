/**
 * Refuse to run the suite against anything but a local database.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The test suite gets its Supabase credentials from `.env.local` (loaded by
 * `vitest.config.mts` and again by `global-setup.ts`). That file is gitignored,
 * so its contents are per-machine and invisible to review — and on 2026-08-21 it
 * was found pointing at the PRODUCTION project. Every local `vitest run` in this
 * repo had been seeding trips, guest users, games and score entries into prod
 * and deleting them again.
 *
 * Nothing failed. That is the whole problem: the suite passes identically
 * against either database, so the only signal was latency (35s against prod vs
 * 1.5s against local) and nobody was measuring that. #636 moved CI and local dev
 * onto an ephemeral local stack a month earlier; this one file never followed,
 * and no mechanism noticed for a month.
 *
 * Repointing `.env.local` fixes one machine. This function is the part that
 * survives the next person — including the next Claude Code session — repointing
 * it again, because it turns a silent success into a loud refusal.
 *
 * ── Deliberately not a warning ────────────────────────────────────────────
 *
 * A warning scrolls past in CI output and in a terminal running 1,400 tests. The
 * failure mode being guarded is "the run looked completely normal", so the guard
 * has to be the thing that stops the run.
 *
 * ── The opt-in is real, and named for what it does ────────────────────────
 *
 * There are legitimate reasons to point read-only tooling at a remote project.
 * `ALLOW_REMOTE_TEST_DB=1` is the escape hatch, spelled out per-command rather
 * than parked in an env file, so choosing it is a visible act each time.
 */

/** Hosts that are unambiguously a developer's own machine. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export const REMOTE_DB_OPT_IN = "ALLOW_REMOTE_TEST_DB";

export function isLocalDatabaseUrl(rawUrl: string | undefined | null): boolean {
  if (!rawUrl) return false;
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    // An unparseable URL is not demonstrably local, and this guard's whole job
    // is to refuse anything it cannot vouch for.
    return false;
  }
  return LOCAL_HOSTS.has(host);
}

/**
 * Throws unless the suite is pointed at a local database, or the caller has
 * explicitly opted into a remote one.
 *
 * @param url the resolved `NEXT_PUBLIC_SUPABASE_URL`
 * @param env the environment to read the opt-in from (injected for testing)
 */
export function assertLocalTestDatabase(
  url: string | undefined | null,
  env: Record<string, string | undefined> = process.env
): void {
  if (isLocalDatabaseUrl(url)) return;
  if (env[REMOTE_DB_OPT_IN]) return;

  throw new Error(
    [
      "",
      "  ✗ The test suite is pointed at a NON-LOCAL database and will not run.",
      "",
      `      NEXT_PUBLIC_SUPABASE_URL = ${url ?? "(unset)"}`,
      "",
      "  This suite WRITES: it seeds trips, guest users, games and score entries,",
      "  and deletes them again. Against a real project that is production data.",
      "",
      "  Since #636, CI and local dev both run against an ephemeral local stack:",
      "",
      "      npx supabase start        # then re-run",
      "",
      "  Check .env.local — it is gitignored, so it can drift per machine without",
      "  showing up in review. That is exactly how this was found.",
      "",
      `  If you genuinely mean to use a remote project, say so per-command:`,
      "",
      `      ${REMOTE_DB_OPT_IN}=1 npx vitest run ...`,
      "",
    ].join("\n")
  );
}
