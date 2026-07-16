import { describe, it, expect } from "vitest";
import { GAME_REALTIME_SUBSCRIPTIONS } from "./useRealtimeGame";

/**
 * useRealtimeGame — the subscription descriptor is the part with real risk (a wrong
 * table, or an `id`↔`game_id` filter slip that makes a whole table's events never
 * match). Lock it directly; the effect that wires it to supabase/utils is a thin,
 * house-style copy of useRealtimeMembers.
 *
 * The contract these guard:
 *  - the watched set is EXACTLY readGameConfigHash's fan-out (games + the four config
 *    child tables) — no more (score tables must stay OUT) and no less (a missing
 *    table = that class of change never propagates, the `.from("matches")` bug);
 *  - the game row filters by its PK `id`; every child table by `game_id`. A child
 *    filtered by `id` would match nothing.
 */
describe("useRealtimeGame — subscription descriptor", () => {
  it("watches exactly the five config tables (readGameConfigHash's fan-out)", () => {
    expect(GAME_REALTIME_SUBSCRIPTIONS.map((s) => s.table)).toEqual([
      "games",
      "game_matches",
      "game_participants",
      "play_groups",
      "game_delegates",
    ]);
  });

  it("never watches a score table (scores have their own poll + outbox)", () => {
    const tables = GAME_REALTIME_SUBSCRIPTIONS.map((s) => s.table) as string[];
    expect(tables).not.toContain("score_entries");
    expect(tables).not.toContain("match_hole_outcomes");
  });

  it("filters the game row by id (PK) and every child table by game_id", () => {
    const byTable = Object.fromEntries(GAME_REALTIME_SUBSCRIPTIONS.map((s) => [s.table, s.column]));
    expect(byTable.games).toBe("id");
    for (const child of ["game_matches", "game_participants", "play_groups", "game_delegates"]) {
      expect(byTable[child]).toBe("game_id");
    }
  });
});
