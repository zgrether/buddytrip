/**
 * Time utilities for BuddyTrip.
 *
 * The app stores times as "HH:MM" 24-hour strings (e.g. "15:42"). The
 * TimePicker UI works in a friendlier 12-hour shape — `{ h, m, period }`
 * with h: 1–12, m: 0–59, period: 'AM' | 'PM'. These helpers convert at the
 * data-layer boundary so the picker never has to think in 24-hour math.
 */

export type Period = "AM" | "PM";

export interface TimeValue {
  /** 1–12 */
  h: number;
  /** 0–59 */
  m: number;
  period: Period;
}

/**
 * Parse an "HH:MM" 24-hour string into a 12-hour TimeValue.
 * Returns null for empty / malformed input so callers can show a placeholder.
 */
export function parseTime(str: string | null | undefined): TimeValue | null {
  if (!str) return null;
  const parts = str.split(":");
  if (parts.length < 2) return null;
  const h24 = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h24) || !Number.isInteger(m)) return null;
  if (h24 < 0 || h24 > 23 || m < 0 || m > 59) return null;
  const period: Period = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { h, m, period };
}

/**
 * Convert a 12-hour TimeValue into an "HH:MM" 24-hour string for storage.
 */
export function toTime24({ h, m, period }: TimeValue): string {
  let h24 = h % 12; // 12 → 0
  if (period === "PM") h24 += 12; // 12 PM → 12, 1 PM → 13
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Format a 12-hour TimeValue for display (e.g. "3:42 PM"). Minutes are
 * always zero-padded; the hour is not.
 */
export function formatTime12(v: TimeValue): string {
  return `${v.h}:${String(v.m).padStart(2, "0")} ${v.period}`;
}

// ── Presets ──────────────────────────────────────────────────────────────

export interface TimePreset {
  label: string;
  value: TimeValue;
}

/** Daypart presets — quick anchors for arrival / agenda start times. */
export const DAYPART_PRESETS: TimePreset[] = [
  { label: "Morning", value: { h: 8, m: 0, period: "AM" } },
  { label: "Noon", value: { h: 12, m: 0, period: "PM" } },
  { label: "Evening", value: { h: 6, m: 0, period: "PM" } },
];

/** Common golf tee-time slots (mono grid). */
export const TEE_PRESETS: TimePreset[] = [
  { label: "7:00", value: { h: 7, m: 0, period: "AM" } },
  { label: "7:10", value: { h: 7, m: 10, period: "AM" } },
  { label: "7:20", value: { h: 7, m: 20, period: "AM" } },
  { label: "7:30", value: { h: 7, m: 30, period: "AM" } },
  { label: "8:00", value: { h: 8, m: 0, period: "AM" } },
  { label: "8:30", value: { h: 8, m: 30, period: "AM" } },
  { label: "1:00", value: { h: 1, m: 0, period: "PM" } },
  { label: "1:30", value: { h: 1, m: 30, period: "PM" } },
];
