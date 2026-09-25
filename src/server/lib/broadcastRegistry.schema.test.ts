import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { BROADCAST_TABLES } from "@/lib/broadcastTables";

/**
 * THE REGISTRY EQUALS THE DATABASE (#1432) — both directions, no allowlist.
 *
 * `BROADCAST_TABLES` is what the client believes broadcasts: the handler's
 * `Record<BroadcastTable, …>` gives every entry a reader, and every format's
 * `scoreTables` must be drawn from it. This holds that belief equal to the
 * triggers that ACTUALLY exist once every migration has run, read from
 * `pg_trigger` through `_broadcast_triggers()` (migration 192):
 *
 *  - a table the client lists with NO trigger fails — the shape
 *    `skins_hole_outcomes` had until 192: declared as holding scores, silently
 *    never broadcasting, so other devices waited on a poll;
 *  - a trigger the client does NOT list fails — an event arriving that no reader
 *    refreshes, which is #1432 itself (and bracket picks, and Matches results
 *    before it).
 *
 * Against the MIGRATED schema, deliberately — not migration text, which cannot
 * see a later migration dropping or replacing a trigger (the one failure this
 * exists to catch). CI-only for that reason: only CI has a database.
 *
 * No allowlist. A guard with an exception for the case it was built to catch is
 * decorative; if a table legitimately stops broadcasting, it leaves
 * `BROADCAST_TABLES` in the same change.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function triggeredTables(): Promise<Set<string>> {
  const { data, error } = await ctx.admin.rpc("_broadcast_triggers");
  expect(error, error?.message).toBeNull();
  return new Set(((data ?? []) as { table_name: string }[]).map((r) => r.table_name));
}

describe("BROADCAST_TABLES and the migrated schema agree", () => {
  it("the read finds triggers at all — an empty schema read proves nothing", async () => {
    // Without this, both directions below would be vacuous against a broken
    // read: "every listed table has a trigger" fails loudly, but "every trigger
    // is listed" passes on an empty set.
    expect((await triggeredTables()).size).toBeGreaterThan(0);
  });

  it("every table the client lists has a broadcast trigger", async () => {
    const triggered = await triggeredTables();
    const untriggered = BROADCAST_TABLES.filter((t) => !triggered.has(t));
    expect(untriggered, "listed in BROADCAST_TABLES but no broadcast trigger in the schema").toEqual([]);
  });

  it("every broadcast trigger's table is one the client lists", async () => {
    const listed = new Set<string>(BROADCAST_TABLES);
    const unlisted = [...(await triggeredTables())].filter((t) => !listed.has(t)).sort();
    expect(unlisted, "broadcasts, but no client reader refreshes it").toEqual([]);
  });
});
