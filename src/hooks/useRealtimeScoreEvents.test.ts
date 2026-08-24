import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  COALESCE_WINDOW_MS,
  __resetInvalidationCoalescer,
} from "@/lib/invalidationCoalescer";

/**
 * useRealtimeScoreEvents — the shared, ref-counted channel registry.
 *
 * WHY THIS IS TESTED AND THE OTHER REALTIME HOOKS AREN'T: every other realtime
 * hook opens exactly one channel per mounted component and removes it on
 * unmount, so there is nothing to get wrong. This one is deliberately SHARED,
 * because under the panel model (CLAUDE.md #12) the board stays mounted beneath
 * an open game panel — so `CompetitionLeaderboard` and `GamePageHeader` are
 * routinely subscribed to the same competition at the same time.
 *
 * That sharing introduces a failure mode with no visible symptom at the seam:
 * if the FIRST surface to unmount removed the channel, the surface still on
 * screen would keep rendering, keep looking correct, and silently stop
 * receiving updates until the 5-minute backstop refetch. Nobody would file that
 * as "realtime is broken" — they'd file it as "the board felt slow once".
 * So the ref-counting is pinned here.
 *
 * The suite runs in `environment: "node"` (vitest.config.mts) — no renderer —
 * which is why `acquire` is exported and driven directly rather than through
 * `renderHook`.
 */

type Sub = (status: string) => void;

/** One fake channel per topic, capturing what the hook registered on it. */
class FakeChannel {
  onCalls: Array<{ type: string; filter: unknown; cb: (m: unknown) => void }> = [];
  subCb: Sub | null = null;
  constructor(public topic: string) {}
  on(type: string, filter: unknown, cb: (m: unknown) => void) {
    this.onCalls.push({ type, filter, cb });
    return this;
  }
  subscribe(cb: Sub) {
    this.subCb = cb;
    return this;
  }
  /** Deliver a broadcast to whatever the hook registered. */
  emit(payload: unknown) {
    for (const c of this.onCalls) c.cb({ payload });
  }
}

const created: FakeChannel[] = [];
const removed: FakeChannel[] = [];

vi.mock("@/lib/supabase", () => ({
  getRealtimeClient: () => ({
    channel: (topic: string) => {
      const c = new FakeChannel(topic);
      created.push(c);
      return c;
    },
    removeChannel: (c: FakeChannel) => {
      removed.push(c);
    },
  }),
}));

vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => ({}) } }));

const { acquire, scoreEventsTopic, SCORE_EVENT, makeScoreEventHandler } = await import(
  "./useRealtimeScoreEvents"
);

const TOPIC = scoreEventsTopic("comp-1");

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
  // The coalescer defers on a real timer; fake them so the window can be driven
  // deterministically rather than slept through.
  vi.useFakeTimers();
  __resetInvalidationCoalescer();
});

afterEach(() => {
  __resetInvalidationCoalescer();
  vi.useRealTimers();
});

describe("scoreEventsTopic", () => {
  it("does NOT collide with useRealtimeCompetition's `competition:{tripId}` topic", () => {
    // The pre-existing hook owns `competition:<tripId>`. This one is keyed by
    // COMPETITION id. Sharing the prefix would put two id spaces and two
    // meanings on one topic — the trigger in migration 096 emits this exact
    // string, so a change here is a change to the DB contract.
    expect(scoreEventsTopic("comp-1")).toBe("competition_events:comp-1");
    expect(scoreEventsTopic("comp-1").startsWith("competition:")).toBe(false);
  });
});

