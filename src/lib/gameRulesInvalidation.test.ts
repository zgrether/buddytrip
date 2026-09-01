import { describe, it, expect } from "vitest";
import {
  invalidateGameRulesQueries,
  type GameRulesInvalidationUtils,
} from "./gameRulesInvalidation";

/**
 * The invalidation-set parity this module exists to enforce.
 *
 * The bug: `GameRulesSheet` writes `rules_for_today` on close and then refreshed
 * `games.getById` + `games.listByTrip`. Four formats read `games.getById`, so
 * the edit came back; pick'em reads `pickem.get` and nothing else, so the write
 * landed in the database and the sheet re-opened showing the format starter —
 * the edit rendered as though it had never been saved.
 *
 * These pin the SET. A new query that renders the rules is added here once, not
 * once per write path.
 */

function fakeUtils() {
  const calls: Array<[string, unknown]> = [];
  const rec = (name: string) => ({
    invalidate: (input: unknown) => {
      calls.push([name, input]);
    },
  });
  const utils: GameRulesInvalidationUtils = {
    games: {
      getById: rec("games.getById"),
      listByTrip: rec("games.listByTrip"),
      configHash: { reset: (input: unknown) => { calls.push(["games.configHash.reset", input]); } },
    },
    pickem: { get: rec("pickem.get") },
  };
  return { utils, calls, names: () => calls.map(([n]) => n) };
}

describe("invalidateGameRulesQueries", () => {
  it("refreshes pick'em's ONLY read alongside the two games queries", () => {
    const { utils, names } = fakeUtils();
    invalidateGameRulesQueries(utils, { tripId: "t1", gameId: "g1" });
    // `pickem.get` is the assertion that matters — its absence IS the bug. The
    // exact set is pinned rather than a `toContain`, so dropping either games
    // query (which is how the four golf formats get their edit back) fails too.
    expect(names()).toEqual([
      "games.getById",
      "games.listByTrip",
      "pickem.get",
      // `rules_for_today` is a HASHED column, so the write moves the fingerprint
      // `games.saveConfig` checks — see `gameConfigHash.ts`.
      "games.configHash.reset",
    ]);
  });

  it("keys each query the way its own input is shaped", () => {
    // A game-scoped query invalidated with only `{tripId}` — or a trip-scoped
    // one handed a `gameId` it has no key for — silently matches nothing, which
    // is #22's partial-deep-equality trap. Pin the actual inputs.
    const { utils, calls } = fakeUtils();
    invalidateGameRulesQueries(utils, { tripId: "t1", gameId: "g1" });
    expect(Object.fromEntries(calls)).toEqual({
      "games.getById": { tripId: "t1", gameId: "g1" },
      "games.listByTrip": { tripId: "t1" },
      "pickem.get": { tripId: "t1", gameId: "g1" },
      "games.configHash.reset": { tripId: "t1", gameId: "g1" },
    });
  });

  it("does not branch on format — every format gets the same set", () => {
    // The sheet is rendered by `GameChromeActions` for all five formats and is
    // handed no format at all, so a set that depended on one could not be built
    // there. Two calls with different games must be indistinguishable in WHICH
    // queries they touch.
    const a = fakeUtils();
    const b = fakeUtils();
    invalidateGameRulesQueries(a.utils, { tripId: "t1", gameId: "golf-game" });
    invalidateGameRulesQueries(b.utils, { tripId: "t1", gameId: "pickem-game" });
    expect(a.names()).toEqual(b.names());
  });
});
