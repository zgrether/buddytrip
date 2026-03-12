import type { FC } from "react";

export type TripStatus = "live" | "ready" | "upcoming" | "past";

interface StatusBadgeProps {
  status: TripStatus;
  className?: string;
}

const CONFIG: Record<
  TripStatus,
  { label: string; bg: string; text: string }
> = {
  live: { label: "LIVE", bg: "#0d2a22", text: "#00d4aa" },
  ready: { label: "READY", bg: "#1e1535", text: "#a78bfa" },
  upcoming: { label: "UPCOMING", bg: "#161e35", text: "#7c93d4" },
  past: { label: "PAST", bg: "#1f1f1f", text: "#8b949e" },
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
  if (trip.end_date && new Date(trip.end_date) < now) return "past";
  if (
    trip.start_date &&
    new Date(trip.start_date) <= now &&
    (!trip.end_date || new Date(trip.end_date) >= now)
  )
    return "live";
  if (trip.locked_destination_title) return "ready";
  return "upcoming";
}
