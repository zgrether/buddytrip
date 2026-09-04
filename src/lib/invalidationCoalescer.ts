/**
 * invalidationCoalescer — collapse a burst of identical cache invalidations into
 * one refetch per query.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * A production outage (10:08, `games.resetToSkeleton`) came from amplification,
 * not from a leak. Two multipliers stack on the score-events path:
 *
 *   1. Migration 096's triggers are `FOR EACH ROW`. A reset DELETEs every score
 *      row, so it emits ONE broadcast PER ROW — measured at **73 broadcasts** for
 *      a 4-player 18-hole round (`broadcastAmplification.measure.test.ts`).
 *   2. Every handler on the channel runs for every broadcast, and under the panel
 *      model (CLAUDE.md #12) a board with an open game panel carries **3**
 *      handlers (measured, `handler-accumulation.spec.ts`).
 *
 * 73 × 3 × 2 queries ≈ 438 refetches from one tap, each a `faceBootstrap`
 * (28 kB) or `leaderboard`. That saturated the edge and `/login` started
 * returning 504 — a failed mutation did not take the site down, the site went
 * down and took a mutation with it.
 *
 * The ref-counting was NOT at fault: handler count is stable at 1 across 20
 * panel open/close cycles. So this does not fix a leak — it caps the blast
 * radius, which is required whatever produces the next multiplier. With this in
 * place a burst costs one refetch per distinct query per window, so an
 * amplification is a slowdown instead of an outage.
 *
 * ── Why a timer, and why THIS window ─────────────────────────────────────────
 * Each websocket message arrives in its own event-loop task, so a microtask
 * flush would only collapse messages within a single task — nowhere near enough.
 * It needs a real window.
 *
 * The window is picked from the measured burst SHAPE, not from taste: those 73
 * broadcasts arrive over **4 ms** (largest gap between consecutive messages:
 * 1 ms) — they are one commit, delivered in one flush. Simulated against the
 * real arrival times, every window from 50 ms up collapses the whole reset to a
 * single flush. 100 ms is that floor with ~25× margin for a burst that spreads
 * wider over a real network than over loopback.
 *
 * This is a TRAILING fixed window, deliberately, rather than a resetting
 * debounce: a resetting debounce can be starved indefinitely by a sustained
 * stream — exactly the storm condition — and would turn a flood into silence.
 * A fixed window bounds added latency at `COALESCE_WINDOW_MS` no matter how long
 * the stream runs.
 *
 * The cost is ≤100 ms of extra latency on a live update. Against the 30s poll
 * this replaced, and the ~350 ms a refetch already takes, that is not
 * perceptible — and it is the price of the storm being survivable.
 */

/**
 * How long a coalescing window stays open. Exported so tests can drive it and so
 * the number is tunable in one place. See the burst-shape measurement above
 * before changing it — this is an evidence-backed floor plus margin, not a guess.
 *
 * ── 100 ms → 2000 ms, and the reason is a SECOND load shape ─────────────────
 *
 * The 100 ms above is correct for the shape it was measured against: 73
 * broadcasts arriving over 4 ms, one commit delivered in one flush. It is
 * sized to collapse a BURST, and it does.
 *
 * It does nothing for a SUSTAINED stream, which is the shape that took
 * production down on 2026-09-04. Six people entering scores produced 28 writes
 * a minute — one every ~2.1 seconds — so each broadcast landed in its own
 * window and every score cost every client a full refetch set. Measured:
 * ~200 Supabase reads per score entered, and 95% of the load in that window
 * was write-triggered fan-out rather than polling.
 *
 * The window is picked from the MEASURED inter-arrival distribution of the
 * incident's own score writes, not from a rate model. 73 consecutive pairs,
 * 18:00–18:12 UTC, `score_entries` + `match_hole_outcomes` POSTs:
 *
 *     median gap 1,841 ms
 *     within  250 ms   6 pairs   ( 8%)
 *     within    1 s   20 pairs   (27%)
 *     within    2 s   38 pairs   (52%)   <- chosen
 *     within    3 s   44 pairs   (60%)
 *     within    5 s   52 pairs   (71%)
 *
 * Arrivals are CLUSTERED, not uniform — a group enters several players' scores
 * for a hole together, then plays the next one. That matters: a uniform-rate
 * model of the same 28 writes/min puts them 2.1 s apart and predicts a 2 s
 * window collapsing almost nothing, which is wrong. (A Poisson model gets 48%
 * and is roughly right by luck; the measurement is 52%.) Do not re-derive this
 * from a rate — re-measure the gaps.
 *
 * 2000 ms sits just above the median gap, which is the natural knee: it halves
 * the fan-out at the rate that broke production, and it collapses MORE as the
 * rate rises, so it gets stronger exactly as the system gets busier. Sixteen
 * people make it work harder, not less.
 *
 * ── Why the added latency is affordable, specifically ──────────────────────
 *
 * The person entering the score never waits: their own value is optimistic and
 * on screen immediately (#15). The window only delays what OTHER clients see,
 * and the mechanism this replaced for them was a 30-second poll.
 *
 * ── What would change this number again ────────────────────────────────────
 *
 * Marking-stale-without-fetching (Zach's option D) removes the leaderboard,
 * cup and projection keys from the hot path entirely, leaving only the
 * entering pair's own match state — which is the LATENCY-SENSITIVE one ("2 UP",
 * "THRU 4" on a partner's phone). If that lands, re-examine this: the load
 * argument for a wide window mostly goes away, and the argument for a narrow
 * one gets stronger. Do not read 2000 ms as a floor the way 100 ms was a floor;
 * it is a response to a load shape that D is meant to remove.
 */
export const COALESCE_WINDOW_MS = 2000;

type Task = () => void;

/**
 * key → the invalidation to run at flush. A Map DEDUPES by key, which is what
 * collapses the two multipliers at once: N broadcasts carrying the same gameId
 * produce the same key, and the H handlers on a topic share tripId +
 * competitionId, so they do too.
 */
const pending = new Map<string, Task>();
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Queue `run` under `key`, to fire at the end of the current window.
 *
 * `key` must capture everything that distinguishes the invalidation — the query
 * plus its input. Two calls with the same key are treated as the same work and
 * only the last survives, so a key that is too COARSE silently drops a distinct
 * refetch (e.g. keying scores by trip alone would collapse two different games
 * into one). Too fine merely costs an extra refetch, which is the safe direction.
 */
export function coalesceInvalidation(key: string, run: Task): void {
  pending.set(key, run);
  if (timer !== null) return;
  timer = setTimeout(flush, COALESCE_WINDOW_MS);
}

function flush(): void {
  timer = null;
  if (pending.size === 0) return;
  // Snapshot and clear BEFORE running: an invalidation can synchronously trigger
  // another enqueue, and that one belongs to the NEXT window, not this drain.
  const tasks = [...pending.values()];
  pending.clear();
  for (const task of tasks) {
    try {
      task();
    } catch {
      // One bad invalidation must not strand the rest of the batch. The whole
      // point of this module is that a storm degrades gracefully.
    }
  }
}

/** Drop any pending work and close the window. FOR TESTS — the module holds
 *  process-wide state, so a test that queues work would otherwise leak it into
 *  the next one and make ordering matter. */
export function __resetInvalidationCoalescer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending.clear();
}
