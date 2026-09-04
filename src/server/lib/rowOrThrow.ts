import { TRPCError } from "@trpc/server";

/**
 * Split "the check FAILED" from "the row is ABSENT", in one place.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 *
 * `.single()` and `.maybeSingle()` both return `data: null` when the QUERY
 * fails, not only when the row is missing. So the idiom this replaces —
 *
 *     const { data: game } = await ctx.supabase.from("games")…maybeSingle();
 *     if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
 *
 * — turns a 504, a pool timeout, or any transient Postgres error into a
 * DEFINITIVE "this does not exist". The `error` is never destructured, so
 * nothing anywhere records that a query failed. CLAUDE.md's "EMPTY IS NOT
 * UNKNOWN", with the two states rendered identically.
 *
 * ── Why it is worth a helper rather than 43 conditionals ───────────────────
 *
 * 43 sites in `src/server` match that shape and **all 43 throw a terminal
 * code** (#1276). Terminal is not a description here, it is a mechanism:
 * `NOT_FOUND` / `FORBIDDEN` / `BAD_REQUEST` are in `TERMINAL_REFUSAL_CODES`
 * (#1230), and `useScoreSaver.ts` reads
 *
 *     if (isTerminalRefusal(err)) outboxClear(gameId, participantId, unitLabel);
 *
 * so on the scoring path a transient failure is reported as an existence
 * decision and **the durable outbox entry is deleted**. The score survives in
 * React state only: the cell stays flagged and Retry works while the page is
 * open, but a reload loses it. The durability layer is defeated by the
 * misclassification rather than by any failure of its own.
 *
 * Observed in production 2026-09-04, alongside `PGRST003: Timed out acquiring
 * connection from connection pool`.
 *
 * ── What this returns, and why the failure is NOT terminal ─────────────────
 *
 * `INTERNAL_SERVER_ERROR` is deliberately outside `TERMINAL_REFUSAL_CODES`
 * ("every 5xx … transient by nature or by doubt"), so the outbox KEEPS the
 * entry and re-sends it through the idempotent upsert on the next mount. The
 * absent case keeps whatever code and sentence the call site already used —
 * a real refusal is unchanged.
 *
 * ── The log line ──────────────────────────────────────────────────────────
 *
 * The 504 that caused the outage was invisible from inside the app: it
 * presented only as "not found" and "not a member". A failed check now says so
 * where the next investigation will find it. Note the error is embedded as an
 * OBJECT, not via `String(err)` — supabase-js returns a plain
 * `{ code, message, details, hint }` rather than an `Error`, and `String()` on
 * that yields "[object Object]", which would discard the `PGRST003` that names
 * the cause. That exact mistake was made and caught by a test on the first
 * version of this pattern.
 */
/**
 * `T` is inferred from the supabase result (`Foo | null`) and the return is
 * `NonNullable<T>`, so callers get `Foo` and stop needing null-assertions
 * downstream. Declaring the parameter as `T | null` instead infers
 * `T = Foo | null` and hands the null straight back — which type-checks and
 * defeats the point.
 */
export function rowOrThrow<T>(
  result: { data: T; error: unknown },
  absent: { code: ConstructorParameters<typeof TRPCError>[0]["code"]; message: string },
  /** Lowercase noun for the thing being read — "game", "match". Used in the
   *  message the reader sees and in the log line. */
  what: string
): NonNullable<T> {
  if (result.error) {
    console.error(
      JSON.stringify({
        tag: "query-failed",
        what,
        error:
          result.error instanceof Error
            ? result.error.message
            : typeof result.error === "object" && result.error !== null
              ? result.error
              : String(result.error),
      })
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Couldn't check the ${what} just now. This is temporary — try again in a moment.`,
    });
  }

  if (result.data == null) {
    throw new TRPCError(absent);
  }

  return result.data;
}
