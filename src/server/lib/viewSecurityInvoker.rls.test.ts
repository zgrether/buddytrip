import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Every view in the EXPOSED schema must be `security_invoker`.
 *
 * ── The shape, arriving through a door nobody had swept ────────────────────
 *
 * A Postgres view defaults to running as its OWNER, not its caller. So a view
 * over RLS-protected tables, owned by `postgres`, hands every row to anyone who
 * can select from it — whatever the policies on the tables underneath say.
 *
 * That is the RLS audit's recurring shape (CLAUDE.md #28): a definer-ish
 * construct wider than the policy it serves. It has been found in FUNCTIONS
 * twice — `pickem_picks_open` (migration 147) and the un-REVOKEd definer cores
 * — and a view is the same hole through a door nobody had swept.
 *
 * `game_started` (migration 161) is the first view in this schema. Written
 * without `security_invoker` it would have silently widened every read the
 * leaderboard makes, because the leaderboard uses the USER's client and the two
 * direct queries it replaced were subject to RLS.
 *
 * ── The sweep came back clean, which is not the point ──────────────────────
 *
 * One view, correct. The value is in the NEXT view, added by someone with no
 * reason to know the default is wrong — and the failure is silent. Same
 * argument as `configHash.coverage.test.ts`: the mechanical form of a rule
 * beats the remembered one.
 *
 * Two guards, because they fail for different reasons:
 *
 *   SOURCE        a new `CREATE VIEW` in a migration that omits the option —
 *                 catches it before it is ever applied anywhere.
 *   BEHAVIOURAL   a caller actually seeing rows their RLS forbids — catches it
 *                 however the view got that way, including by hand on prod.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("source guard — a migration cannot add a definer-ish view", () => {
  it("every CREATE VIEW in public declares security_invoker", () => {
    const offenders: string[] = [];

    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8");
      // `CREATE [OR REPLACE] VIEW public.x` up to the AS that begins the body.
      // Matching to `AS` rather than to a line end is what makes a multi-line
      // declaration — which is how the option is usually written — still count.
      const re = /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(\w+)([\s\S]*?)\bas\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const [, name, between] = m;
        if (!/security_invoker\s*=\s*true/i.test(between)) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }

    expect(
      offenders,
      "a view over RLS tables defaults to its OWNER's rights — add WITH (security_invoker = true)"
    ).toEqual([]);
  });

  it("the guard can actually SEE a view — it is not passing on an empty scan", () => {
    // The assertion that would fail if the regex stopped matching anything, at
    // which point the guard above would go permanently green while covering
    // nothing. Absence of matches is absence of search.
    const all = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n");
    const found = all.match(/create\s+(?:or\s+replace\s+)?view/gi) ?? [];
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("behavioural guard — game_started does not leak past the caller's RLS", () => {
  it("an outsider sees nothing an owner sees", async () => {
    /**
     * Asserts the OUTCOME rather than the mechanism: a view that lost
     * `security_invoker` fails here even if a catalog read said something
     * reassuring, and this is reachable where the catalog is not (PostgREST
     * exposes neither `pg_class` nor `information_schema`).
     *
     * `outsider` is signed in and on NO trip. Every game in `game_started`
     * belongs to some trip, so a correctly-invoking view returns nothing to
     * them — and an owner-rights view would return the lot.
     */
    const tripId = await ctx.createTrip("view invoker Trip");
    const competitionId = await ctx.createCompetition(tripId, "view invoker Cup");
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: "gtt_pickem",
      name: "Invoker",
      competitionId,
    })) as { id: string };

    await ctx.admin.from("pickem_games").upsert({ game_id: g.id });
    await ctx.admin.from("pickem_slate_games").insert({
      id: `sg-invoker-${g.id}`,
      game_id: g.id,
      display_order: 0,
      away_team: "A",
      home_team: "B",
      multiplier: 1,
      result: "away",
    });

    // The owner is on the trip and sees it — without this half, a view that
    // returned nothing to ANYONE would pass the assertion below.
    const mine = await ctx
      .authedClient("owner")
      .from("game_started")
      .select("game_id")
      .eq("game_id", g.id);
    expect(mine.error).toBeNull();
    expect(mine.data ?? []).toHaveLength(1);

    const theirs = await ctx
      .authedClient("outsider")
      .from("game_started")
      .select("game_id")
      .eq("game_id", g.id);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toHaveLength(0);

    await ctx.admin.from("pickem_slate_games").delete().eq("game_id", g.id);
    await ctx.admin.from("games").delete().eq("id", g.id);
  });
});
