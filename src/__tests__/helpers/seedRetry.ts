/**
 * Bounded retry for the confirmed Kong-502 flake (#664): the local Supabase
 * stack's gateway occasionally returns "An invalid response was received
 * from the upstream server" (no Postgres `error.code`) under CI concurrency,
 * during test-seed `beforeAll` inserts. `vitest.config.mts`'s `retry` option
 * re-runs the TEST body only — it never re-enters `beforeAll`, so a seed
 * failure there fails the whole suite immediately. This wrapper retries at
 * the individual seed-call site instead.
 *
 * Matches ONLY the confirmed transient signature — any other error (4xx,
 * a first-attempt unique violation, an assertion) throws immediately, never
 * retried, so real bugs are never masked.
 *
 * Retry-safety (Phase 0 §4, resolved): a 502 might mean "nothing applied" or
 * "applied but the response was lost" — rather than prove which, we use the
 * 23505 tell. A unique-violation on the retry attempt that immediately
 * follows a 502 proves the original insert landed → treated as success. A
 * 23505 on the FIRST attempt is a real error and still throws.
 *
 * Safety invariants this depends on (see callers in test-setup.ts):
 *   1. `op` must re-issue the byte-identical call on every attempt — same
 *      id, generated once by the caller before calling this wrapper. Never
 *      regenerate the id inside `op`, or a post-502-landed original plus a
 *      fresh-id retry silently duplicates the seed row.
 *   2. Call this once per `.insert()`/`.update()`, not once per multi-step
 *      helper — so a 502 on step B of an A→B→C helper only re-runs B; a
 *      already-committed A is untouched.
 */

const KONG_UPSTREAM_502 = "An invalid response was received from the upstream server";
const MAX_ATTEMPTS = 3;
const BACKOFFS_MS = [250, 500, 1000];

export interface SeedOpError {
  message: string;
  code?: string | null;
}

function isTransientKong502(error: SeedOpError): boolean {
  return error.message === KONG_UPSTREAM_502 && !error.code;
}

function isUniqueViolation(error: SeedOpError): boolean {
  return error.code === "23505";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a single seed mutation with bounded retry on the Kong-502 signature
 * only. `op` must be idempotent under retry per the invariants above.
 *
 * - `idempotent: true` (updates, or any op with no uniqueness constraint to
 *   violate on re-application) — a 502 is retried plainly; re-applying the
 *   same update is a no-op by construction, no 23505 tell needed.
 * - `idempotent: false` (default; inserts with a caller-stable id) — a 502
 *   is retried, and a 23505 on that retry is treated as proof the original
 *   attempt's write landed (success), not a failure.
 *
 * Throws `Error("${errorLabel}: ${message}")` on any non-transient error
 * (first attempt or retry) or once retries are exhausted on a persistent 502.
 */
export async function withSeedRetry(
  // PromiseLike, not Promise: a Supabase `.insert()`/`.update()` call is a
  // thenable query builder (awaitable), not a real Promise instance — it's
  // missing `.catch`/`.finally`, so a `Promise<...>` param type rejects it.
  op: () => PromiseLike<{ error: SeedOpError | null }>,
  errorLabel: string,
  opts: { idempotent?: boolean } = {}
): Promise<void> {
  const { idempotent = false } = opts;
  let lastError: SeedOpError | null = null;
  let previousWasTransient502 = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { error } = await op();

    if (!error) return;

    if (!idempotent && previousWasTransient502 && isUniqueViolation(error)) {
      // The prior attempt 502'd but its write actually landed — this retry's
      // insert collided with it. That's success, not a duplicate.
      return;
    }

    if (!isTransientKong502(error)) {
      throw new Error(`${errorLabel}: ${error.message}`);
    }

    lastError = error;
    previousWasTransient502 = true;
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(BACKOFFS_MS[attempt]);
    }
  }

  throw new Error(`${errorLabel}: ${lastError?.message} (after ${MAX_ATTEMPTS} attempts)`);
}
