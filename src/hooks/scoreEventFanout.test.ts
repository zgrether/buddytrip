import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { makeScoreEventHandler } from "./useRealtimeScoreEvents";
import {
  COALESCE_WINDOW_MS,
  __resetInvalidationCoalescer,
} from "@/lib/invalidationCoalescer";

/**
 * THE INSTRUMENT: how much work does ONE score event cost ONE client?
 *
 * Built before the fix it exists to measure, because four models died to
 * measurements this week and a fix you cannot tell moved the number is a fix
 * you cannot review.
 *
 * ── What it measures ───────────────────────────────────────────────────────
 *
 * A real `QueryClient` with real active observers, driven by the real
 * `makeScoreEventHandler`, counting REFETCHES — then weighting each refetch by
 * the Supabase reads its procedure performs.
 *
 * ── Why a real QueryClient, and why a fake `utils` would be USELESS here ────
 *
 * The obvious harness passes `{ invalidate: vi.fn() }` and counts calls. That
 * instrument cannot see the fix. `invalidateQueries({ refetchType: "none" })`
 * changes what an invalidation DOES — mark stale vs mark stale and refetch —
 * and does not change how many times `invalidate` is called. A call-counting
 * harness would report an identical number before and after and be read as
 * "the change did nothing".
 *
 * Verified against the installed `@tanstack/query-core` 5.90.20 rather than
 * from memory (`queryClient.js`):
 *
 *     this.#queryCache.findAll(filters).forEach((q) => q.invalidate());
 *     if (filters?.refetchType === "none") return Promise.resolve();
 *     return this.refetchQueries({ ...filters, type: ... ?? "active" });
 *
 * So the early return skips the refetch for ACTIVE observers too. Counting
 * fetches is the only way to see it.
 *
 * ── Where the weights come from ────────────────────────────────────────────
 *
 * Counted from the router source on 2026-09-04, bounding each procedure by its
 * SIBLINGS (the next `\n  <ident>: ` at the same indent) rather than by braces
 * — a tRPC procedure is a method chain whose first `{` belongs to
 * `z.object({...})` and closes immediately, so brace-balance reports 3 lines
 * and zero reads. An `awk` line-range reports 50 for `bracketDraw` by running
 * past the end of the router. Both wrong answers were produced on the way here;
 * this is CLAUDE.md's "measure the thing, not the region around it".
 *
 *   faceBootstrap        4 direct + myDelegateGameIds (1)            =  5
 *                        (was 14 — computeCompetitionLeaderboard's 9 left
 *                         with the state half in #1281 step 1)
 *   leaderboard          0 direct + computeCompetitionLeaderboard (9) =  9
 *   matches.listByGame   4
 *   scores.listByGame    2
 *
 * ── faceBootstrap was 13 here, and the "corroboration" was not one ─────────
 *
 * This said "13 is independently corroborated by the companion Phase 0 report,
 * which arrived at the same figure by reading the procedure by hand." Both
 * numbers were wrong and they were wrong the SAME WAY: each counted the four
 * direct `.from(...)` calls plus `computeCompetitionLeaderboard`'s nine, and
 * each missed that `myDelegateGameIds` is a helper doing its own read of
 * `game_delegates`. Two methods sharing one blind spot agree, and the agreement
 * reads as confirmation.
 *
 * That is a FALSE CONFIRMATION, not a weak check — the same shape as the
 * em-dash regex satisfied by the row's own sub-title, arriving through
 * arithmetic instead of a matcher. The tell was available and I did not take
 * it: "independent" was doing work the two derivations had not earned, because
 * both counted reads the same way and only the reads' LOCATIONS differed.
 *
 * The correction is worth more than one read. Every delta in the fan-out work
 * is measured against this baseline (#1281 step 0), so carrying a wrong
 * denominator would have made each later step look slightly better than it was.
 *
 * `bracketDraw` delegates its reads to a helper and is not weighted here; it is
 * also not mounted for a match-play game, which is the shape being measured.
 * Its refetch is still COUNTED, so it cannot vanish from the fan-out unnoticed.
 *
 * ── What this is not, and HOW TO TURN IT INTO A PRODUCTION NUMBER ──────────
 *
 * Not an end-to-end measurement. It models ONE client with every observer
 * mounted, and multiplies nothing by the number of people on the trip. This
 * instrument is the deterministic half that runs in CI; the `edge_logs` query
 * below is the half that needs real load.
 *
 * TWO CORRECTIONS ARE REQUIRED to get from this number to a production one,
 * and both were established by measuring two real stress tests (2026-09-04,
 * 18:00 and 21:25 UTC, six clients each). Carry them or the estimate is wrong.
 *
 * **1. THIS IS PER-EVENT. PRODUCTION IS PER-WRITE. They are not the same.**
 *
 * `invalidationCoalescer` sits between them: a trailing window collapses
 * several score writes into ONE flush, so production's reads-per-write is this
 * number divided by the collapse factor. For a window `W` and a write rate `λ`
 * the collapse is roughly `1 + λW`, and it is RATE-DEPENDENT — the coalescer
 * does more work the busier the system gets, and almost nothing when writes are
 * sparse. Measured: 1.05 writes per flush at 0.47 writes/s with W=100ms;
 * 3.53 at 1.27 writes/s with W=2000ms.
 *
 * This is a real limitation of the tool, not a discrepancy to explain away. An
 * unchanged number here can still mean a large production change, and vice
 * versa, purely because the write rate moved.
 *
 * **2. MULTIPLY BY ~1.22 FOR PER-REQUEST OVERHEAD, which this cannot see.**
 *
 * The weights below count each PROCEDURE's own Supabase reads. Every tRPC HTTP
 * request additionally pays the `trip_members` membership gate and the
 * middleware's `/auth/v1/user` call, and no procedure weight includes them.
 * Measured over 12,649 reads on 2026-09-04 21:26–21:29: `trip_members` 1,821
 * (14.4%) and `/auth/v1/user` 950 (7.5%) — **~22% of all reads**.
 *
 * (Worth knowing on its own: the membership gate is now the SECOND-LARGEST read
 * path in the system, behind only `games`. It did not get more expensive —
 * everything around it shrank. That is #1097 / #1214 territory.)
 *
 * ── The model, and it predicts both runs ───────────────────────────────────
 *
 *     reads per write ≈ [ N × R / (1 + λW) ] × 1.22 + baseline/write
 *
 *   N = clients · R = this instrument's number · λ = writes/s · W = window
 *
 *   2026-09-04 18:03  R=29 W=0.1s λ=0.47  → predicted 212, observed 191
 *   2026-09-04 21:26  R=20 W=2.0s λ=1.27  → predicted  46, observed  49
 *
 * Within 6% and 11%. `R=20` rather than 11 for the second because most clients
 * were on the GAME PAGE, where `GamePageHeader` keeps `leaderboard` active even
 * though the board beneath is covered (#1280) — the visibility rule composes
 * per-surface, so which R applies depends on what is on screen.
 *
 * ── The write rate dominates everything, and a real round is GENTLE ────────
 *
 * A stress test is not a scaled-down trip. Six people tapping produced **76
 * writes/min**. A real 16-player round is 16 × 18 holes over ~4.5 hours ≈
 * **1.1 writes/min** — roughly **70× less**. Projections from the same model:
 *
 *   16 clients, stress-shaped (λ=3.4/s)      ~186 req/s
 *   16 clients, real-round-shaped (λ=0.02/s)  ~24 req/s
 *   6 clients, measured 2026-09-04 21:25      ~63 req/s   (held, zero PGRST003)
 *   6 clients, measured 2026-09-04 18:03      ~89 req/s   (pool exhausted)
 *
 * So the coalescer buys the most in the shape that does not occur in play and
 * the least in the shape that does — at a real round's rate there is nothing
 * arriving close enough together to collapse, and the load is simply `λ·N·R`
 * with a tiny λ. Baseline polling (~55 reads/client/min) becomes the dominant
 * term instead. Know which shape you are estimating before quoting a number.
 *
 * ── The production half, so a re-run is comparable ─────────────────────────
 *
 * Run this against the Supabase logs over the stress-test window. Keep the
 * window and the shape identical between runs or the comparison is worthless.
 *
 * COUNT BOTH WRITE PATHS. The first run of this query counted only
 * `score_entries`; the second window had `match_hole_outcomes` writes as well,
 * and omitting them would have inflated reads-per-write by a third. (The
 * 2026-09-04 18:00 window happens to have zero outcome writes, so the two
 * baselines remain comparable — verified rather than assumed.)
 *
 * AND COMPARE LIKE WITH LIKE ON RATE. A per-SECOND peak against a per-MINUTE
 * average is not a comparison. Both runs peaked at ~262 requests in a single
 * second; what actually diverged was SUSTAINED load (89/s vs 63/s over a
 * minute) and reads-per-write. Reporting the peaks as a 3× improvement was one
 * keystroke away and would have been wrong.
 *
 *     select toStartOfMinute(timestamp) as min,
 *       countIf(log_attributes['request.method']='POST'
 *           and log_attributes['request.path']='/rest/v1/score_entries') as score_writes,
 *       countIf(log_attributes['request.method'] in ('GET','HEAD')) as reads
 *     from logs where source='edge_logs'
 *       and timestamp >= toDateTime('<start>') and timestamp < toDateTime('<end>')
 *     group by min order by min
 *
 * Divide `reads` by (score_writes + outcome_writes) per minute. Ignore minutes
 * where the pool was already exhausted — retries inflate the numerator and the
 * ratio stops meaning what it says.
 *
 * TWO MEASURED RUNS, six clients each, both 2026-09-04:
 *
 *   18:02–18:04  208 / 191 / 226 reads per write   pool EXHAUSTED (PGRST003)
 *   21:26 / 21:28   48.8 / 58.3 reads per write    zero PGRST003, zero 5xx
 *
 * The second run is the current baseline. Use its clean high-write minutes
 * (21:26 and 21:28 had no over-5s requests); the low-write minutes give wildly
 * inflated ratios because baseline polling does not scale with writes.
 */

