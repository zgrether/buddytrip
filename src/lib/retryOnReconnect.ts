/**
 * Automatic retry for unsynced scores (#1622).
 *
 * Every score saver (`useScoreSaver`, `useOutcomeSaver`, `useSkinsSaver`)
 * retries a failed write with backoff for about 15 seconds, then flags the cell
 * and keeps it in the durable outbox. Until this, the flagged cell was re-sent
 * only when someone tapped Retry or the game was opened again, so a phone that
 * walked out of a dead zone with the app open synced nothing on its own.
 *
 * Here: re-send the flagged cells, through each saver's own `retryCell` (the
 * same idempotent path as Retry), when there is a reason to think the network
 * is back:
 *  - the `online` event;
 *  - the page becoming visible again (the phone came out of a pocket);
 *  - every `intervalMs` while the page is visible.
 *
 * The interval is not redundant with `online`. `navigator.onLine` lies at one
 * bar (the score saver's own header says so): the browser can report online the
 * whole time requests fail, so `online` never fires because `offline` never did.
 * A trigger only ever causes a retry; nothing here SKIPS one on the strength of
 * the flag.
 *
 * Which cells: those in `error` that the server did NOT refuse. A refused cell
 * (a posted round, someone else's match — #1230) cannot start succeeding, and
 * re-sending it on every trigger would be the forever-retry #1230 removed from
 * the outbox. A cell in `saving` is skipped too, so overlapping triggers (an
 * `online` and a visibility change together) cannot double-send: the first
 * retry moves the cell to `saving` before the second looks.
 *
 * Pure and DOM-free (the event targets are passed in), so the node test suite
 * drives it with Node's own `EventTarget`.
 */

export type RetryStatusMap = Record<string, string | null | undefined>;

/** The cells an automatic retry should re-send: unsynced, and not refused. */
export function keysToRetry(saveStatus: RetryStatusMap, refusals: Record<string, string> | undefined): string[] {
  return Object.entries(saveStatus)
    .filter(([key, state]) => state === "error" && !(refusals && key in refusals))
    .map(([key]) => key);
}

/** How often a visible page re-checks for unsynced cells (ms). */
export const RETRY_INTERVAL_MS = 30_000;

export interface ReconnectTargets {
  /** Fires `online` — `window` in the app. */
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Fires `visibilitychange` and reports `visibilityState` — `document` in the app. */
  doc: Pick<EventTarget, "addEventListener" | "removeEventListener"> & { visibilityState: string };
  /** Called on every trigger; it decides whether anything needs sending. */
  onTrigger: () => void;
  intervalMs?: number;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

/**
 * The real timers, called as PLAIN functions. Not `{ setInterval, clearInterval }`:
 * that calls the browser's `setInterval` with the object as `this`, and browsers
 * throw "Illegal invocation" for it (Node does not, so only a browser saw it —
 * the first version crashed every game view on mount).
 */
const realTimers = {
  setInterval: ((fn: () => void, ms?: number) => setInterval(fn, ms)) as typeof setInterval,
  clearInterval: ((id?: ReturnType<typeof setInterval>) => clearInterval(id)) as typeof clearInterval,
};

/** Attach the three triggers; returns the detach function. */
export function attachReconnectTriggers({
  win,
  doc,
  onTrigger,
  intervalMs = RETRY_INTERVAL_MS,
  timers = realTimers,
}: ReconnectTargets): () => void {
  const onOnline = () => onTrigger();
  const onVisibility = () => {
    if (doc.visibilityState === "visible") onTrigger();
  };
  win.addEventListener("online", onOnline);
  doc.addEventListener("visibilitychange", onVisibility);
  const timer = timers.setInterval(() => {
    if (doc.visibilityState === "visible") onTrigger();
  }, intervalMs);
  return () => {
    win.removeEventListener("online", onOnline);
    doc.removeEventListener("visibilitychange", onVisibility);
    timers.clearInterval(timer);
  };
}
