/**
 * The settings Save bar's progress curve — DISPLAY ONLY.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A settings save can take 10-20 seconds. Measured on 2026-09-04: a points-only
 * pick'em save took 16s, and the browser waterfall shows why — ~25 un-batched
 * `games.configHash` requests serialised at ~650ms each, the last landing at
 * 16.81s. `handleSave` awaits that last one, so the button sits on "Saving…" for
 * the whole queue.
 *
 * The write itself is long finished by then: `save_game_config` returns in
 * 130-442ms across every save measured. **What the runner is waiting on is
 * already-committed work being read back.** But an unchanging label for sixteen
 * seconds is indistinguishable from a hang, and the natural response is to tap
 * again — which is the thing worth preventing while Brad and BJ configure games.
 *
 * ── Why it is a FAKE bar, stated plainly ───────────────────────────────────
 *
 * There is no progress to report. The client cannot know how many refetches are
 * queued or how far through them it is, and inventing a signal for that would be
 * a worse lie than this one. What this bar honestly conveys is "the app is still
 * working and has not forgotten you", which is the actual question a runner is
 * asking at second nine.
 *
 * So it is deliberately ASYMPTOTIC: it approaches `CEILING_PERCENT` and never
 * arrives. A bar that reaches 100% and then keeps waiting has told a lie the user
 * can catch; one that visibly slows down has not. Only the save's return moves it
 * to 100.
 *
 * ── It cannot affect the save ──────────────────────────────────────────────
 *
 * Nothing here is awaited by `handleSave`, nothing cancels, nothing times out.
 * The bar reads a clock and returns a number. If this module threw on every call
 * the save would still land — which is the property to preserve if anyone edits
 * it.
 */

/**
 * The wait this curve is shaped for. Not a deadline and not a timeout — passing
 * it does nothing except leave the bar closer to the ceiling.
 *
 * 20s rather than the 16s measured: pacing to the observed median would have the
 * bar stall at the ceiling for every save that runs long, which is the one state
 * this is trying to avoid.
 */
export const SAVE_PROGRESS_TARGET_MS = 20_000;

/** The bar's asymptote. Reached only by a save that returns (see `SAVE_PROGRESS_DONE`). */
export const SAVE_PROGRESS_CEILING = 90;

/** What a returned save shows, before the bar disappears. */
export const SAVE_PROGRESS_DONE = 100;

/**
 * How often the bar re-reads the clock. 100ms is well under the ~150ms CSS
 * transition the fill carries, so the motion reads as continuous rather than
 * stepped, and it is 200 cheap renders across a 20s save rather than the ~1,200
 * a rAF loop would run.
 */
export const SAVE_PROGRESS_TICK_MS = 100;

/** How long 100% stays on screen after a save returns, when the panel does not
 *  close (a failed save keeps it open with its error). Long enough to read as an
 *  ending rather than a disappearance. */
export const SAVE_PROGRESS_DONE_HOLD_MS = 400;

/**
 * How many time-constants have elapsed at `SAVE_PROGRESS_TARGET_MS`.
 *
 * 3 puts the bar at 95% of the ceiling (85.5% absolute) on the 20s mark — far
 * enough along to read as "nearly there", with visible deceleration for the
 * whole second half. Raising it makes the bar rush and then sit; lowering it
 * makes it crawl.
 */
const TIME_CONSTANTS_AT_TARGET = 3;

/**
 * Percent complete to DISPLAY after `elapsedMs` of saving.
 *
 * Exponential ease-out: fast at first, decelerating forever toward the ceiling.
 * Monotonic, and bounded on both ends — a negative or non-finite clock reading
 * (a suspended tab, a clock adjustment) yields 0 rather than something the bar
 * would render as a jump backwards.
 */
export function saveProgressPercent(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const decay = Math.exp((-TIME_CONSTANTS_AT_TARGET * elapsedMs) / SAVE_PROGRESS_TARGET_MS);
  return SAVE_PROGRESS_CEILING * (1 - decay);
}
