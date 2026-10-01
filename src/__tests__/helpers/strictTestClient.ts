import type { SupabaseClient } from "@supabase/supabase-js";

/** The local gateway's transient 502 (#664): this exact message, no Postgres code. */
export const KONG_UPSTREAM_502 = "An invalid response was received from the upstream server";

/**
 * A FAILED READ IS NEVER DATA — in the tests too (#1527).
 *
 * The app reads through the `rowOrThrow` family so a 502 can never become "no
 * rows" (#1468–#1470). The tests did not. `ctx.admin.from(...).select(...)`
 * under a local-stack 502 returns `{ data: null, error }`, and a test that reads
 * `data` then fails an assertion — `expected [] to have a length of 4`,
 * `expected undefined to match object` — which reads as a BEHAVIOUR regression.
 * That is the misdiagnosis this file exists to prevent: the failure has to say
 * it is infrastructure, so nobody goes looking for a bug in correct code.
 *
 * So the clients a test READS with (`ctx.admin`, `ctx.authedClient(...)`) are
 * wrapped: awaiting a query whose result carries the INFRASTRUCTURE signature
 * throws `TestInfrastructureError` instead of resolving. Everything else
 * resolves exactly as before — in particular a real Postgres refusal (RLS, a
 * constraint, a RAISE) still arrives as `{ error }` with its code, because
 * those are what tests assert on.
 *
 * NOT wrapped: the clients inside a tRPC caller. A procedure under test already
 * surfaces a 502 as its own explicit `TRPCError` ("Failed to save score: An
 * invalid response…"), and wrapping its client would change the code under test.
 */

export class TestInfrastructureError extends Error {
  /** The result the query actually produced, for helpers that classify it. */
  readonly original: { message: string; code?: string | null };
  constructor(where: string, result: { status?: number; error: { message: string; code?: string | null } }) {
    super(
      `[test infrastructure, not behaviour — #1527] ${where}: ${result.error.message} (HTTP ${result.status ?? "?"})`
    );
    this.name = "TestInfrastructureError";
    this.original = result.error;
  }
}

type QueryResult = { status?: number; error: { message: string; code?: string | null } | null };

/**
 * The infrastructure signature, and only it:
 *  - status 0 — the request never got an HTTP answer (postgrest-js reports a
 *    failed fetch this way);
 *  - 502 / 503 / 504 — the gateway or PostgREST could not serve it;
 *  - Kong's upstream message with no Postgres code (the #664 signature).
 * A Postgres error always carries a code and a 4xx, so none of these match one.
 */
export function isInfrastructureFailure(result: QueryResult): boolean {
  const e = result.error;
  if (!e) return false;
  if (result.status === 0) return true;
  if (result.status === 502 || result.status === 503 || result.status === 504) return true;
  return e.message === KONG_UPSTREAM_502 && !e.code;
}

function isThenable(v: unknown): v is PromiseLike<unknown> & object {
  return !!v && typeof v === "object" && typeof (v as { then?: unknown }).then === "function";
}

function wrapBuilder<T extends object>(builder: T, where: string): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "then") {
        const then = (target as unknown as PromiseLike<QueryResult>).then.bind(target);
        return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          then((result: QueryResult) => {
            if (isInfrastructureFailure(result)) {
              throw new TestInfrastructureError(where, result as Required<QueryResult> & { error: { message: string } });
            }
            return result;
          }).then(onFulfilled, onRejected);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        // Chained filters (.select().eq()…) return builders: keep wrapping them.
        return isThenable(out) ? wrapBuilder(out, where) : out;
      };
    },
  });
}

/** Wrap a client so its `.from()` and `.rpc()` queries throw on infrastructure failure. */
export function strictTestClient<T extends SupabaseClient>(client: T, label: string): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "from" || prop === "rpc") {
        return (...args: unknown[]) => {
          const builder = (value as (...a: unknown[]) => object).apply(target, args);
          return wrapBuilder(builder, `${label}.${String(prop)}(${JSON.stringify(args[0])})`);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
