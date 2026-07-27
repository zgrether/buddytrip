import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scoreEventsTopic, SCORE_EVENT } from "./useRealtimeScoreEvents";

/**
 * The topic + event name are a TWO-SIDED CONTRACT between migration 096's
 * trigger (which emits) and this hook (which listens). A mismatch fails
 * SILENTLY — scores still save, the board still renders, and live updates just
 * stop, degrading to the 5-minute backstop. Nobody gets an error to chase.
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
 */

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260728120000_096_broadcast_score_events.sql",
);

const sql = fs.readFileSync(MIGRATION, "utf8");

describe("096 ↔ useRealtimeScoreEvents — the emit/listen contract", () => {
  it("the migration emits on the exact topic the hook subscribes to", () => {
    // scoreEventsTopic('X') === 'competition_events:X', and the SQL builds the
    // same string by concatenation.
    const prefix = scoreEventsTopic("").replace(/:$/, ":");
    expect(prefix).toBe("competition_events:");
    expect(sql).toContain(`'${prefix}' || v_competition_id`);
  });

  it("the migration sends the exact event name the hook filters on", () => {
    expect(sql).toContain(`'${SCORE_EVENT}'`);
  });

  it("does NOT reuse useRealtimeCompetition's `competition:{tripId}` topic", () => {
    // That prefix is already owned, keyed by TRIP not COMPETITION. Overloading it
    // would put two id spaces and two meanings on one topic.
    expect(sql).not.toMatch(/'competition:'\s*\|\|/);
  });

  it("broadcasts as a PUBLIC topic, which is only safe with a data-free payload", () => {
    expect(sql).toMatch(/jsonb_build_object\(\s*'gameId'[^)]*'competitionId'[^)]*\)/);
    // The payload must carry the two ids and nothing else. If this fails because
    // a field was added, remove the field — the topic is public and #15 depends
    // on us not applying payload data to the cache.
    const payload = sql.match(/jsonb_build_object\(([^)]*)\)/)?.[1] ?? "";
    const keys = [...payload.matchAll(/'([a-zA-Z]+)',/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(["competitionId", "gameId"]);
  });

  it("wires a trigger on every table whose writes move the board", () => {
    for (const table of [
      "score_entries",
      "match_hole_outcomes",
      "game_results",
      "games",
    ]) {
      expect(sql).toContain(`ON public.${table}`);
    }
  });

  it("guards the games trigger to the three lifecycle columns", () => {
    // Without this WHEN clause every settings save would broadcast — the
    // high-frequency behaviour migration 084 was right to refuse.
    for (const col of ["status", "corrections_open", "scoring_enabled"]) {
      expect(sql).toMatch(new RegExp(`OLD\\.${col}\\s+IS DISTINCT FROM NEW\\.${col}`));
    }
  });

  it("cannot fail the write it observes", () => {
    // A broadcast problem must never cost someone a hole they just entered.
    expect(sql).toContain("EXCEPTION");
    expect(sql).toContain("WHEN OTHERS THEN");
  });

  it("returns early for a standalone game instead of broadcasting", () => {
    expect(sql).toMatch(/IF v_competition_id IS NULL THEN\s*\n\s*RETURN NULL;/);
  });
});
