"use client";

import { CloudOff, RefreshCw } from "lucide-react";

/**
 * UnsavedScoresBanner — the always-visible safety net (Connectivity Layer 1).
 *
 * Per-cell badges flag failures, but the entry view shows one hole at a time —
 * a save that failed on a hole you've since navigated away from would be out of
 * sight. This banner sits at the top of the entry surface whenever ANY cell is
 * unsaved, so the user can never lose track that something didn't save, and can
 * retry every flagged cell at once. Hidden when nothing is pending.
 */
export function UnsavedScoresBanner({
  count,
  onRetry,
  refusals,
}: {
  count: number;
  onRetry: () => void;
  /**
   * The server's own sentences for cells it refused TERMINALLY (#1230), keyed
   * by cell. Omit where the caller has none to give.
   */
  refusals?: Record<string, string>;
}) {
  if (count <= 0) return null;

  /**
   * ── When Retry cannot work, do not offer it (#1230) ────────────────────────
   *
   * The banner used to say "N scores didn't save" with a Retry button for every
   * failure. For a 403 — a posted round, someone else's match — that button
   * could never succeed, so following the only advice on screen did nothing,
   * forever. CLAUDE.md: a refusal must name an action the reader can take.
   *
   * The split is on whether ANY unsaved cell is still retryable, not on whether
   * any is refused. A mixed state (one refused, one blipped) keeps Retry,
   * because there is real work for it to do — and the refusal's own sentence is
   * shown alongside so the reader knows why the count will not go to zero.
   */
  const reasons = [...new Set(Object.values(refusals ?? {}))];
  const refusedCount = Object.keys(refusals ?? {}).length;
  const allRefused = refusedCount > 0 && refusedCount >= count;

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-col gap-1"
      style={{
        padding: "8px 14px",
        background: "var(--color-bt-danger-faint)",
        borderBottom: "1px solid var(--color-bt-danger-border)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="flex items-center gap-2"
          style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-danger)" }}
        >
          <CloudOff size={15} />
          {/* "wouldn't save" for a decision, "didn't save" for a blip — the
              first is settled, the second is a thing that happened once. */}
          {count} {count === 1 ? "score" : "scores"}{" "}
          {allRefused ? "wouldn’t save" : "didn’t save"}
        </span>
        {/* Hidden when nothing here CAN be retried — see the note above. */}
        {!allRefused && (
          <button
            type="button"
            onClick={onRetry}
            className="flex shrink-0 items-center gap-1.5"
            style={{
              padding: "4px 12px",
              borderRadius: 9999,
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-danger-border)",
              color: "var(--color-bt-danger)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <RefreshCw size={12} strokeWidth={2.5} />
            Retry{count > 1 ? " all" : ""}
          </button>
        )}
      </div>
      {/* The server's own words. They are written for a human and already name
          an action ("tap 'Correct a score' on the scoreboard to reopen it"),
          which is exactly what the generic Retry was standing in front of.
          De-duplicated: sixteen cells refused for one reason is one sentence. */}
      {reasons.map((reason) => (
        <span
          key={reason}
          data-testid="unsaved-scores-reason"
          style={{ fontSize: 12, lineHeight: 1.35, color: "var(--color-bt-danger)" }}
        >
          {reason}
        </span>
      ))}
    </div>
  );
}
