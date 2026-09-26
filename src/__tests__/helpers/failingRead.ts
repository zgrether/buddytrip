import type { SupabaseClient } from "@supabase/supabase-js";
import { createCallerFactory, type TRPCContext } from "../../server/trpc";
import { appRouter } from "../../server/router";
import type { TestContext } from "./test-setup";

/**
 * A real, authenticated tRPC caller whose client FAILS EXACTLY ONE READ —
 * `select(columns)` on `table` — and does everything else against the database.
 *
 * For "a failed read is never data to anything that writes" (#1411, #1468,
 * #1469). A failed read has to be simulated, because a local database does not
 * fail on demand; what makes the simulation honest is its NARROWNESS:
 *
 *  - Matched by table AND the exact column string, so the middleware's own read
 *    of the same table (a different select) still goes through. A test failing a
 *    whole table would trip an earlier refusal and pass for the wrong reason.
 *  - Only SELECT fails. `insert` / `update` / `delete` / `upsert` on the same
 *    table reach the database — the destructive write is the thing each test is
 *    watching for, so it must be able to happen.
 *
 * Callers should still assert the EXACT refusal sentence: a failure from any
 * other door produces a different one, so the test cannot pass by accident.
 */
export function callerFailingRead(
  ctx: TestContext,
  role: Parameters<TestContext["authedClient"]>[0],
  target: { table: string; columns: string },
) {
  const real = ctx.authedClient(role);
  const failure = { data: null, count: null, error: { code: "PGRST003", message: "simulated read failure" } };

  const failingChain = (): unknown => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte", "order", "limit", "range", "filter", "match", "or"]) {
      chain[m] = self;
    }
    chain.maybeSingle = async () => failure;
    chain.single = async () => failure;
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(failure).then(res, rej);
    return chain;
  };

  const client = new Proxy(real, {
    get(obj, prop, receiver) {
      if (prop !== "from") return Reflect.get(obj, prop, receiver);
      return (name: string) => {
        const builder = (Reflect.get(obj, "from", receiver) as unknown as (t: string) => object).call(obj, name);
        if (name !== target.table) return builder;
        return new Proxy(builder, {
          get(b, p, r) {
            if (p !== "select") return Reflect.get(b, p, r);
            return (columns: string, opts?: unknown) =>
              columns === target.columns
                ? failingChain()
                : (Reflect.get(b, "select", r) as (c: string, o?: unknown) => unknown).call(b, columns, opts);
          },
        });
      };
    },
  }) as SupabaseClient;

  const user = ctx.getUser(role);
  const trpcCtx: TRPCContext = { supabase: client, user: { id: user.id, email: user.email }, membershipCache: new Map() };
  return createCallerFactory(appRouter)(trpcCtx);
}
