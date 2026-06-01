/**
 * Pure calendar helpers for the shared <DatePicker>. Kept free of React so
 * the selection logic (the tricky part) is unit-testable in isolation.
 *
 * All Date values are treated as "local noon" days — callers build them via
 * parseLocalDate / atNoon so timezone offsets never flip the calendar day.
 */

/** Normalize any Date to local noon, dropping the time-of-day. */
export function atNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

/** True when two dates fall on the same local calendar day. */
export function isSameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** a < b at day granularity. */
export function isBeforeDay(a: Date, b: Date): boolean {
  return atNoon(a).getTime() < atNoon(b).getTime();
}

/** a > b at day granularity. */
export function isAfterDay(a: Date, b: Date): boolean {
  return atNoon(a).getTime() > atNoon(b).getTime();
}

/** Add `n` calendar days (n may be negative). */
export function addDays(date: Date, n: number): Date {
  const d = atNoon(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Add `n` months, clamping the day to the target month's length. */
export function addMonths(date: Date, n: number): Date {
  const d = atNoon(date);
  const targetMonth = d.getMonth() + n;
  const target = new Date(d.getFullYear(), targetMonth, 1, 12, 0, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

/** Whole nights between two days: (end − start) in days. */
export function nightsBetween(start: Date, end: Date): number {
  const ms = atNoon(end).getTime() - atNoon(start).getTime();
  return Math.round(ms / 86_400_000);
}

/** First day of the month containing `date`, at local noon. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

/**
 * 6×7 grid of days covering the month of `viewDate`, padded with the
 * trailing days of the previous month and leading days of the next so every
 * row is full. Weeks start on Sunday. Always 42 cells (6 rows) for a stable
 * popover height.
 */
export function monthMatrix(viewDate: Date): Date[][] {
  const first = startOfMonth(viewDate);
  const gridStart = addDays(first, -first.getDay()); // back up to Sunday
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(addDays(gridStart, w * 7 + d));
    }
    weeks.push(row);
  }
  return weeks;
}

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

/**
 * Range-mode click reducer — the key selection behavior:
 *   - No start yet, or a complete range already set → begin a new range
 *     (start = clicked, end cleared).
 *   - Start set, no end:
 *       · clicked ≥ start → set end (range complete)
 *       · clicked < start → reset start to clicked (can't build backwards)
 */
export function applyRangeClick(current: DateRange, clicked: Date): DateRange {
  const day = atNoon(clicked);
  if (!current.start || current.end) {
    return { start: day, end: null };
  }
  if (isBeforeDay(day, current.start)) {
    return { start: day, end: null };
  }
  return { start: current.start, end: day };
}

/** True when `day` is between range start/end (exclusive of the caps). */
export function isWithinRange(day: Date, range: DateRange): boolean {
  if (!range.start || !range.end) return false;
  return isAfterDay(day, range.start) && isBeforeDay(day, range.end);
}

/** True when `day` falls outside an optional [min, max] window (disabled). */
export function isOutOfBounds(day: Date, min?: Date | null, max?: Date | null): boolean {
  if (min && isBeforeDay(day, min)) return true;
  if (max && isAfterDay(day, max)) return true;
  return false;
}

/** The upcoming Friday on or after `from` (today by default). */
export function nextFriday(from: Date): Date {
  const d = atNoon(from);
  const delta = (5 - d.getDay() + 7) % 7; // 5 = Friday
  return addDays(d, delta);
}

export interface RangePreset {
  id: string;
  label: string;
  range: DateRange;
}

/**
 * Quick range presets relative to `today`:
 *   - This weekend: next Fri → Sun
 *   - Long weekend: next Fri → Mon
 *   - A week:       next Fri → following Fri
 */
export function rangePresets(today: Date): RangePreset[] {
  const fri = nextFriday(today);
  return [
    { id: "weekend", label: "This weekend", range: { start: fri, end: addDays(fri, 2) } },
    { id: "long-weekend", label: "Long weekend", range: { start: fri, end: addDays(fri, 3) } },
    { id: "week", label: "A week", range: { start: fri, end: addDays(fri, 7) } },
  ];
}