/** Supabase reads performed by each procedure a score event invalidates. */
const READS_PER_QUERY: Record<string, number> = {
  faceBootstrap: 5,
  leaderboard: 9,
  "matches.listByGame": 4,
  "scores.listByGame": 2,
  bracketDraw: 0, // delegated to a helper; counted but not weighted (see above)
};

const TRIP = "trip-1";
const COMP = "comp-1";
const GAME = "game-1";

/** Query keys standing in for tRPC's. The policy under test is invalidate →
 *  refetch, which is key-shape agnostic; only the mapping has to be 1:1. */
const KEYS: Record<string, unknown[]> = {
  faceBootstrap: ["competitions", "faceBootstrap", { tripId: TRIP }],
  leaderboard: ["competitions", "leaderboard", { tripId: TRIP, competitionId: COMP }],
  "matches.listByGame": ["matches", "listByGame", { tripId: TRIP, gameId: GAME }],
  "scores.listByGame": ["scores", "listByGame", { tripId: TRIP, gameId: GAME }],
  bracketDraw: ["games", "bracketDraw", { tripId: TRIP, gameId: GAME }],
};

type Harness = {
  client: QueryClient;
  fetches: Record<string, number>;
  unsubscribe: () => void;
  utils: Parameters<typeof makeScoreEventHandler>[0];
};

