import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scoreEventsTopic, SCORE_EVENT } from "./useRealtimeScoreEvents";

/**
 * The topic + event name are a TWO-SIDED CONTRACT between the emitting trigger
 * (migration 096) and this hook (which listens). A mismatch fails SILENTLY —
 * scores still save, the board still renders, and live updates just stop,
 * degrading to the 5-minute backstop. Nobody gets an error to chase.
 *
 * `broadcastScoreEvents.test.ts` proves the same contract far more deeply, by
 * subscribing with a real client and watching a write travel the whole chain.
 * But that needs a reachable Realtime server, which the CI runner does not
 * provide (the container starts; websocket joins never complete). So this file
 * exists to keep the contract enforced EVERYWHERE, statically, with no
 * infrastructure at all.
 *
 * Static is the right level for the durable risk anyway: on CI the database is
 * always rebuilt from these migration files, so file↔hook agreement IS the
 * runtime contract there. What this catches is someone renaming the topic on one
 * side and not the other — which is exactly how this breaks in practice.
 *
 * ── WHY THIS READS EVERY MIGRATION, NOT ONE FILENAME ─────────────────────────
 * It used to `readFileSync` migration 096 by name. That pinned a MOMENT, not the
 * contract: a LATER migration redefining the function was invisible to it. The
 * 2026-08-08 rules audit demonstrated the hole — a follow-up migration that
 * renamed the topic AND put a player name and score into the payload left all
 * eight assertions green, because the test was still reading 096.
 *
 * Both halves of that matter. A renamed topic silently stops live updates; a
 * payload with a name in it is a privacy failure, because the topic is
 * `private => false` and anyone who guesses it receives whatever we send.
 *
 * So the unit of truth here is the EFFECTIVE state after every migration has
 * been applied — the last definition of the function wins, and triggers are
 * reduced through their creates and drops in apply order. That is what the
 * database actually ends up running, which is the only thing worth asserting.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

/**
 * Every migration in APPLY order. Supabase orders by the `YYYYMMDDHHMMSS_`
 * filename prefix (CLAUDE.md — the `NNN` is cosmetic), so a plain filename sort
 * IS apply order. `_archive/` is a directory and drops out on the .sql filter.
 */
function migrationsInOrder(): { name: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"),
    }));
}

const MIGRATIONS = migrationsInOrder();

/** Every migration that (re)defines the emitter, in apply order. */
const FN_DEFINITIONS = MIGRATIONS.map(({ name, sql }) => {
  const m = sql.match(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.broadcast_score_event\s*\([\s\S]*?\$\$;/i,
  );
  return m ? { name, body: m[0] } : null;
}).filter((x): x is { name: string; body: string } => x !== null);

/**
 * The definition the database ends up with: the LAST one applied. Every
 * body-level assertion below runs against this, so superseding 096 moves the
 * assertions onto the new definition instead of hiding it.
 */
const effective = FN_DEFINITIONS[FN_DEFINITIONS.length - 1];

/**
 * Effective trigger state, reduced over every CREATE/DROP TRIGGER in apply
 * order. A trigger created in 096 and dropped in a later migration must read as
 * absent — which a per-file scan cannot see.
 */
function liveBroadcastTriggers(): Map<string, { table: string; stmt: string }> {
  const live = new Map<string, { table: string; stmt: string }>();
  const STMT =
    /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+public\.(\w+)\s*;|CREATE\s+TRIGGER\s+(\w+)([\s\S]*?);/gi;

  for (const { sql } of MIGRATIONS) {
    for (const m of sql.matchAll(STMT)) {
      const [stmt, dropName, , createName, createRest] = m;
      if (dropName) {
        live.delete(dropName);
        continue;
      }
      // Only triggers wired to OUR emitter are in scope.
      if (!/EXECUTE\s+FUNCTION\s+public\.broadcast_score_event\s*\(/i.test(createRest)) continue;
      const table = createRest.match(/ON\s+public\.(\w+)/i)?.[1];
      if (table) live.set(createName, { table, stmt });
    }
  }
  return live;
}

const TRIGGERS = liveBroadcastTriggers();
const tableOf = (table: string) => [...TRIGGERS.values()].find((t) => t.table === table);

describe("the effective emit/listen contract (all migrations, not one filename)", () => {
  it("finds migrations and an emitter at all — the scan must not pass on zero", () => {
    expect(MIGRATIONS.length, "no migrations found — MIGRATIONS_DIR is wrong").toBeGreaterThan(50);
    expect(
      FN_DEFINITIONS.length,
      "no CREATE OR REPLACE FUNCTION public.broadcast_score_event found in any migration",
    ).toBeGreaterThan(0);
    expect(effective.body).toContain("realtime.send");
  });

  it("the effective emitter uses the exact topic the hook subscribes to", () => {
    const prefix = scoreEventsTopic("");
    expect(prefix).toBe("competition_events:");
    expect(
      effective.body,
      `${effective.name} emits on a topic the hook does not subscribe to — live updates would stop silently`,
    ).toContain(`'${prefix}' || v_competition_id`);
  });

  it("the effective emitter sends the exact event name the hook filters on", () => {
    expect(effective.body).toContain(`'${SCORE_EVENT}'`);
  });

  it("does NOT reuse useRealtimeCompetition's `competition:{tripId}` topic", () => {
    // That prefix is already owned, keyed by TRIP not COMPETITION. Overloading it
    // would put two id spaces and two meanings on one topic.
    expect(effective.body).not.toMatch(/'competition:'\s*\|\|/);
  });

  it("broadcasts as a PUBLIC topic, which is only safe with a data-free payload", () => {
    expect(effective.body).toMatch(/jsonb_build_object\(\s*'gameId'[^)]*'competitionId'[^)]*\)/);
    // The payload must carry the two ids and nothing else. If this fails because
    // a field was added, remove the field — the topic is public and #15 depends
    // on us not applying payload data to the cache.
    const payload = effective.body.match(/jsonb_build_object\(([^)]*)\)/)?.[1] ?? "";
    const keys = [...payload.matchAll(/'([a-zA-Z]+)',/g)].map((m) => m[1]);
    expect(
      keys.sort(),
      `${effective.name} puts extra fields in a PUBLIC broadcast payload. The topic is ` +
        `private => false, so this is what an unauthenticated listener receives. Remove the field.`,
    ).toEqual(["competitionId", "gameId"]);
  });

  it("still has a live trigger on every table whose writes move the board", () => {
    for (const table of ["score_entries", "match_hole_outcomes", "game_results", "games"]) {
      expect(
        tableOf(table),
        `no live broadcast trigger on public.${table} — created and then dropped, or never created`,
      ).toBeTruthy();
    }
  });

  it("guards the live games trigger to the three lifecycle columns", () => {
    // Without this WHEN clause every settings save would broadcast — the
    // high-frequency behaviour migration 084 was right to refuse.
    const games = tableOf("games");
    expect(games, "no live trigger on public.games").toBeTruthy();
    for (const col of ["status", "corrections_open", "scoring_enabled"]) {
      expect(games!.stmt).toMatch(new RegExp(`OLD\\.${col}\\s+IS DISTINCT FROM NEW\\.${col}`));
    }
  });

  it("cannot fail the write it observes", () => {
    // A broadcast problem must never cost someone a hole they just entered.
    expect(effective.body).toContain("EXCEPTION");
    expect(effective.body).toContain("WHEN OTHERS THEN");
  });

  it("returns early for a standalone game instead of broadcasting", () => {
    expect(effective.body).toMatch(/IF v_competition_id IS NULL THEN\s*\n\s*RETURN NULL;/);
  });
});
