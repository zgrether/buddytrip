/**
 * Date utilities for BuddyTrip.
 *
 * Problem: date-only strings like "2026-06-15" are stored in Postgres as
 * plain dates (no time, no timezone). When parsed with `new Date("2026-06-15")`
 * in JavaScript, the spec treats them as UTC midnight — which means in US
 * timezones (UTC-5 to UTC-8) they appear as the *previous* day when formatted
 * with toLocaleDateString().
 *
 * Fix: append "T12:00:00" before parsing so the date is noon local time,
 * well clear of any timezone offset.
 */

/**
 * Parse a YYYY-MM-DD date string as noon local time to prevent the UTC
 * midnight off-by-one-day display bug in western timezones.
 */
export function parseLocalDate(dateStr: string): Date {
  // ISO date-only strings have exactly 10 chars: "YYYY-MM-DD"
  if (dateStr.length === 10) {
    return new Date(`${dateStr}T12:00:00`);
  }
  // Fall back to native parsing for full ISO strings (already include time/tz)
  return new Date(dateStr);
}

/**
 * Format a Date back into a YYYY-MM-DD string using its LOCAL calendar
 * fields (not UTC), the inverse of parseLocalDate. Using toISOString()
 * here would shift the day backward in western timezones — the same
 * off-by-one bug parseLocalDate guards against — so we assemble the
 * string from local getFullYear/getMonth/getDate instead.
 */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Format a YYYY-MM-DD date string for display (e.g. "Jun 15, 2026").
 */
export function formatDate(
  dateStr: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  }
): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", options);
}

/**
 * Compact date range for subtitles: "Jun 4–7" (same month) or "Jun 28 – Jul 2" (cross-month).
 * Omits year for brevity.
 */
export function formatDateRangeCompact(
  start?: string | null,
  end?: string | null
): string {
  if (!start && !end) return "Dates TBD";
  if (!start) return formatDate(end!, { month: "short", day: "numeric" });
  if (!end) return formatDate(start, { month: "short", day: "numeric" });

  const s = parseLocalDate(start);
  const e = parseLocalDate(end);

  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    // Same month: "Jun 4–7"
    const month = s.toLocaleDateString("en-US", { month: "short" });
    return `${month} ${s.getDate()}–${e.getDate()}`;
  }
  // Cross-month: "Jun 28 – Jul 2"
  const fmtOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${formatDate(start, fmtOpts)} – ${formatDate(end, fmtOpts)}`;
}

/**
 * Format a date range for display (e.g. "Jun 15 – Jun 18, 2026").
 * Either end may be omitted.
 */
export function formatDateRange(
  start?: string | null,
  end?: string | null
): string {
  if (!start && !end) return "Dates TBD";
  const fmt = (d: string) => formatDate(d);
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

/**
 * Format an "HH:MM" 24-hour time string as 12-hour with AM/PM (e.g. "3:45 PM").
 * Returns the input unchanged if it doesn't match the expected shape.
 */
export function fmtTime12(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h) || mStr === undefined) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mStr} ${suffix}`;
}
