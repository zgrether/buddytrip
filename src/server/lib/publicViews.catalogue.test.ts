import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1440 §4 — every view in `public` runs as its CALLER, read from the migrated
 * schema through `_public_relations()` (migration 212).
 *
 * The failure this exists for: a view owned by `postgres`, which bypasses RLS,
 * quietly giving every trip's rows to anyone who can select from it — with the
 * Data API grants, the anonymous key. `security_invoker` is what prevents it,
 * and a `CREATE OR REPLACE VIEW` that omits the option RESETS it (confirmed on
 * PostgreSQL 17.6), so the rule cannot live in anyone's memory. This reads the
 * setting the schema actually has after every migration ran.
 */

let ctx: TestContext;

interface Relation {
  relation_name: string;
  relkind: string;
  security_invoker: boolean;
}

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function relations(): Promise<Relation[]> {
  const { data, error } = await ctx.admin.rpc("_public_relations");
  expect(error, error?.message).toBeNull();
  return (data ?? []) as Relation[];
}

describe("_public_relations — views in public, from the migrated schema", () => {
  it("CONTROL: game_started is there, and invoker-security", async () => {
    // Without this, an empty result would read as "no views" when it means
    // "the read is broken", and the next case would pass with nothing checked.
    expect(await relations()).toContainEqual({ relation_name: "game_started", relkind: "v", security_invoker: true });
  });

  it("every view is security_invoker", async () => {
    const definer = (await relations()).filter((r) => r.relkind === "v" && !r.security_invoker).map((r) => r.relation_name);
    expect(definer, "views that would run as their owner (postgres bypasses RLS)").toEqual([]);
  });

  it("no materialized view in public — it stores its rows, so RLS never sees the read", async () => {
    const matviews = (await relations()).filter((r) => r.relkind === "m").map((r) => r.relation_name);
    expect(matviews).toEqual([]);
  });

  it("is callable by the service role only — not by a signed-in user", async () => {
    const { error } = await ctx.authedClient("member").rpc("_public_relations");
    expect(error, "a signed-in user must not be able to call _public_relations").not.toBeNull();
  });
});