/**
 * A client with every score-event observer MOUNTED AND ACTIVE — which is the
 * real state during score entry: nothing unmounts (the board is "HIDDEN, not
 * unmounted", and `MatchGameView`'s hooks sit above its `screen === "score"`
 * early return).
 */
async function mountAllObservers(): Promise<Harness> {
  const fetches: Record<string, number> = {};
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });

  const unsubs: Array<() => void> = [];
  for (const [name, queryKey] of Object.entries(KEYS)) {
    fetches[name] = 0;
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        fetches[name] += 1;
        return name;
      },
    });
    unsubs.push(observer.subscribe(() => {}));
  }

  // Let the initial mount fetches settle, then zero the counters so we measure
  // only what the EVENT caused.
  await vi.waitFor(() =>
    expect(Object.values(fetches).every((n) => n > 0)).toBe(true)
  );
  for (const k of Object.keys(fetches)) fetches[k] = 0;

  const inv = (name: string) => () =>
    client.invalidateQueries({ queryKey: KEYS[name] });

  const utils = {
    competitions: {
      faceBootstrap: { invalidate: inv("faceBootstrap") },
      leaderboard: { invalidate: inv("leaderboard") },
    },
    scores: { listByGame: { invalidate: inv("scores.listByGame") } },
    games: { bracketDraw: { invalidate: inv("bracketDraw") } },
    matches: { listByGame: { invalidate: inv("matches.listByGame") } },
  } as unknown as Parameters<typeof makeScoreEventHandler>[0];

  return { client, fetches, utils, unsubscribe: () => unsubs.forEach((u) => u()) };
}

function report(fetches: Record<string, number>) {
  const refetched = Object.entries(fetches).filter(([, n]) => n > 0);
  const reads = refetched.reduce((sum, [k]) => sum + (READS_PER_QUERY[k] ?? 0), 0);
  return { keys: refetched.map(([k]) => k).sort(), refetchCount: refetched.length, reads };
}

