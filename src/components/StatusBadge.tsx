import type { FC } from "react";
import { getEffectiveStatus, type TripDisplayStatus, type TripStatusFields } from "@/lib/tripStatus";

export type TripStatus = TripDisplayStatus;

interface StatusBadgeProps {
  status: TripStatus;
  /** Override the default label text (e.g. countdown for NOW stage) */
  label?: string;
  className?: string;
}

const CONFIG: Record<
  TripStatus,
  { label: string; bg: string; text: string }
> = {
  idea: { label: "IDEA", bg: "var(--color-bt-blue-bg)", text: "var(--color-bt-planning)" },
  planning: { label: "PLANNING", bg: "var(--color-bt-tag-bg)", text: "var(--color-bt-accent)" },
  going: { label: "GOING", bg: "var(--color-bt-ready-bg, rgba(124,58,237,0.1))", text: "var(--color-bt-ready)" },
  now: { label: "NOW", bg: "var(--color-bt-warning-faint)", text: "var(--color-bt-warning)" },
  past: { label: "PAST", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
  saved: { label: "SAVED", bg: "var(--color-bt-past-bg)", text: "var(--color-bt-text-dim)" },
};

export const StatusBadge: FC<StatusBadgeProps> = ({ status, label: labelOverride, className }) => {
  const config = CONFIG[status];
  const displayLabel = labelOverride ?? config.label;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider ${className ?? ""}`}
      style={{ background: config.bg, color: config.text }}
    >
      {displayLabel}
    </span>
  );
};

export function getTripStatus(trip: TripStatusFields): TripStatus {
  return getEffectiveStatus(trip);
}
