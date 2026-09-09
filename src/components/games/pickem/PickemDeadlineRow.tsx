
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
 * These helpers speak a WALL CLOCK with no zone attached, and the question is
 * whose. They used to say the DEVICE's, on the reasoning that "everyone on the
 * trip is in one timezone" — which is false in both directions: a runner sets
 * the deadline from home weeks earlier, and crew read it from wherever they
 * happen to be. The deadline then moved with the reader while the slate's
 * kickoff strings did not, and the two clocks on one screen disagreed.
 *
 * So the wall clock here is TRIP zone (`@/lib/tripTimeZone`), which is the
 * frame the frozen kickoff text is already in. Stored as an instant
 * (`timestamptz`) either way — only the interpretation of the digits changed,
 * and a round trip is still stable.
 */
import {
  TRIP_TIME_ZONE,
  formatInTripZone,
  instantFromWallClock,
  wallClockInZone,
} from "@/lib/tripTimeZone";

/** ISO instant → the `YYYY-MM-DDTHH:mm` a datetime-local input wants, as the
 *  TRIP zone's wall clock. `toISOString()` would be UTC and silently shift the
 *  displayed hour; the device's clock would shift it by a different amount for
 *  every reader, which is the bug this file's header describes. */
export function toLocalInputValue(iso: string | null, timeZone = TRIP_TIME_ZONE): string {
  if (!iso) return "";
  const w = wallClockInZone(iso, timeZone);
  if (!w) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The input's trip-zone wall clock → an ISO instant, or null when cleared. */
export function fromLocalInputValue(local: string, timeZone = TRIP_TIME_ZONE): string | null {
  // Parsed by field rather than by `new Date(local)`: that constructor reads a
  // zone-less string in the DEVICE's zone, which is precisely the assumption
  // being removed. A regex also refuses the garbage the old version had to
  // catch with an isFinite check afterwards.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const ms = instantFromWallClock(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
    },
    timeZone,
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * How a set deadline reads back to a person: `Wed, Sep 9, 8:10 PM EDT`.
 *
 * The zone abbreviation is not decoration. This string sits on the same screen
 * as kickoff times that are frozen in this same zone, and a reader standing in
 * a different one needs to know that neither clock is theirs — otherwise the
 * deadline looks an hour early rather than differently expressed.
 */
export function formatDeadline(iso: string | null): string {
  return formatInTripZone(iso);
}

/**
 * DELETED: `PickemDeadlineRow`.
 *
 * The settings-page row for the deadline, superseded by the block inside
 * `PickemPhaseStrip` when the lifecycle controls left settings — and rendered
 * NOWHERE since (issue #1128). The helpers above are why the file stays.
 *
 * Of the three, only `formatDeadline` currently has a live caller
 * (`PickemPhaseStrip`); the two input helpers are exercised by tests alone,
 * since the deadline editor moved to the shared DatePicker/TimePicker pair.
 * They were moved onto the trip zone with it rather than left behind: a
 * zone-naive helper sitting beside a zone-pinned one, in the file the strip
 * imports its formatting from, is the first thing the next author would meet.
 *
 * Removed in the Start/Stop vocabulary sweep rather than as tidying. Its copy
 * said "Sheets lock automatically at…" and "no deadline — sheets stay open
 * until you lock them by hand", which is the word the panel no longer uses. A
 * dead component cannot mislead a reader, but it can mislead the next author:
 * this is the file the strip imports its formatting from, so this wording is
 * the first thing anyone editing that copy would meet.
 */
