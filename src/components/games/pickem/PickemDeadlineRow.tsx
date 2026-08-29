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

/**
 * DELETED: `PickemDeadlineRow`.
 *
 * The settings-page row for the deadline, superseded by the block inside
 * `PickemPhaseStrip` when the lifecycle controls left settings — and rendered
 * NOWHERE since (issue #1128). The three helpers above are the only live
 * exports, which is why the file stays.
 *
 * Removed in the Start/Stop vocabulary sweep rather than as tidying. Its copy
 * said "Sheets lock automatically at…" and "no deadline — sheets stay open
 * until you lock them by hand", which is the word the panel no longer uses. A
 * dead component cannot mislead a reader, but it can mislead the next author:
 * this is the file the strip imports its formatting from, so this wording is
 * the first thing anyone editing that copy would meet.
 */