describe("score-event fan-out — the instrument", () => {
  beforeEach(() => {
    __resetInvalidationCoalescer();
  });
  afterEach(() => {
    __resetInvalidationCoalescer();
    vi.useRealTimers();
  });

  it("MEASURES what one score event costs one client", async () => {
    const h = await mountAllObservers();
    const handler = makeScoreEventHandler(h.utils, TRIP, COMP);

    handler(GAME);

    /**
     * EVERY WAIT HERE IS EXPRESSED IN `COALESCE_WINDOW_MS`, and that is not
     * tidiness — it is the bug this line already had.
     *
     * The invalidations are queued through `invalidationCoalescer` and flush on
     * a trailing timer, so any wait with a duration of its own is coupled to a
     * constant in another file. This used a bare `vi.waitFor`, whose default
     * timeout is 1000 ms. #1273 then moved the window from 100 ms to 2000 ms —
     * and because CI tests the MERGE RESULT while this branch still carried
     * 100 ms, the suite passed locally and failed in CI with the flush arriving
     * a second after the assertion had given up.
     *
     * Drain the window first, THEN wait for the refetches it triggered.
     */
    await new Promise((r) => setTimeout(r, COALESCE_WINDOW_MS + 100));
    await vi.waitFor(
      () => expect(Object.values(h.fetches).some((n) => n > 0)).toBe(true),
      { timeout: COALESCE_WINDOW_MS + 2000 }
    );

    const r = report(h.fetches);
    console.log(
      `[fan-out] one score event → ${r.refetchCount} refetches, ` +
        `${r.reads} Supabase reads per client · keys: ${r.keys.join(", ")}`
    );

    /**
     * TODAY'S NUMBER, pinned so a change has to be deliberate. When the
     * visibility rule lands, the suppressed keys drop out of `keys` and this
     * expectation is updated in the same PR — which is the entire point of
     * having it: the diff shows the number moving.
     */
    expect(r.keys).toEqual([
      "bracketDraw",
      "faceBootstrap",
      "leaderboard",
      "matches.listByGame",
      "scores.listByGame",
    ]);
    expect(r.reads).toBe(20);

    h.unsubscribe();
  });

  /**
   * THE INSTRUMENT MUST BE ABLE TO GO RED, and specifically it must be able to
   * see the fix. This drives the same handler against a client whose
   * invalidations use `refetchType: "none"` — the mechanism the visibility rule
   * will use — and asserts the measured number COLLAPSES.
   *
   * Without this case, a harness that counted `invalidate` calls instead of
   * fetches would look identical here and report no change after the fix. This
   * is the case that proves it is measuring the right thing.
   */
  it("SEES a suppressed refetch — proving it measures fetches, not calls", async () => {
    const fetches: Record<string, number> = {};
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
    });
    const unsubs: Array<() => void> = [];
    for (const [name, queryKey] of Object.entries(KEYS)) {
      fetches[name] = 0;
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn: async () => {
          fetches[name] += 1;
          return name;
        },
      });
      unsubs.push(observer.subscribe(() => {}));
    }
    await vi.waitFor(() =>
      expect(Object.values(fetches).every((n) => n > 0)).toBe(true)
    );
    for (const k of Object.keys(fetches)) fetches[k] = 0;

    // Everything EXCEPT the hot set is marked stale without fetching.
    const HOT = new Set(["scores.listByGame", "matches.listByGame"]);
    const inv = (name: string) => () =>
      client.invalidateQueries({
        queryKey: KEYS[name],
        ...(HOT.has(name) ? {} : { refetchType: "none" as const }),
      });

    const utils = {
      competitions: {
        faceBootstrap: { invalidate: inv("faceBootstrap") },
        leaderboard: { invalidate: inv("leaderboard") },
      },
      scores: { listByGame: { invalidate: inv("scores.listByGame") } },
      games: { bracketDraw: { invalidate: inv("bracketDraw") } },
      matches: { listByGame: { invalidate: inv("matches.listByGame") } },
    } as unknown as Parameters<typeof makeScoreEventHandler>[0];

    makeScoreEventHandler(utils, TRIP, COMP)(GAME);
    await new Promise((r) => setTimeout(r, COALESCE_WINDOW_MS + 100));

    const r = report(fetches);
    console.log(
      `[fan-out · stale-not-fetched] ${r.refetchCount} refetches, ${r.reads} reads`
    );

    expect(r.keys).toEqual(["matches.listByGame", "scores.listByGame"]);
    expect(r.reads).toBe(6);

    // And the suppressed ones ARE stale — marked, just not fetched. That is the
    // half the visibility rule has to complete; if this ever reads `false` the
    // suppression has become a no-op and the fix is inert.
    expect(client.getQueryState(KEYS.faceBootstrap)?.isInvalidated).toBe(true);
    expect(client.getQueryState(KEYS.leaderboard)?.isInvalidated).toBe(true);

    unsubs.forEach((u) => u());
  });
});
