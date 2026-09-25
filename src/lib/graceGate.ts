import { CONFIRM_GRACE_MS } from "@/lib/cellReconcile";

/**
 * The "just confirmed" protection both entry modes put around their reconcile —
 * ONE implementation (#1437), because the two inline copies shared a flaw.
 *
 * ── The flaw ──────────────────────────────────────────────────────────────
 *
 * A cell confirmed moments ago is protected for CONFIRM_GRACE_MS, so a response
 * already in flight when the write landed cannot revert it. Correct. But the
 * reconcile only ran when the server data CHANGED, and a protected cell is
 * skipped — so if another device's conflicting write arrived INSIDE the grace,
 * the cell was skipped then and never revisited: every later poll returned the
 * same data, TanStack's structural sharing kept the same object, and the
 * effect never re-ran. Two phones that scored a hole within ~10s of each other
 * — the ordinary case — never converged.
 *
 * Measured on #1439's preview, 2026-09-25. Hole 5: taps 13s apart, the winning
 * write's refetch landed after the loser's grace, converged. Hole 6: taps 2s
 * apart, the refetch landed at 21:13:32, inside a grace running to ~21:13:38 —
 * skipped, and four identical polls (21:13:52 → 21:14:54) never revisited it.
 *
 * ── The fix ───────────────────────────────────────────────────────────────
 *
 * `run` applies the reconcile now, and — if any cell was protected by grace —
 * runs it AGAIN with the same server snapshot the moment the earliest grace
 * ends. A newer `run` replaces the pending one, so the rerun always uses the
 * latest snapshot and never fires twice.
 */
export interface GraceGate<S> {
  /** A write for this cell was just confirmed by the server. */
  confirm(key: string): void;
  /** This cell no longer has a confirmed local write to protect (cleared). */
  forget(key: string): void;
  /**
   * Apply now with the cells still in grace; if there are any, apply again with
   * the same snapshot when the earliest grace ends.
   */
  run(server: S, apply: (server: S, graceKeys: ReadonlySet<string>) => void): void;
  /** Cancel a pending rerun (unmount). */
  dispose(): void;
}

export function createGraceGate<S>(opts: { graceMs?: number; now?: () => number } = {}): GraceGate<S> {
  const graceMs = opts.graceMs ?? CONFIRM_GRACE_MS;
  const now = opts.now ?? (() => Date.now());
  const confirmedAt = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const gate: GraceGate<S> = {
    confirm(key) {
      confirmedAt.set(key, now());
    },
    forget(key) {
      confirmedAt.delete(key);
    },
    run(server, apply) {
      cancel();
      const t = now();
      const graceKeys = new Set<string>();
      let nextExpiry: number | null = null;
      for (const [k, at] of confirmedAt) {
        const expiry = at + graceMs;
        if (t < expiry) {
          graceKeys.add(k);
          nextExpiry = nextExpiry === null ? expiry : Math.min(nextExpiry, expiry);
        } else {
          confirmedAt.delete(k);
        }
      }
      apply(server, graceKeys);
      if (nextExpiry !== null) {
        // +1ms so the rerun lands strictly AFTER the expiry it waits for.
        timer = setTimeout(() => {
          timer = null;
          gate.run(server, apply);
        }, nextExpiry - t + 1);
      }
    },
    dispose() {
      cancel();
    },
  };
  return gate;
}
