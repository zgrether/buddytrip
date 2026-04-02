import type { FC } from "react";
import { getEffectiveStatus, type TripDisplayStatus } from "@/lib/tripStatus";

export type TripStatus = TripDisplayStatus;

interface StatusBadgeProps {
  status: TripStatus;
  className?: string;
}

const CONFIG: Record<
  TripStatus,
  { label: string; bg: string; text: string }
> = {
  planning: { label: "PLANNING", bg: "var(--color-bt-blue-bg)", text: "var(--color-bt-planning)" },
  upcoming: { label: "UPCOMING", bg: "var(--color-bt-tag-bg)", text: "var(--color-bt-accent)" },
  past: { label: "PAST", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
  saved: { label: "SAVED", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
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
  trip_status_override?: string | null;
}): TripStatus {
  return getEffectiveStatus(trip);
}
