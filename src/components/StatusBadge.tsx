import type { FC } from "react";
import { parseLocalDate } from "@/lib/dates";

export type TripStatus = "live" | "ready" | "upcoming" | "past";

interface StatusBadgeProps {
  status: TripStatus;
  className?: string;
}

const CONFIG: Record<
  TripStatus,
  { label: string; bg: string; text: string }
> = {
  live: { label: "LIVE", bg: "var(--color-bt-tag-bg)", text: "var(--color-bt-accent)" },
  ready: { label: "READY", bg: "var(--color-bt-ready-bg)", text: "var(--color-bt-ready)" },
  upcoming: { label: "UPCOMING", bg: "var(--color-bt-blue-bg)", text: "var(--color-bt-planning)" },
  past: { label: "PAST", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
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
  const now = new Date();
  if (trip.end_date && parseLocalDate(trip.end_date) < now) return "past";
  if (
    trip.start_date &&
    parseLocalDate(trip.start_date) <= now &&
    (!trip.end_date || parseLocalDate(trip.end_date) >= now)
  )
    return "live";
  if (trip.locked_destination_title) return "ready";
  return "upcoming";
}
