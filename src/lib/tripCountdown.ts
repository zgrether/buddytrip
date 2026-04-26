/**
 * Trip countdown derivation — produces a single human-readable label that
 * answers "how far away is this trip?" / "is it happening?" / "did it
 * happen recently?" from raw trip dates + stage.
 *
 * Driven by the discrete `CountdownResult` type so consumers can switch on
 * `.type` to apply different visual treatments (pulse for happening,
 * dim for past, etc.) without re-parsing the label string.
 */

import { parseLocalDate } from "@/lib/dates";

export type CountdownResult =
  | { type: "idea" }
  | { type: "no_dates" }
  | { type: "weeks"; weeks: number; label: string }
  | { type: "days"; days: number; label: string }
  | { type: "today"; label: string }
  | { type: "happening"; dayNumber: number; totalDays: number; label: string }
  | { type: "past"; weeksAgo: number; label: string }
  | { type: "past_distant"; label: string };

/**
 * Derive the countdown state for a trip.
 *
 * Branches:
 * - `idea`         — stage is "idea" (no countdown shown anywhere)
 * - `no_dates`     — no start/end set yet
 * - `weeks`        — > 14 days away (rounded to weeks)
 * - `days`         — 2–14 days away, or "Tomorrow" for daysUntil === 1
 * - `today`        — daysUntil === 0
 * - `happening`    — between start and end, inclusive
 * - `past`         — ended within the last 8 weeks
 * - `past_distant` — ended more than 8 weeks ago (shown as "Month YYYY")
 */
export function getTripCountdown(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  stage: string,
): CountdownResult {
  if (stage === "idea") return { type: "idea" };
  if (!startDate || !endDate) return { type: "no_dates" };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntil = Math.round((startDay.getTime() - today.getTime()) / msPerDay);
  const totalDays = Math.round((endDay.getTime() - startDay.getTime()) / msPerDay) + 1;

  if (daysUntil > 14) {
    const weeks = Math.round(daysUntil / 7);
    return { type: "weeks", weeks, label: `${weeks} week${weeks !== 1 ? "s" : ""} away` };
  }

  if (daysUntil > 1) {
    return { type: "days", days: daysUntil, label: `${daysUntil} days away` };
  }

  if (daysUntil === 1) {
    return { type: "days", days: 1, label: "Tomorrow" };
  }

  if (daysUntil === 0) {
    return { type: "today", label: "Today is the day" };
  }

  // During trip — daysUntil < 0, may still be inside the inclusive range
  const dayNumber = Math.round((today.getTime() - startDay.getTime()) / msPerDay) + 1;
  if (dayNumber >= 1 && dayNumber <= totalDays) {
    return {
      type: "happening",
      dayNumber,
      totalDays,
      label: `Live · Day ${dayNumber} of ${totalDays}`,
    };
  }

  // Past
  const weeksAgo = Math.round((today.getTime() - endDay.getTime()) / msPerDay / 7);
  if (weeksAgo <= 8) {
    return {
      type: "past",
      weeksAgo,
      label: weeksAgo <= 1 ? "Just wrapped" : `${weeksAgo} weeks ago`,
    };
  }

  // Distant past — month/year of trip start
  const formatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
  return { type: "past_distant", label: formatter.format(start) };
}
