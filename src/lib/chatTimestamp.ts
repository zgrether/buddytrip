/**
 * Day-aware chat timestamps — pure, so the day/weekday/date math is testable
 * without mounting `FloatingChatPanel`.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 * Every stamp was `toLocaleTimeString` with hour/minute only. A message from
 * Tuesday at 3:42 PM and one from today at 3:42 PM rendered identically, so a
 * transcript spanning more than a day read as OUT OF ORDER rather than as old
 * — the same class of bug as several other findings this month: a display
 * that renders two different states the same way. It will bite during the
 * trip itself: five days of chat in one scroll is the expected case, not an
 * edge one.
 *
 * ── No timezone column, so this is client-local by construction ────────────
 * `messages.created_at` is a bare timestamptz; nothing in the schema records
 * which zone a sender or reader is in (established during the quiet-hours
 * work). So every label here is computed from `new Date(iso)`, which
 * `Date`'s constructor already resolves against the READER's local clock —
 * there is nothing to fetch and nothing a server could format instead. That
 * is fine for chat: two people in different timezones seeing "Yesterday" at
 * different wall-clock moments for the same message is the correct behaviour,
 * not a bug to fix.
 */

const MS_PER_DAY = 86_400_000;

/** Midnight, LOCAL time, dropping the time-of-day. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Calendar days between two instants, LOCAL to the reader. Can be negative
 * (a message timestamped in the future relative to `now` — clock skew between
 * devices — reads as "today" by every caller here, via the `<= 0` checks
 * below, rather than producing a nonsensical negative day count.)
 *
 * `Math.round`, not a plain integer division: a DST transition makes one local
 * day 23 or 25 real hours long, so two local midnights spanning it are NOT an
 * exact multiple of 86,400,000ms apart. Rounding is what keeps the day COUNT
 * correct across that boundary; a `Math.floor` would occasionally read one day
 * short.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / MS_PER_DAY);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * The day label alone — what a day separator shows, and what a per-message
 * stamp prefixes onto its time once the message isn't from today.
 *
 * One function backs both, so "the separator says Tuesday and the stamp above
 * it says Wed" can't happen — there is exactly one place that decides what a
 * given day is called relative to `now`.
 */
function dayLabel(d: Date, now: Date): string {
  const diff = daysBetween(d, now);
  if (diff <= 0) return "Today"; // <= 0 covers same-day and clock-skew-future
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "short" }); // "Tue"
  // Beyond a week: a date. Year included only when it differs from `now`'s —
  // a trip doesn't span a year boundary, but a stray old message shouldn't
  // silently mislabel itself as this year's if one ever does.
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

/**
 * The per-message stamp.
 *
 *   Today     → "3:42 PM"
 *   Yesterday → "Yesterday 3:42 PM"
 *   This week → "Tue 3:42 PM"
 *   Older     → "Aug 19 3:42 PM" (+ year if it isn't this one)
 *
 * `now` is a parameter rather than read internally so tests are deterministic
 * — see `chatTimestamp.test.ts`'s fixed-`now` fixture.
 */
export function formatChatMessageTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = formatTime(d);
  return daysBetween(d, now) <= 0 ? time : `${dayLabel(d, now)} ${time}`;
}

/** The day-separator label alone: "Today" / "Yesterday" / "Tue" / "Aug 19". */
export function formatChatDaySeparator(iso: string, now: Date = new Date()): string {
  return dayLabel(new Date(iso), now);
}

/**
 * Does a day separator belong ABOVE `current`, given the message immediately
 * before it in the transcript (oldest-first)?
 *
 * `previous: null` means "first message in what's rendered" (including the
 * first message after a page of history loads) — always true, since there is
 * nothing above it to compare against.
 *
 * Deliberately compares `current` against `previous`, NOT against `now`: the
 * question is "did the calendar day change since the last message", which is
 * a property of the transcript, not of when someone happens to be looking at
 * it. `dayLabel`'s "Today"/"Yesterday" wording IS relative to `now` — the two
 * concerns are separate on purpose, which is why this takes no `now` at all.
 */
export function chatDayChanged(current: string, previous: string | null): boolean {
  if (previous === null) return true;
  return daysBetween(new Date(previous), new Date(current)) !== 0;
}
