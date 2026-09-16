import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeGameRefresh, type GameRefreshUtils } from "./useRealtimeGame";
import { makeScoreEventHandler } from "./useRealtimeScoreEvents";
import { COALESCE_WINDOW_MS, __resetInvalidationCoalescer } from "@/lib/invalidationCoalescer";

/**
 * makeGameRefresh — the TIMING contract `useRealtimeGame` now runs on.
 *
 * Coalescing trades immediacy for a bounded burst, and the risk it introduces is
 * not "too slow" (≤ one window) but "silently dropped": the coalescer dedupes by
 * key, so two DIFFERENT refreshes that share a key collapse into one and the other
 * never runs. Property 4 of the configHash work — a change reaches every phone —
 * rests on that not happening, and until this file it was reasoned rather than
 * measured.
 *
 * So the cases that matter are the ones a same-key burst test cannot see: two
 * different games inside one window, and a game refresh sharing the module-wide
 * window with a score event.
 */

type Call = { query: string; input: unknown };

function fakeUtils(calls: Call[]): GameRefreshUtils {
  const inv = (query: string) => ({ invalidate: (input: unknown) => void calls.push({ query, input }) });
  return {
    games: { getById: inv("games.getById"), configHash: inv("games.configHash"), listOrganizers: inv("games.listOrganizers") },
    matches: { listByGame: inv("matches.listByGame") },
    pickem: { get: inv("pickem.get") },
  };
}

const inputsFor = (calls: Call[], query: string) =>
  calls.filter((c) => c.query === query).map((c) => JSON.stringify(c.input)).sort();

beforeEach(() => {
  vi.useFakeTimers();
  __resetInvalidationCoalescer();
});
afterEach(() => {
  __resetInvalidationCoalescer();
  vi.useRealTimers();
});

describe("makeGameRefresh — coalesced config refresh", () => {
  it("a save's row-event burst costs ONE invalidation per query, after the window, not before", () => {
    const calls: Call[] = [];
    const refresh = makeGameRefresh(fakeUtils(calls), "trip-1", "game-1");

    // 49 = the structural save's measured event count on a 16-player, 8-match game.
    for (let i = 0; i < 49; i++) refresh();
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(COALESCE_WINDOW_MS - 1);
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(calls.map((c) => c.query).sort()).toEqual([
      "games.configHash",
      "games.getById",
      "games.listOrganizers",
      "matches.listByGame",
      "pickem.get",
    ]);
  });

  it("two DIFFERENT games refreshed inside one window both land — neither swallows the other", () => {
    const calls: Call[] = [];
    const utils = fakeUtils(calls);
    const refreshA = makeGameRefresh(utils, "trip-1", "game-A");
    const refreshB = makeGameRefresh(utils, "trip-1", "game-B");

    refreshA();
    vi.advanceTimersByTime(COALESCE_WINDOW_MS / 2);
    refreshB();
    refreshA();
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);

    // Exact inputs, per query: both games, each once. A key missing the game id
    // collapses these to ONE entry and this assertion names which query lost it.
    const both = [
      JSON.stringify({ tripId: "trip-1", gameId: "game-A" }),
      JSON.stringify({ tripId: "trip-1", gameId: "game-B" }),
    ].sort();
    for (const q of ["games.getById", "games.configHash", "games.listOrganizers", "matches.listByGame", "pickem.get"]) {
      expect(inputsFor(calls, q), q).toEqual(both);
    }
  });

  it("the same game in two different TRIPS stays two refreshes", () => {
    const calls: Call[] = [];
    const utils = fakeUtils(calls);
    makeGameRefresh(utils, "trip-1", "game-X")();
    makeGameRefresh(utils, "trip-2", "game-X")();
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(inputsFor(calls, "games.configHash")).toEqual(
      [JSON.stringify({ tripId: "trip-1", gameId: "game-X" }), JSON.stringify({ tripId: "trip-2", gameId: "game-X" })].sort()
    );
  });

  it("a config refresh and a SCORE event sharing the module-wide window both land", () => {
    // The coalescer is one process-wide map and timer. A score broadcast queued by
    // `makeScoreEventHandler` and a config refresh queued here share the flush — a
    // key collision between the two hooks would silently drop one side.
    const calls: Call[] = [];
    const refresh = makeGameRefresh(fakeUtils(calls), "trip-1", "game-1");

    const scoreCalls: string[] = [];
    const scoreInv = (name: string) => ({
      invalidate: (..._args: unknown[]) => void scoreCalls.push(name),
    });
    const scoreUtils = {
      competitions: { faceBootstrap: scoreInv("faceBootstrap"), leaderboard: scoreInv("leaderboard") },
      scores: { listByGame: scoreInv("scores.listByGame") },
      games: { bracketDraw: scoreInv("bracketDraw") },
      matches: { listByGame: scoreInv("score:matches.listByGame") },
    };
    const onScore = makeScoreEventHandler(scoreUtils as never, "trip-1", "comp-1");

    onScore("game-1");
    refresh();
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);

    expect(scoreCalls.sort()).toEqual(
      ["bracketDraw", "faceBootstrap", "leaderboard", "score:matches.listByGame", "scores.listByGame"].sort()
    );
    expect(calls.map((c) => c.query).sort()).toEqual([
      "games.configHash",
      "games.getById",
      "games.listOrganizers",
      "matches.listByGame",
      "pickem.get",
    ]);
  });

  it("a refresh arriving AFTER a flush runs in the next window rather than being lost", () => {
    const calls: Call[] = [];
    const refresh = makeGameRefresh(fakeUtils(calls), "trip-1", "game-1");
    refresh();
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(inputsFor(calls, "games.configHash")).toHaveLength(1);

    refresh(); // e.g. a second save's events, or the SUBSCRIBED backfill after a reconnect
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(inputsFor(calls, "games.configHash")).toHaveLength(2);
  });
});
