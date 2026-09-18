/**
 * A `fetch` that cannot wait forever (#1258).
 *
 * ── THE CORRIDOR, AND WHY 8s SITS AT THE DATABASE'S OWN NUMBER ─────────────
 *
 * `statement_timeout` starts when the query starts. It never fired on 09-11's
 * stalls — 2,465 reads took 15 seconds or longer that day and 1,592 of them took
 * 25–55 seconds, with no statement timeout anywhere — because the wait was in
 * FRONT of the query: connection, pool, transport. So 8s here is not a second
 * copy of the database's bound. It is the same ceiling extended to cover the
 * wait before the query starts, which is the part nothing bounded.
 *
 * The floor is measurement, not taste: the slowest legitimate request measured
 * (2026-09-18, post region pin) is 5.7s — the game-open batch, 1 run in 40,
 * whose own reads took 2.6–3.4s each under contention. Trip-week per-read p99
 * was 2.2s. A bound under ~6s fails work that succeeds.
 *
 * ── Two values, because two callers have different write shapes ────────────
 *
 * `CALLER_FETCH_TIMEOUT_MS` (8s) — the request's own client, under RLS. Its
 * writes are single statements: `scores.upsertEntry` is one idempotent upsert,
 * and `save_game_config` is one RPC (one transaction).
 *
 * `ADMIN_FETCH_TIMEOUT_MS` (20s) — the service-role client. `writeManualResults`
 * still deletes and then inserts over two PostgREST calls with nothing spanning
 * them (#1398), so an abort between them leaves a game with NO results. The
 * looser bound is a deliberate stay of execution until that write is atomic; it
 * is not a claim that 20s is the right number for a healthy system.
 *
 * ── What an abort looks like downstream ───────────────────────────────────
 *
 * `AbortSignal.timeout` rejects the fetch, supabase-js surfaces it as a network
 * error, and the procedure turns it into `INTERNAL_SERVER_ERROR`. That is NOT a
 * terminal refusal (`isTerminalRefusal`), so the score path keeps its outbox
 * entry and re-sends — which is what makes the score carve-out true rather than
 * hoped for (`scores.abortSafety.test.ts`).
 */

/** The request's own client (RLS). Above the slowest measured legitimate request, at Postgres's own ceiling. */
export const CALLER_FETCH_TIMEOUT_MS = 8_000;

/** The service-role client. Looser until the manual results write is atomic (#1398). */
export const ADMIN_FETCH_TIMEOUT_MS = 20_000;

/**
 * Build a `fetch` that aborts after `timeoutMs`.
 *
 * Composes with a caller's own signal rather than replacing it: supabase-js
 * passes one for its own cancellation, and dropping it would make those
 * cancellations silently inert. `AbortSignal.any` is used when both exist.
 */
export function fetchWithTimeout(timeoutMs: number, baseFetch: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const caller = init?.signal ?? undefined;
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    return baseFetch(input, { ...init, signal });
  };
}
