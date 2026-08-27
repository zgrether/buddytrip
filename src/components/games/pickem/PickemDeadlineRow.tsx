"use client";

import { useState } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * The picks deadline — the only pressure this game has.
 *
 * ── Why it is worth a surface at all ───────────────────────────────────────
 *
 * Reminders need a scheduler and are deferred, so nothing will ever tell
 * anyone their sheet is due. The countdown IS the mechanism. Phase 3 built that
 * countdown and it has never been reachable: `deadline: null` was hardcoded at
 * both `open` call sites, so `msUntilDeadline` always returned null and the
 * component never rendered. Correctly absent rather than wrong — but a feature
 * with no way in.
 *
 * ── A native datetime-local, which is a deviation worth naming ─────────────
 *
 * The repo replaced native `<input type="date">` with `DatePicker`, a popover
 * calendar. That component has NO TIME, and a deadline without a time is not a
 * deadline — §8.4's "Picks closed at 11:00 AM" needs the clock, not the date.
 * Building a datetime popover is a bigger piece of work than this phase should
 * absorb, and on the device that matters a native datetime-local opens the
 * phone's own picker, which is better than anything hand-rolled.
 *
 * So: native here, `DatePicker` everywhere else, and if it reads wrong at the
 * look it is a cheap swap.
 *
 * ── Timezone, stated because it is where these go wrong ────────────────────
 *
 * `datetime-local` speaks LOCAL WALL CLOCK with no zone. `new Date(local)`
 * interprets it in the browser's zone, which is what the runner means — they
 * are setting "11am where the trip is", sitting at the trip. Stored as an
 * instant (`timestamptz`), rendered back through the same local conversion, so
 * a round trip is stable. Everyone on the trip is in one timezone; a runner
 * setting a deadline from another one gets their own local time, which is the
 * only interpretation available without asking where the trip is.
 */

/** ISO instant → the `YYYY-MM-DDTHH:mm` a datetime-local input wants, in LOCAL
 *  time. `toISOString()` would be UTC and silently shift the displayed hour. */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The input's local wall clock → an ISO instant, or null when cleared. */
export function fromLocalInputValue(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** How a set deadline reads back to a person. */
export function formatDeadline(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PickemDeadlineRow({
  deadline,
  editable,
  busy,
  onChange,
}: {
  /** `pickem_games.picks_deadline`, or null for "lock by hand". */
  deadline: string | null;
  /**
   * Only while picks are OPEN.
   *
   * Not before: the deadline is written by `set_pickem_phase('open')`, which
   * would also OPEN picks — setting a time while still building would publish
   * the game. Not after: the same call clears `picks_locked_at`, so editing a
   * deadline on a locked game would silently UNLOCK it. Both are real hazards
   * of reusing one action, and the narrow window is the honest fix until the
   * action is split.
   */
  editable: boolean;
  busy: boolean;
  onChange: (isoOrNull: string | null) => void;
}) {
  const [draft, setDraft] = useState<string>(() => toLocalInputValue(deadline));
  const stored = toLocalInputValue(deadline);
  const dirty = draft !== stored;

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="pickem-deadline-row"
    >
      <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>Picks deadline</div>
      <div
        style={{
          fontSize: TYPE_SCALE.caption,
          color: "var(--color-bt-text-dim)",
          margin: "2px 0 8px",
          lineHeight: 1.5,
        }}
      >
        {deadline
          ? `Sheets lock automatically at ${formatDeadline(deadline)}.`
          : "No deadline — sheets stay open until you lock them by hand."}
        {editable && " Nobody is notified, so the countdown on their sheet is the only warning."}
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="pickem-deadline-input"
            aria-label="Picks deadline"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              borderRadius: 8,
              color: "var(--color-bt-text)",
              // 16px or iOS zooms the page on focus.
              fontSize: 16,
              padding: "8px 10px",
              minWidth: 0,
              flex: "1 1 200px",
            }}
          />
          <button
            type="button"
            onClick={() => onChange(fromLocalInputValue(draft))}
            disabled={busy || !dirty}
            data-testid="pickem-deadline-save"
            className="rounded-lg px-3 disabled:opacity-40"
            style={{
              minHeight: 40,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 700,
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {busy ? "Saving…" : "Set"}
          </button>
          {deadline && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                onChange(null);
              }}
              disabled={busy}
              data-testid="pickem-deadline-clear"
              className="rounded-lg px-3 disabled:opacity-40"
              style={{
                minHeight: 40,
                fontSize: TYPE_SCALE.bodyDense,
                fontWeight: 600,
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              Clear
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