describe("makeScoreEventHandler — what a broadcast is allowed to do to the cache", () => {
  /**
   * The handler QUEUES its invalidations through `invalidationCoalescer` instead
   * of firing them inline, so nothing has run when it returns — `flushWindow()`
   * closes the window and lets the batch out. These assertions are unchanged
   * otherwise: same keys, same #10 pairing, same no-setData rule. Only WHEN the
   * calls happen moved, which is the whole point of the coalescer.
   */
  beforeEach(() => {
    __resetInvalidationCoalescer();
  });
  function flushWindow() {
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
  }

  /** A utils double that records calls and would expose any cache WRITE. */
  function fakeUtils() {
    const calls: string[] = [];
    const spy = (name: string) => ({
      invalidate: (i?: unknown) => calls.push(`${name}.invalidate(${JSON.stringify(i) ?? ""})`),
      setData: () => calls.push(`${name}.setData`),
      setInfiniteData: () => calls.push(`${name}.setInfiniteData`),
    });
    return {
      calls,
      utils: {
        competitions: { faceBootstrap: spy("faceBootstrap"), leaderboard: spy("leaderboard") },
        scores: { listByGame: spy("scores") },
        games: { bracketDraw: spy("bracketDraw") },
      },
    };
  }

  it("invalidates faceBootstrap AND leaderboard — #10, never the child alone", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeScoreEventHandler(utils as any, "trip-1", "comp-1")("g-1");
    flushWindow();

    // The bug this pins: invalidating only `leaderboard` is SILENTLY undone,
    // because LiveFaceClient re-seeds the child from the bootstrap via setData
    // and marks it fresh, so no refetch fires. With the poll now a 5-minute
    // backstop, that mistake would leave the board stale for minutes.
    expect(calls).toContain('faceBootstrap.invalidate({"tripId":"trip-1"})');
    expect(calls).toContain('leaderboard.invalidate({"tripId":"trip-1","competitionId":"comp-1"})');
  });

  it("routes the score change through INVALIDATION ONLY — #15, no cache write", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeScoreEventHandler(utils as any, "trip-1", "comp-1")("g-1");
    flushWindow();

    expect(calls).toContain('scores.invalidate({"tripId":"trip-1","gameId":"g-1"})');

    // THE SAFETY PROPERTY. `reconcileScores(local, server, protectedKeys)` is what
    // keeps the active enterer's in-flight cells (its own test file covers that);
    // it only runs on REFETCHED data. Any setData here would bypass it and clobber
    // the cell someone is mid-entry on — and, because the payload arrives on a
    // public topic, would also be the moment score data started leaking.
    // If this fails, do not relax it: remove the write.
    expect(calls.some((c) => c.includes("setData"))).toBe(false);
  });

  it("invalidates the whole scores key on a reconnect backfill (unknown game)", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeScoreEventHandler(utils as any, "trip-1", "comp-1")(null);
    flushWindow();
    expect(calls).toContain("scores.invalidate()");
  });

  /**
   * THE BRACKET'S SCORE — a pick is a result, and it was reaching nobody.
   *
   * `bracket_matches_pick_broadcast` (migration 118) fires on `winner_entrant_id`
   * changing and sends on this exact topic — the DB half worked and has its own
   * end-to-end test. What was missing was the key: this handler invalidated
   * faceBootstrap, leaderboard and scores, and a bracket renders from NONE of
   * them. It reads `games.bracketDraw`.
   *
   * Nothing else was going to catch it either. The draw is `STRUCTURE_QUERY`
   * (`staleTime: Infinity`, no poll), and `games.configHash` deliberately excludes
   * `winner_entrant_id` (CLAUDE.md #16 — a result must never churn the config
   * hash), so the ~20s config sync is silent on picks BY DESIGN. The only
   * invalidators were the picking client's own mutation and finalize: your picks
   * appeared, everyone else's never did.
   */
  it("invalidates the BRACKET DRAW — a pick is a result and nothing else refetches it", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeScoreEventHandler(utils as any, "trip-1", "comp-1")("g-1");
    flushWindow();

    expect(calls).toContain(
      'bracketDraw.invalidate({"tripId":"trip-1","gameId":"g-1"})',
    );
    // Still invalidate-only — a bracket pick is as much a SIGNAL as a hole score
    // (#20), and the refetch is what re-applies auth.
    expect(calls.some((c) => c.includes("setData"))).toBe(false);
  });

  it("invalidates the whole bracket-draw key on a reconnect backfill too", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeScoreEventHandler(utils as any, "trip-1", "comp-1")(null);
    flushWindow();
    expect(calls).toContain("bracketDraw.invalidate()");
  });

  /**
   * ONE INVALIDATOR, NOT TWO LISTS THAT HAPPEN TO MATCH (CLAUDE.md #22).
   *
   * The delta between the local pick path and this one WAS the bug, and it is the
   * same shape chat had: posting worked, receiving didn't. So rather than assert
   * the four keys by name — a list that drifts exactly as the last one did — this
   * asserts the PROPERTY: every query a bracket surface refetches after its own
   * pick must also be refetched when somebody else's arrives.
   *
   * `games.getById` is in the local set via finalize (the game row carries the
   * lock state) and is covered here by the games-lifecycle broadcast on `status` /
   * `corrections_open`, which is a different trigger and a different event — so it
   * is named as a deliberate exclusion rather than silently absent.
   */
  it("covers every key the local pick path refreshes", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeScoreEventHandler(utils as any, "trip-1", "comp-1")("g-1");
    flushWindow();

    // What BracketScoringSurface invalidates after a local pick / finalize.
    const localPickKeys = ["bracketDraw"];
    for (const key of localPickKeys) {
      expect(
        calls.some((c) => c.startsWith(`${key}.invalidate`)),
        `a remote pick must refresh '${key}' — the local pick path does, and the ` +
          `difference between those two lists is exactly how this broke`,
      ).toBe(true);
    }
  });

  /**
   * THE POINT OF THE COALESCER, pinned at the handler level.
   *
   * This is the production shape in miniature: a reset emits ~73 broadcasts
   * (measured) and a board with an open panel carries 3 handlers (measured), so
   * without coalescing one tap costs 73 × 3 invalidations per query. Here: 73
   * events across 3 handlers, and the assertion is that each query is
   * invalidated exactly ONCE.
   */
  it("collapses a whole broadcast storm to one invalidation per query", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = [0, 1, 2].map(() => makeScoreEventHandler(utils as any, "trip-1", "comp-1"));

    for (let i = 0; i < 73; i++) for (const h of handlers) h("g-1");
    expect(calls, "nothing should fire before the window closes").toEqual([]);

    flushWindow();

    const count = (needle: string) => calls.filter((c) => c.startsWith(needle)).length;
    expect(count("faceBootstrap.invalidate")).toBe(1);
    expect(count("leaderboard.invalidate")).toBe(1);
    expect(count("scores.invalidate")).toBe(1);
    // The bracket draw joined the key set when remote picks started reaching the
    // board; it coalesces exactly like the other three. The total moved 3 → 4
    // because there are four QUERIES now, not because a burst costs more — which
    // is the property this test exists to hold, and the per-query counts above are
    // what actually state it.
    expect(count("bracketDraw.invalidate")).toBe(1);
    expect(calls).toHaveLength(4); // 219 handler calls per query → 1 refetch each
  });

  it("keeps DIFFERENT games separate — the key is not too coarse", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = makeScoreEventHandler(utils as any, "trip-1", "comp-1");
    h("g-1");
    h("g-2");
    flushWindow();

    // Collapsing these onto one key would drop a real refetch for a second game
    // scored in the same window — the failure mode a too-coarse key produces.
    expect(calls).toContain('scores.invalidate({"tripId":"trip-1","gameId":"g-1"})');
    expect(calls).toContain('scores.invalidate({"tripId":"trip-1","gameId":"g-2"})');
  });

  it("does not let a per-game event swallow a reconnect backfill", () => {
    const { calls, utils } = fakeUtils();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = makeScoreEventHandler(utils as any, "trip-1", "comp-1");
    h("g-1");
    h(null); // reconnect: "something moved while you were away, refetch all"
    flushWindow();

    // The backfill is strictly BROADER than the per-game invalidation. If both
    // shared a key the narrower one would win and the reconnect would silently
    // refetch only one game.
    expect(calls).toContain("scores.invalidate()");
  });
});

