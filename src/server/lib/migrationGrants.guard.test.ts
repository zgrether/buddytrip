import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1440 — every relation a fresh replay ends with states its Data API grants.
 *
 * WHY THE MIGRATION TEXT, NOT THE DATABASE. A runtime check of "every public
 * table has grants for the three roles" is INERT on today's stack: until
 * 2026-10-30 the platform's default ACL grants them whether or not a migration
 * says so, so it can only be green until the morning it is too late. What can
 * fail is the text: replay the migration history in order — create, drop,
 * rename, grant — and ask whether each relation left at the end had a GRANT
 * stated after it was created. Migration 211 states them for every relation
 * that existed on 2026-10-11; every CREATE TABLE after it must state its own.
 *
 * Two controls make it a guard rather than a decoration:
 *   - The parse's final set must EQUAL the migrated database's relations
 *     (`_public_relations()`, migration 212). A parser that missed a CREATE
 *     shape would otherwise leave that table unchecked and still pass.
 *   - The same parse, fed a copy of the history with ONE GRANT line removed,
 *     must name exactly that relation. That is the red-proof, kept as a
 *     standing case so the day the guard cannot fail, something says so.
 */

const ROOT = join(__dirname, "..", "..", "..");
const DIR = join(ROOT, "supabase", "migrations");

interface Migration {
  name: string;
  sql: string;
}

function readMigrations(): Migration[] {
  return readdirSync(DIR)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(DIR, name), "utf8") }));
}

/** SQL with comments and dollar-quoted bodies removed: a function body can say
 *  "create table" or "grant" in text that never runs as DDL here. */
function ddlOnly(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

const ONE = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const LIST = String.raw`((?:(?:"?public"?\.)?"?[a-z_][a-z0-9_]*"?\s*,\s*)*(?:"?public"?\.)?"?[a-z_][a-z0-9_]*"?)`;

const CREATE_TABLE = new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(if\s+not\s+exists\s+)?` + ONE, "i");
const CREATE_VIEW = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?` + ONE, "i");
const DROP = new RegExp(String.raw`^drop\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+exists\s+)?` + LIST, "i");
const RENAME = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?` + ONE + String.raw`\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?`, "i");
const GRANT = new RegExp(String.raw`^grant\s+[\s\S]+?\s+on\s+(?!function\b|schema\b|all\b|sequence\b|type\b|procedure\b|routine\b)(?:table\s+)?` + LIST + String.raw`\s+to\s`, "i");

const names = (list: string) =>
  list.split(",").map((n) => n.trim().replace(/"/g, "").replace(/^public\./i, ""));

/**
 * The relations a replay of `migrations` ends with, each with whether a GRANT
 * on it was stated after it was (last) created. A plain CREATE starts a
 * relation with NO stated grant — after 2026-10-30 that is what it has; an
 * `IF NOT EXISTS` that finds it already there changes nothing; a rename carries
 * the state across.
 */
function replay(migrations: Migration[]): Map<string, { granted: boolean; createdIn: string }> {
  const live = new Map<string, { granted: boolean; createdIn: string }>();
  for (const m of migrations) {
    for (const raw of ddlOnly(m.sql).split(";")) {
      const st = raw.trim();
      let x: RegExpMatchArray | null;
      if ((x = st.match(CREATE_TABLE))) {
        if (x[1] && live.has(x[2])) continue;
        live.set(x[2], { granted: false, createdIn: m.name });
      } else if ((x = st.match(CREATE_VIEW))) {
        if (!live.has(x[1])) live.set(x[1], { granted: false, createdIn: m.name });
      } else if ((x = st.match(DROP))) {
        for (const n of names(x[1])) live.delete(n);
      } else if ((x = st.match(RENAME))) {
        const e = live.get(x[1]);
        if (e) {
          live.delete(x[1]);
          live.set(x[2], e);
        }
      } else if ((x = st.match(GRANT))) {
        for (const n of names(x[1])) {
          const e = live.get(n);
          if (e) e.granted = true;
        }
      }
    }
  }
  return live;
}

const ungranted = (live: ReturnType<typeof replay>) =>
  [...live].filter(([, e]) => !e.granted).map(([n, e]) => `${n} (created in ${e.createdIn})`);

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("migration grants — every relation a replay ends with states its grants (#1440)", () => {
  const migrations = readMigrations();

  it("CONTROL: the parse ends with exactly the relations the migrated database has", async () => {
    const { data, error } = await ctx.admin.rpc("_public_relations");
    expect(error, error?.message).toBeNull();
    const fromDb = ((data ?? []) as { relation_name: string }[]).map((r) => r.relation_name).sort();
    expect(fromDb.length, "the catalogue read is not empty").toBeGreaterThan(40);
    expect([...replay(migrations).keys()].sort()).toEqual(fromDb);
  });

  it("every one of them has a GRANT stated after it was created", () => {
    expect(ungranted(replay(migrations))).toEqual([]);
  });

  it("RED-PROOF: remove one GRANT line from the history and the guard names that table", () => {
    const target = "GRANT ALL ON TABLE public.trips TO anon, authenticated, service_role;";
    const hit = migrations.filter((m) => m.sql.includes(target));
    expect(hit.map((m) => m.name), "the line to remove exists exactly once").toHaveLength(1);
    const broken = migrations.map((m) => (m.sql.includes(target) ? { ...m, sql: m.sql.replace(target, "") } : m));
    expect(ungranted(replay(broken))).toEqual([`trips (created in ${replay(migrations).get("trips")!.createdIn})`]);
  });

  it("a table CREATED with no grant after it is caught, wherever in the history it lands", () => {
    const later: Migration = { name: "99999999999999_999_new_table.sql", sql: "CREATE TABLE public.shiny_new (id text primary key);" };
    expect(ungranted(replay([...migrations, later]))).toEqual(["shiny_new (created in 99999999999999_999_new_table.sql)"]);
    const granted: Migration = { ...later, sql: later.sql + "\nGRANT SELECT ON TABLE public.shiny_new TO authenticated;" };
    expect(ungranted(replay([...migrations, granted]))).toEqual([]);
  });
});
