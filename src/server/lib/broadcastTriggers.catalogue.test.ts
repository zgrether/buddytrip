import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 192, against the MIGRATED schema — which tables actually carry a
 * broadcast trigger once every migration has run, read through
 * `_broadcast_triggers()` (service role only).
 *
 * The migration text cannot answer this: a later migration can drop or replace
 * a trigger, and a check that parses `CREATE TRIGGER` out of SQL files would
 * stay green while the trigger was gone — the one failure it exists to catch.
 * This reads `pg_trigger` after the fact.
 *
 * The realtime behaviour itself (`broadcastScoreEvents.test.ts`) is SKIPPED in
 * CI for want of a websocket, so this is what CI can prove about 192.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function broadcastTriggers(): Promise<{ table_name: string; trigger_name: string }[]> {
  const { data, error } = await ctx.admin.rpc("_broadcast_triggers");
  expect(error, error?.message).toBeNull();
  return (data ?? []) as { table_name: string; trigger_name: string }[];
}

describe("_broadcast_triggers — the tables that broadcast, from the migrated schema", () => {
  it("reads real triggers — the ones that already existed before 192", async () => {
    // The control. Without it, the skins assertion below could pass on a
    // function that returned something unrelated, and an empty result would read
    // as "no triggers" rather than "the read is broken".
    const tables = new Set((await broadcastTriggers()).map((r) => r.table_name));
    for (const t of ["score_entries", "match_hole_outcomes", "game_results", "games", "bracket_matches", "game_matches", "pickem_slate_games"]) {
      expect(tables.has(t), t).toBe(true);
    }
  });

  it("skins_hole_outcomes broadcasts (#1432) — the one score table that did not", async () => {
    const rows = await broadcastTriggers();
    expect(rows).toContainEqual({ table_name: "skins_hole_outcomes", trigger_name: "skins_hole_outcomes_broadcast" });
  });

  it("is callable by the service role only — not by a signed-in user", async () => {
    // `anonCallableRpcs.test.ts` already fails if an underscore function is
    // anon-callable; this pins the signed-in case too, which that test does not.
    const { error } = await ctx.authedClient("member").rpc("_broadcast_triggers");
    expect(error, "a signed-in user must not be able to call _broadcast_triggers").not.toBeNull();
  });
});