describe("useRealtimeScoreEvents — shared channel registry", () => {
  it("opens ONE channel when two surfaces watch the same competition", () => {
    const a = vi.fn();
    const b = vi.fn();
    const relA = acquire(TOPIC, a);
    const relB = acquire(TOPIC, b);

    expect(created).toHaveLength(1);
    expect(created[0].topic).toBe(TOPIC);

    // ...and both surfaces receive the event.
    created[0].emit({ gameId: "g-1", competitionId: "comp-1" });
    expect(a).toHaveBeenCalledWith("g-1");
    expect(b).toHaveBeenCalledWith("g-1");

    relA();
    relB();
  });

  it("keeps the channel alive when only ONE of two surfaces unmounts", () => {
    const a = vi.fn();
    const b = vi.fn();
    const relA = acquire(TOPIC, a);
    const relB = acquire(TOPIC, b);

    relA(); // the game panel closes; the board underneath is still mounted

    expect(removed).toHaveLength(0);
    created[0].emit({ gameId: "g-2", competitionId: "comp-1" });
    expect(b).toHaveBeenCalledWith("g-2"); // the survivor still gets updates
    expect(a).not.toHaveBeenCalled(); // the departed one does not

    relB();
    expect(removed).toHaveLength(1); // torn down only on the LAST release
  });

  it("a double release does not tear down a channel someone else re-acquired", () => {
    const a = vi.fn();
    const relA = acquire(TOPIC, a);
    relA();
    expect(removed).toHaveLength(1);

    // A new surface opens the same competition; React may then run the old
    // effect's cleanup a second time (StrictMode / fast refresh).
    const b = vi.fn();
    const relB = acquire(TOPIC, b);
    expect(created).toHaveLength(2);

    relA(); // stale cleanup — must be inert
    expect(removed).toHaveLength(1);

    created[1].emit({ gameId: "g-3", competitionId: "comp-1" });
    expect(b).toHaveBeenCalledWith("g-3");

    relB();
  });

  it("listens for the broadcast event the trigger sends, not postgres_changes", () => {
    const rel = acquire(TOPIC, vi.fn());
    expect(created[0].onCalls).toHaveLength(1);
    expect(created[0].onCalls[0].type).toBe("broadcast");
    expect(created[0].onCalls[0].filter).toEqual({ event: SCORE_EVENT });
    rel();
  });

  it("backfills every listener on (re)connect with a null gameId", () => {
    const a = vi.fn();
    const b = vi.fn();
    const relA = acquire(TOPIC, a);
    const relB = acquire(TOPIC, b);

    created[0].subCb?.("SUBSCRIBED");

    // null = "something moved while we were away, but we don't know which game",
    // which the hook turns into a whole-key invalidate.
    expect(a).toHaveBeenCalledWith(null);
    expect(b).toHaveBeenCalledWith(null);

    a.mockClear();
    created[0].subCb?.("CHANNEL_ERROR");
    expect(a).not.toHaveBeenCalled();

    relA();
    relB();
  });

  /**
   * A DEAD SUBSCRIPTION MUST SAY SO — CLAUDE.md #22.
   *
   * The hook branched only on SUBSCRIBED, so a channel that never established was
   * indistinguishable from a healthy one with nothing to report. Found the hard
   * way while diagnosing the bracket-pick gap: the browser could not hold a
   * websocket at all (close code 1006), and `useRealtimeChat` and
   * `useRealtimeMembers` each said so in the console while THIS hook — the one
   * carrying every score and every pick — was silent.
   *
   * Asserts the three dead statuses individually rather than "logs on a bad
   * status", because branching on only one of them is exactly the shape of the
   * original defect.
   */
  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])("reports a dead channel (%s)", (status) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rel = acquire(TOPIC, vi.fn());

    created[0].subCb?.(status);

    expect(spy, `status ${status} must be reported, not swallowed`).toHaveBeenCalledTimes(1);
    const msg = String(spy.mock.calls[0][0]);
    expect(msg).toContain(TOPIC);
    expect(msg).toContain(status);

    spy.mockRestore();
    rel();
  });

  it("says nothing on a healthy subscribe", () => {
    // The other half — a hook that cried wolf on every connect would be ignored
    // within a day, which is the same outcome as saying nothing.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rel = acquire(TOPIC, vi.fn());
    created[0].subCb?.("SUBSCRIBED");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    rel();
  });

  it("separate competitions get separate channels", () => {
    const relA = acquire(scoreEventsTopic("comp-1"), vi.fn());
    const relB = acquire(scoreEventsTopic("comp-2"), vi.fn());
    expect(created.map((c) => c.topic)).toEqual([
      "competition_events:comp-1",
      "competition_events:comp-2",
    ]);
    relA();
    relB();
    expect(removed).toHaveLength(2);
  });

  it("tolerates a payload with no gameId rather than throwing", () => {
    const a = vi.fn();
    const rel = acquire(TOPIC, a);
    created[0].emit(undefined);
    created[0].emit({});
    expect(a).toHaveBeenNthCalledWith(1, null);
    expect(a).toHaveBeenNthCalledWith(2, null);
    rel();
  });
});
