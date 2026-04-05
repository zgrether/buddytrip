"use client";

import type { FC } from "react";
import { useTheme } from "next-themes";
import { MapPin, Calendar } from "lucide-react";
import { ProgressStepper } from "@/components/ProgressStepper";
import { RoleBadge } from "@/components/RoleBadge";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import { LocationHero } from "@/components/LocationHero";
import type { TripRole } from "@/server/middleware";

interface TripHeaderProps {
  tripName: string;
  status: TripDisplayStatus;
  stage: string;
  countdownText?: string | null;
  location?: string | null;
  lockedTitle?: string | null;
  dateRange?: string;
  isLocked: boolean;
  /** owner/planner can edit destination & dates inline */
  canEdit?: boolean;
  /** Show settings gear (owner only) */
  settingsSlot?: React.ReactNode;
  /** Called when destination is edited inline */
  onDestinationChange?: (value: string) => void;
  /** Called when dates are tapped (navigate to date poll or open picker) */
  onDatesTap?: () => void;
  /** Trip start date — drives temporal gradient color */
  tripStartDate?: string | null;
  /** Current user's role in this trip */
  myRole?: TripRole | null;
  /** Called when a future stepper step is tapped */
  onStepClick?: (stepKey: string) => void;
  /** Hide progress stepper for non-owners */
  isOwner?: boolean;
}

// ── Plain card (no locked destination) ───────────────────────────────────

const PlainHeader: FC<Omit<TripHeaderProps, "isLocked">> = ({
  tripName,
  status,
  stage,
  countdownText,
  location,
  dateRange,
  settingsSlot,
  myRole,
  onStepClick,
  isOwner,
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
    {/* Row 1: trip name + settings + role */}
    <div className="flex items-start justify-between">
      <h1
        data-testid="trip-title"
        className="text-xl font-bold"
        style={{ color: "var(--color-bt-text)" }}
      >
        {tripName}
      </h1>
      <div className="flex items-center gap-2">
        {myRole && <RoleBadge role={myRole} />}
        {settingsSlot}
      </div>
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

    {/* Progress stepper — owners only */}
    {isOwner && <ProgressStepper stage={stage} displayStatus={status} countdownText={countdownText} onStepClick={onStepClick} />}
  </div>
);

// ── Hero card (locked destination) ───────────────────────────────────────

const HeroHeader: FC<Omit<TripHeaderProps, "isLocked">> = ({
  tripName,
  status,
  stage,
  countdownText,
  location,
  lockedTitle,
  dateRange,
  canEdit: _canEdit,
  settingsSlot,
  onDestinationChange: _onDestinationChange,
  onDatesTap: _onDatesTap,
  tripStartDate,
  myRole,
  onStepClick,
  isOwner,
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
    <LocationHero location={displayLocation || tripName} tripName={tripName} tripStartDate={status === "past" ? tripStartDate : null}>
      {/* Row 1: trip name + settings + badge */}
      <div className="flex items-start justify-between">
        <h1
          data-testid="trip-title"
          className="text-2xl font-bold"
          style={{ color: titleColor }}
        >
          {tripName}
        </h1>
        <div className="flex items-center gap-2">
          {myRole && <RoleBadge role={myRole} />}
          {settingsSlot && (
            <span style={{ color: subColor }}>
              {settingsSlot}
            </span>
          )}
        </div>
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

      {/* Progress stepper — owners only */}
      {isOwner && <ProgressStepper stage={stage} displayStatus={status} countdownText={countdownText} onStepClick={onStepClick} />}
    </LocationHero>
  );
};

// ── Exported TripHeader ──────────────────────────────────────────────────

export function TripHeader(props: TripHeaderProps) {
  if (props.isLocked) {
    return <HeroHeader {...props} />;
  }
  return <PlainHeader {...props} />;
}
