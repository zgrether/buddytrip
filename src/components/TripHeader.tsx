"use client";

import type { FC } from "react";
import { useTheme } from "next-themes";
import { MapPin, Calendar } from "lucide-react";
import { RoleBadge } from "@/components/RoleBadge";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import { LocationHero } from "@/components/LocationHero";
import type { TripRole } from "@/server/middleware";

interface TripHeaderProps {
  tripName: string;
  status: TripDisplayStatus;
  location?: string | null;
  lockedTitle?: string | null;
  dateRange?: string;
  isLocked: boolean;
  /** owner/planner can edit destination & dates inline */
  canEdit?: boolean;
  /** Called when destination is edited inline */
  onDestinationChange?: (value: string) => void;
  /** Called when dates are tapped (navigate to date poll or open picker) */
  onDatesTap?: () => void;
  /** Trip start date — drives temporal gradient color */
  tripStartDate?: string | null;
  /** Current user's role in this trip */
  myRole?: TripRole | null;
}

// ── Plain card (no locked destination) ───────────────────────────────────

const PlainHeader: FC<Omit<TripHeaderProps, "isLocked">> = ({
  tripName,
  status,
  location,
  dateRange,
  myRole,
}) => (
  <div
    className="rounded-2xl border p-5"
    style={{
      background: "var(--color-bt-card)",
      borderColor: status !== "past"
        ? "var(--color-bt-accent-border)"
        : "var(--color-bt-border)",
      boxShadow: status !== "past"
        ? "var(--shadow-raised)"
        : "var(--shadow-card)",
    }}
    data-testid="trip-header-plain"
  >
    {/* Row 1: role + trip name */}
    <div className="flex min-w-0 items-center gap-2">
      {myRole && <RoleBadge role={myRole} />}
      <h1
        data-testid="trip-title"
        className="truncate text-xl font-bold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {tripName}
      </h1>
    </div>

    {location && (
      <div
        className="mt-2 flex items-center gap-1 text-sm"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <MapPin size={13} />
        <span>{location}</span>
      </div>
    )}

    {dateRange && dateRange !== "Dates TBD" && (
      <div
        className="mt-1 flex items-center gap-1 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <Calendar size={11} />
        <span>{dateRange}</span>
      </div>
    )}
  </div>
);

// ── Hero card (locked destination) ───────────────────────────────────────

const HeroHeader: FC<Omit<TripHeaderProps, "isLocked">> = ({
  tripName,
  status,
  location,
  lockedTitle,
  dateRange,
  canEdit: _canEdit,
  onDestinationChange: _onDestinationChange,
  onDatesTap: _onDatesTap,
  tripStartDate,
  myRole,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const titleColor = isDark ? "#ffffff" : "rgba(0,0,0,0.85)";
  const subColor = isDark ? "rgba(255,255,255,0.70)" : "rgba(0,0,0,0.60)";
  const metaColor = isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)";

  // Prefer location (locked_destination_location from parent) over lockedTitle
  // (locked_destination_title). Both now hold the same value after the
  // LockConfirmModal fix, but location is semantically the geographic string.
  const displayLocation = location || lockedTitle || "";

  return (
    <LocationHero
      location={displayLocation || tripName}
      tripName={tripName}
      tripStartDate={status === "past" ? tripStartDate : null}
      topContent={
        <>
          {/* Row 1: role + trip name */}
          <div className="flex min-w-0 items-center gap-2">
            {myRole && <RoleBadge role={myRole} />}
            <h1
              data-testid="trip-title"
              className="truncate text-2xl font-bold"
              style={{ color: titleColor }}
            >
              {tripName}
            </h1>
          </div>

          {/* Destination */}
          {displayLocation && (
            <div className="mt-1.5 flex items-center gap-1 text-sm" style={{ color: subColor }}>
              <MapPin size={13} className="shrink-0" />
              <span>{displayLocation}</span>
            </div>
          )}

          {/* Dates — only show when set */}
          {dateRange && dateRange !== "Dates TBD" && (
            <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: metaColor }}>
              <Calendar size={11} className="shrink-0" />
              <span>{dateRange}</span>
            </div>
          )}
        </>
      }
    />
  );
};

// ── Exported TripHeader ──────────────────────────────────────────────────

export function TripHeader(props: TripHeaderProps) {
  if (props.isLocked) {
    return <HeroHeader {...props} />;
  }
  return <PlainHeader {...props} />;
}
