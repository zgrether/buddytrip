import type { FC } from "react";
import { parseLocalDate } from "@/lib/dates";

export type TripStatus = "planning" | "upcoming" | "past";

interface StatusBadgeProps {
  status: TripStatus;
  className?: string;
}

const CONFIG: Record<
  TripStatus,
  { label: string; bg: string; text: string }
> = {
  planning: { label: "PLANNING", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
  upcoming: { label: "UPCOMING", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
  past:     { label: "PAST",     bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
};

export const StatusBadge: FC<StatusBadgeProps> = ({ status, className }) => {
  const { label, bg, text } = CONFIG[status];
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider ${className ?? ""}`}
      style={{ background: bg, color: text }}
    >
      {label}
    </span>
  );
};

export function getTripStatus(trip: {
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_title?: string | null;
}): TripStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Past — end date has passed
  if (trip.end_date && parseLocalDate(trip.end_date) < today) return "past";

  // 2. Upcoming — destination locked + confirmed future dates
  if (
    trip.locked_destination_title &&
    trip.start_date &&
    parseLocalDate(trip.start_date) >= today
  ) return "upcoming";

  // 3. Planning — no locked destination or no confirmed dates
  return "planning";
}
