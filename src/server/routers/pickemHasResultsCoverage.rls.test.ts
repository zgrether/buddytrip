import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * OBSERVATIONAL coverage for `_pickem_has_results` — the parity suite's missing
 * half.
 *
 * ── Why the enumerated suite could not catch what it existed to catch ──────
 *
 * `pickemHasResultsParity.rls.test.ts` drives the SQL predicate and its
 * TypeScript mirror over the same states so they cannot drift. It stayed green
 * while they disagreed on the most common state in the feature.
 *
 * Migration 159 added a FOURTH arm — `pickem_slate_games.result` — and called
 * it "THE PRIMARY SOURCE during Run". The mirror was never grown, and the suite
 * had no case that resolved a slate game, so the absence was invisible: every
 * case exercised one of the three arms that predate 159. A test cannot see what
 * it is not asking about.
 *
 * The consequence was live. `scoringSettingsEditable(hasResults)` offered the
 * three scoring settings while `save_pickem_config` refused them — the screen
 * and the server disagreeing about one question, which is the exact defect the
 * parity suite exists to prevent.
 *
 * ── The general form, and the fix ──────────────────────────────────────────
 *
 * THE GUARD WAS NOT GROWN WHEN THE THING IT GUARDS WAS. An enumerated list has
 * to be remembered; a DERIVED one cannot fall behind. Same reasoning that makes
 * `configHash.coverage.test.ts` observational — it reads each hashed table's
 * live columns rather than listing them.
 *
 * So this reads the predicate's own body out of the MIGRATIONS, extracts every
 * table it consults, and asserts each one has a seeder here. A fifth arm
 * reading a new table fails immediately, naming the table, and cannot be
 * shipped with the mirror unchanged.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;

/** `_pickem_has_results`, as the migrations define it — the last CREATE OR
 *  REPLACE wins, which is what replaying them leaves in the database. */
async function predicateBody(): Promise<string> {
  // Read from the MIGRATION FILES, not the catalog: PostgREST exposes no
  // arbitrary-SQL RPC (deliberately), and the migration text is the thing a
  // reviewer actually changes.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // LAST definition wins, exactly as replaying the migrations would leave it.
  let body: string | null = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const m = sql.match(
      /CREATE OR REPLACE FUNCTION public\._pickem_has_results[\s\S]*?\$function\$([\s\S]*?)\$function\$/i
    );
    if (m) body = m[1];
  }
  if (!body) throw new Error("_pickem_has_results not found in any migration");
  return body;
}

/**
 * One seeder per table the predicate consults: make it say TRUE, then undo.
 *
 * Adding an arm means adding a row here, and the coverage assertion below is
 * what forces that rather than trusting anyone to remember.
 */
type Seeder = { set: () => Promise<void>; clear: () => Promise<void> };
const SEEDERS: Record<string, (c: () => TestContext, g: () => string) => Seeder> = {
  pickem_slate_games: (c, g) => {
    const id = genId("cov-sg");
    return {
      set: async () => {
        const r = await c().admin.from("pickem_slate_games").insert({
          id,
          game_id: g(),
          display_order: 0,
          away_team: "A",
          home_team: "B",
          multiplier: 1,
          result: "home",
        });
        expect(r.error, "seed pickem_slate_games").toBeNull();
      },
      clear: async () => {
        await c().admin.from("pickem_slate_games").delete().eq("game_id", g());
      },
    };
  },
  game_results: (c, g) => {
    const id = genId("cov-gr");
    return {
      set: async () => {
        const r = await c().admin.from("game_results").insert({
          id,
          game_id: g(),
          entity_type: "user",
          entity_id: c().getUser("owner").id,
          points: 1,
        });
        expect(r.error, "seed game_results").toBeNull();
      },
      clear: async () => {
        await c().admin.from("game_results").delete().eq("game_id", g());
      },
    };
  },
  game_matches: (c, g) => {
    const id = genId("cov-gm");
    return {
      set: async () => {
        const r = await c().admin.from("game_matches").insert({
          id,
          game_id: g(),
          match_number: 1,
          display_order: 0,
          side_a: { type: "user", id: c().getUser("owner").id },
          side_b: { type: "user", id: c().getUser("member").id },
          result: "a_win",
          status: "complete",
        });
        expect(r.error, "seed game_matches").toBeNull();
      },
      clear: async () => {
        await c().admin.from("game_matches").delete().eq("game_id", g());
      },
    };
  },
  games: (c, g) => ({
    set: async () => {
      const r = await c().admin.from("games").update({ status: "complete" }).eq("id", g());
      expect(r.error, "seed games.status").toBeNull();
    },
    clear: async () => {
      await c().admin.from("games").update({ status: "pending" }).eq("id", g());
    },
  }),
};

/** Both sides of the parity, asked the same question. */
async function sqlSays(): Promise<boolean> {
  const { data, error } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: gameId });
  expect(error).toBeNull();
  return data as boolean;
}
async function routerSays(): Promise<boolean> {
  const d = (await ctx.caller().pickem.get({ tripId, gameId })) as { hasResults: boolean };
  return d.hasResults;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("hasResults coverage Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  competitionId = await ctx.createCompetition(tripId, "hasResults coverage Cup");
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Coverage pick'em",
    competitionId,
  })) as { id: string };
  gameId = g.id;
  await ctx.admin.from("pickem_games").upsert({ game_id: gameId });
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

beforeEach(async () => {
  for (const make of Object.values(SEEDERS)) {
    await make(() => ctx, () => gameId).clear();
  }
});

describe("_pickem_has_results — coverage derived from the predicate itself", () => {
  it("every table the predicate CONSULTS has a seeder here", async () => {
    /**
     * The observational assertion, and the whole point of this file.
     *
     * A fifth arm reading a new table fails here by NAME, before anyone has to
     * notice the mirror is stale. That is the difference between a list that
     * must be remembered and one that cannot fall behind.
     */
    const body = await predicateBody();
    const consulted = [
      ...new Set(
        [...body.matchAll(/FROM\s+public\.([a-z_]+)/gi)].map((m) => m[1].toLowerCase())
      ),
    ].sort();

    expect(
      consulted.length,
      "the extraction found no tables — absence of matches is absence of search"
    ).toBeGreaterThan(0);

    const missing = consulted.filter((t) => !(t in SEEDERS));
    expect(
      missing,
      "the predicate gained an arm and this suite cannot exercise it — add a seeder, " +
        "and check the TypeScript mirror in pickem.ts grew the same arm"
    ).toEqual([]);
  });

  it("each arm INDEPENDENTLY makes both sides say true", async () => {
    // Driven off the derived list, not a written one — so a new arm is
    // exercised the moment its seeder lands, with no second place to update.
    const body = await predicateBody();
    const consulted = [
      ...new Set(
        [...body.matchAll(/FROM\s+public\.([a-z_]+)/gi)].map((m) => m[1].toLowerCase())
      ),
    ].sort();

    for (const table of consulted) {
      const seeder = SEEDERS[table](() => ctx, () => gameId);
      expect(await sqlSays(), `${table}: SQL before`).toBe(false);
      expect(await routerSays(), `${table}: router before`).toBe(false);

      await seeder.set();
      expect(await sqlSays(), `${table}: SQL after`).toBe(true);
      expect(await routerSays(), `${table}: router after`).toBe(true);

      await seeder.clear();
      expect(await sqlSays(), `${table}: SQL cleared`).toBe(false);
      expect(await routerSays(), `${table}: router cleared`).toBe(false);
    }
  });
});
