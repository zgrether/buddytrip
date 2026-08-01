import { TRPCError } from "@trpc/server";

/**
 * The one idiom for "this write must have touched N rows, and it didn't."
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `SILENT_WRITES_AUDIT.md` found 64 mutating calls whose failure is invisible to
 * the caller. They need the same three lines each. Solving that ad hoc 64 times
 * produces 64 slightly-different shapes and nothing greppable; one helper makes
 * the next sweep possible at all — `grep assertAffected` is the inventory.
 *
 * ── Why a helper and NOT an RPC ──────────────────────────────────────────────
 * #776 moved three scoring engines onto a single plpgsql RPC because it needed
 * ATOMICITY — a delete and an insert that must not half-apply. This is a
 * different problem: OBSERVABILITY. An RPC per site would carry all of #776's
 * risk (a new SQL surface, a migration, a prod push ordering constraint) for
 * none of its benefit, since wrapping a single statement in a function does not
 * make anything more atomic than it already was.
 *
 * **This helper does NOT make a multi-write sequence transactional, and must not
 * be read as doing so.** `expenses.updateSplits` (delete-then-insert),
 * `matches.setPairings` (three deletes) and `matches.removeMatch` (five) remain
 * non-transactional after this: a throw partway leaves the earlier writes
 * applied. That limitation is pre-existing, is recorded in the audit's §1 for
 * `assignPlayer`, and making the failures LOUD does not change it — it only
 * means you now find out. Atomicity for those clusters is an RPC per cluster and
 * its own piece of work.
 *
 * ── The count contract ───────────────────────────────────────────────────────
 * Supabase returns `count` only when the call passes `{ count: "exact" }`, so
 * every caller must opt in at the query:
 *
 *   const res = await supabase.from("t").update(patch, { count: "exact" }).eq(...);
 *   assertAffected(res, 1, "clear the vacated match's handicap");
 *
 * A `null` count means the option was omitted — that is a CALLER BUG, not a
 * write failure, and it throws with a message saying so rather than silently
 * passing. The alternative (treating null as "fine") would let a site look
 * guarded while asserting nothing, which is the failure mode this whole audit is
 * about.
 *
 * ── When NOT to use this ─────────────────────────────────────────────────────
 * Zero rows is LEGITIMATE at a lot of sites: a "clear if present" delete, an
 * idempotent no-op, a race-tolerant fallback, `games.setBackNine`'s hole-10-18
 * clear (a no-op on the first compose). **Do not reach for this there** — use
 * `assertNoError` and leave a comment saying why zero is fine, or the next sweep
 * re-flags the site and someone converts a deliberate no-op into a throw.
 */

/** The subset of a supabase-js mutation response these helpers read. */
export interface AffectedResult {
  error: { message: string } | null;
  count?: number | null;
}

/**
 * Throw if the write errored, or if it didn't affect exactly `expected` rows.
 *
 * `context` is a human phrase describing what the write was FOR ("promote the
 * new owner"), not the table name — it lands in the error message a developer
 * reads at 2am, and "expected 1 row, got 0" without it is useless.
 *
 * Never throws `UNAUTHORIZED`: `authExpiry` treats a 401 as a dead session and
 * hard-navigates to `/login`, so a wrong code logs someone out mid-round. A
 * precondition failure is `INTERNAL_SERVER_ERROR` — the write should have
 * matched and didn't, which is the server's problem, not the caller's.
 */
export function assertAffected(
  result: AffectedResult,
  expected: number,
  context: string
): void {
  assertNoError(result, context);

  if (result.count == null) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        `Could not verify "${context}": the query did not request a row count. ` +
        `Pass { count: "exact" } to the mutating call, or use assertNoError if ` +
        `zero rows is legitimate here.`,
    });
  }

  if (result.count !== expected) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to ${context}: expected ${expected} row(s), affected ${result.count}.`,
    });
  }
}

/**
 * Throw if the write errored. Says nothing about how many rows matched.
 *
 * The right tool wherever zero rows is a legitimate outcome — and the honest one
 * to reach for when you are NOT sure, since a wrong count assertion breaks a
 * working path while a missing one only leaves it as quiet as it already was.
 * Pair it with a comment stating why zero is fine.
 */
export function assertNoError(result: AffectedResult, context: string): void {
  if (result.error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to ${context}: ${result.error.message}`,
    });
  }
}

/**
 * Throw if the write errored, or if it affected NO rows — without pinning an
 * exact number.
 *
 * For writes over a set whose size the caller doesn't know up front (clearing
 * every participant of a side, stamping N recipients) where zero specifically
 * means "the thing I was operating on wasn't there."
 */
export function assertAffectedAtLeastOne(
  result: AffectedResult,
  context: string
): void {
  assertNoError(result, context);

  if (result.count == null) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        `Could not verify "${context}": the query did not request a row count. ` +
        `Pass { count: "exact" } to the mutating call.`,
    });
  }

  if (result.count === 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to ${context}: no rows were affected.`,
    });
  }
}
