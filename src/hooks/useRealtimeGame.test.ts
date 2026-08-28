import { describe, it, expect } from "vitest";
import { GAME_REALTIME_SUBSCRIPTIONS } from "./useRealtimeGame";

/**
 * useRealtimeGame — the subscription descriptor is the part with real risk (a wrong
 * table, or an `id`↔`game_id` filter slip that makes a whole table's events never
 * match). Lock it directly; the effect that wires it to supabase/utils is a thin,
 * house-style copy of useRealtimeMembers.
 *
 * ── This file was DEFENDING THE DEFECT ─────────────────────────────────────
 *
 * Its contract used to read "the watched set is EXACTLY readGameConfigHash's
 * fan-out". #1098 set out to widen that — it published `pickem_games`
 * (migration 151) and wrote a header saying the hook subscribed to it — but the
 * subscription never landed. This test then pinned the five-table set, so the
 * comment claimed one thing, the code did another, and the TEST protected the
 * code being wrong.
 *
 * The live consequence ran from #1098 to migration 160: pick'em's open / lock /
 * unlock reached other devices on the 60s poll alone. During a trip that is a
 * runner locking picks and sixteen phones not noticing for a minute.
 *
 * Second time this month a test has been found guarding a defect rather than an
 * intent — the other required `save_game_config` to drop the delegates key
 * SILENTLY (migration 158). Both were passing. A green test says the outcome
 * was pinned, never that the outcome was considered.
 *
 * The contract these guard NOW:
 *  - the watched set is readGameConfigHash's fan-out PLUS pick'em's clock and
 *    results, which are in no config hash — no more (GOLF's score tables must
 *    stay out) and no less (a missing table = that class of change never
 *    propagates, the `.from("matches")` bug, and `pickem_games` again);
 *  - the game row filters by its PK `id`; every child table by `game_id`. A
 *    child filtered by `id` would match nothing.
 */
describe("useRealtimeGame — subscription descriptor", () => {
  it("watches the config fan-out PLUS pick'em's clock and results", () => {
    expect(GAME_REALTIME_SUBSCRIPTIONS.map((s) => s.table)).toEqual([
      "games",
      "game_matches",
      "game_participants",
      "play_groups",
      "game_delegates",
      "pickem_games",
      "pickem_slate_games",
    ]);
  });

  it("watches pickem_games — the one this file used to pin as ABSENT", () => {
    // Called out on its own rather than left to the array above, because the
    // array is what was wrong and an equality assertion gives no signal about
    // WHICH entry mattered. This is the regression, named.
    const tables = GAME_REALTIME_SUBSCRIPTIONS.map((s) => s.table) as string[];
    expect(tables).toContain("pickem_games");
    expect(tables).toContain("pickem_slate_games");
  });

  it("never watches GOLF's score tables — they have an outbox this must not clobber", () => {
    // The rule is about the outbox and the active-enterer contract (#15), not
    // about the word "score". Pick'em results are in the set above precisely
    // because pick'em has no outbox and no per-cell optimism — one runner, one
    // RPC, nothing local for a refetch to overwrite.
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
