import { after } from "next/server";

/**
 * Run work AFTER the response is sent, without dropping it on the floor.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `games.finish` awaits `notifyCupClinchedIfDecided` on EVERY finalize —
 * deliberately, since a re-finish after a score correction can be the write that
 * decides the cup, and gating it on the pending→complete transition would lose
 * exactly that case. That reasoning is sound and is unchanged here.
 *
 * What it costs is not. Measured on a match re-lock (`slowPaths.measure.test.ts`),
 * `games.finish` is 24 DB requests with a serialization depth of 16 — and SEVEN
 * of those 16 sequential levels are the clinch check, which on that run ended in
 * `outcome: no_clincher, recipients: 0` and still wrote a `push_send_log` row.
 * 44% of the chain the user waits on, to usually decide nothing. Each level is
 * one DB round trip, which is the figure that multiplies in production.
 *
 * ── Why not a bare un-await ──────────────────────────────────────────────────
 * #829 flagged this precisely: "an un-awaited promise can be killed when a
 * serverless function freezes, so moving it off the critical path needs
 * `waitUntil`-style handling, not a bare un-await." `after()` IS that handling —
 * it is the framework's supported way to keep the invocation alive for work that
 * outlives the response. A bare `void` would make clinch delivery intermittent
 * in exactly the way that is hardest to diagnose.
 *
 * ── Why the fallback, and why it awaits ──────────────────────────────────────
 * `after()` needs a request scope. The vitest suites call procedures through
 * `createCallerFactory` — no Next request, no scope — and `after()` throws
 * there. The fallback runs the work inline and AWAITS it, which keeps those
 * tests observing the same end state they always have: a caller that returns
 * from `games.finish` has had the clinch check run. Deferral is a production
 * behaviour, not a semantic change the tests have to be taught about.
 *
 * The work is expected to swallow its own errors (both notify helpers do, and
 * `games.finish` relies on that already). The catch here is only for the
 * scope-detection, so a genuine failure inside `work` is still surfaced by the
 * work's own handling rather than silently becoming a fallback re-run.
 *
 * ── Verified, not assumed ────────────────────────────────────────────────────
 * That `after()` works inside a tRPC procedure (it runs in the Route Handler's
 * async context, several frames down) and that it does NOT hold the response are
 * both things a type signature cannot tell you. Both were measured against a
 * production build: the scope branch logged `deferred: true`, and with a
 * deliberate 2000 ms sleep injected into the deferred work the client-observed
 * `games.finish` round trip was unchanged at 151.5 ms while the work completed
 * 2005 ms later. The probe was temporary; this note is the record of it.
 */
export async function afterResponse(work: () => Promise<void>): Promise<void> {
  let deferred = false;
  try {
    after(work);
    deferred = true;
  } catch {
    // No request scope — a direct tRPC caller (tests, scripts).
  }
  if (!deferred) await work();
}
