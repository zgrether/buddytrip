"use client";

import { type FC } from "react";
import { useTheme } from "next-themes";
import { MapPin, Calendar, Settings } from "lucide-react";
import { RoleBadge } from "@/components/RoleBadge";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import { LocationHero } from "@/components/LocationHero";
import type { TripRole } from "@/server/middleware";
import { getTripCountdown, type CountdownResult } from "@/lib/tripCountdown";

interface TripHeaderProps {
  tripId?: string;
  tripName: string;
  status: TripDisplayStatus;
  location?: string | null;
  lockedTitle?: string | null;
  dateRange?: string;
  isLocked: boolean;
  /** Trip stage — drives header variant ("idea" hides destination/dates/countdown/gear). */
  stage: string;
  /** owner/planner can edit destination & dates inline */
  canEdit?: boolean;
  /** Called when destination is edited inline */
  onDestinationChange?: (value: string) => void;
  /** Called when dates are tapped (navigate to date poll or open picker) */
  onDatesTap?: () => void;
  /** Trip start date — drives temporal gradient color and countdown */
  tripStartDate?: string | null;
  /** Trip end date — used for countdown derivation */
  tripEndDate?: string | null;
  /** Current user's role in this trip */
  myRole?: TripRole | null;
  /** Owner-only — when provided, renders the gear button top-right (not in idea stage). */
  onSettingsClick?: () => void;
  /**
   * When true the trip has an active date poll (`poll_mode === true`) and the
   * dates affordance shifts to a warning-coloured "Polling crew →" link.
   */
  pollActive?: boolean;
  /**
   * Called when the user taps the dates affordance (set / polling / locked
   * range). Only wired up for canEdit users — members see the dates as
   * read-only text. Page-level state owns the DatesSheet so it can pass the
   * full trip object to the embedded DatePollCard.
   */
  onOpenDatesSheet?: () => void;
}

// ── Settings gear button (absolute top-right) ────────────────────────────

const SettingsGear: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    data-testid="trip-settings-btn"
    onClick={onClick}
    className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
    style={{
      background: "rgba(255,255,255,0.08)",
      color: "rgba(241,245,249,0.6)",
    }}
    aria-label="Trip settings"
  >
    <Settings size={16} />
  </button>
);

// ── Countdown bar — full width, sits flush at the bottom of the card ─────

type LabelledCountdown = Exclude<CountdownResult, { type: "idea" } | { type: "no_dates" }>;

/**
 * Countdown bar — full-width strip that sits flush at the bottom of a card.
 * Used by both TripHeader (trip detail) and TripCard (dashboard) so the
 * countdown treatment stays consistent across surfaces.
 *
 * Token-based colors so it reads correctly on both white (light mode) and
 * dark gradient (dark mode) parent surfaces.
 */
function CountdownBar({ countdown }: { countdown: LabelledCountdown }) {
  const isHappening = countdown.type === "happening";
  const isPast = countdown.type === "past" || countdown.type === "past_distant";

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2.5"
      style={{
        borderTop: "1px solid var(--color-bt-border)",
        background: isHappening
          ? "var(--color-bt-accent-faint)"
          : isPast
            ? "var(--color-bt-card-raised)"
            : "var(--color-bt-hover)",
      }}
    >
      {isHappening && (
        <div
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: "var(--color-bt-accent)" }}
        />
      )}
      <span
        className="text-xs font-semibold tracking-wide"
        style={{
          color: isHappening ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        }}
      >
        {countdown.label}
      </span>
    </div>
  );
}

// Re-export so other surfaces (dashboard cards) can use the same bar.
export { CountdownBar };

// ── Shared dates row — handles all three states ──────────────────────────
//
//   1. No dates, no poll:           "Set dates →"      (accent / teal)
//   2. No dates, poll active:       "Polling crew →"   (warning / amber)
//   3. Dates locked:                "May 20 – May 25" (dim, clickable when canEdit)
//
// `colorOverride` lets the hero variant tint the locked-range text to fit
// the photo background. canEdit gates the click affordance; members see the
// locked range as static text.

interface DatesRowProps {
  tripStartDate: string | null | undefined;
  dateRange?: string;
  canEdit: boolean;
  pollActive: boolean;
  onOpenDatesSheet?: () => void;
  /** Locked-range text color (defaults to bt-text-dim). */
  lockedColor?: string;
  /** Margin-top class for the row container. */
  marginTopClass?: string;
}

function DatesRow({
  tripStartDate,
  dateRange,
  canEdit,
  pollActive,
  onOpenDatesSheet,
  lockedColor = "var(--color-bt-text-dim)",
  marginTopClass = "mt-1",
}: DatesRowProps) {
  const hasDates = !!tripStartDate;
  const clickable = canEdit && !!onOpenDatesSheet;

  // ── Locked range ──────────────────────────────────────────────────────
  if (hasDates && dateRange && dateRange !== "Dates TBD") {
    const content = (
      <>
        <Calendar size={11} className="shrink-0" />
        <span>{dateRange}</span>
      </>
    );
    if (clickable) {
      return (
        <button
          type="button"
          onClick={onOpenDatesSheet}
          className={`${marginTopClass} flex items-center gap-1 text-xs transition-opacity hover:opacity-80`}
          style={{
            color: lockedColor,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {content}
        </button>
      );
    }
    return (
      <div
        className={`${marginTopClass} flex items-center gap-1 text-xs`}
        style={{ color: lockedColor }}
      >
        {content}
      </div>
    );
  }

  // ── No dates yet ──────────────────────────────────────────────────────
  // Only canEdit users get a tap affordance. Members see nothing here.
  if (!clickable) return null;

  if (pollActive) {
    return (
      <button
        type="button"
        onClick={onOpenDatesSheet}
        className={`${marginTopClass} flex items-center gap-1.5 text-xs`}
        style={{
          color: "var(--color-bt-warning)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <Calendar size={12} />
        Polling crew &rarr;
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenDatesSheet}
      className={`${marginTopClass} flex items-center gap-1.5 text-xs`}
      style={{
        color: "var(--color-bt-accent)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <Calendar size={12} />
      Set dates &rarr;
    </button>
  );
}

// ── Idea-stage minimal header (no destination, dates, silhouette, gear) ──

const IdeaHeader: FC<{ tripName: string; myRole?: TripRole | null }> = ({
  tripName,
  myRole,
}) => (
  <div
    className="rounded-2xl border p-5"
    style={{
      background: "var(--color-bt-card)",
      borderColor: "var(--color-bt-border)",
      boxShadow: "var(--shadow-card)",
    }}
    data-testid="trip-header-idea"
  >
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
  </div>
);

// ── Plain card (no locked destination, non-idea stage) ───────────────────

const PlainHeader: FC<Omit<TripHeaderProps, "isLocked"> & { countdown: LabelledCountdown | null }> = ({
  tripName,
  status,
  location,
  dateRange,
  myRole,
  onSettingsClick,
  countdown,
  tripStartDate,
  canEdit,
  pollActive,
  onOpenDatesSheet,
}) => {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border"
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
      {onSettingsClick && (
        <div className="absolute right-3 top-3 z-20">
          <SettingsGear onClick={onSettingsClick} />
        </div>
      )}
      <div className="p-5 pr-12">
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

        <DatesRow
          tripStartDate={tripStartDate}
          dateRange={dateRange}
          canEdit={!!canEdit}
          pollActive={!!pollActive}
          onOpenDatesSheet={onOpenDatesSheet}
        />
      </div>
      {countdown && <CountdownBar countdown={countdown} />}
    </div>
  );
};

// ── Hero card (locked destination) ───────────────────────────────────────

const HeroHeader: FC<Omit<TripHeaderProps, "isLocked"> & { countdown: LabelledCountdown | null }> = ({
  tripName,
  status,
  location,
  lockedTitle,
  dateRange,
  canEdit,
  onDestinationChange: _onDestinationChange,
  onDatesTap: _onDatesTap,
  tripStartDate,
  myRole,
  onSettingsClick,
  countdown,
  pollActive,
  onOpenDatesSheet,
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
      topRightAction={onSettingsClick ? <SettingsGear onClick={onSettingsClick} /> : undefined}
      topContent={
        <>
          {/* Row 1: role + trip name. Right padding leaves room for the gear. */}
          <div className="flex min-w-0 items-center gap-2 pr-10">
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

          <DatesRow
            tripStartDate={tripStartDate}
            dateRange={dateRange}
            canEdit={!!canEdit}
            pollActive={!!pollActive}
            onOpenDatesSheet={onOpenDatesSheet}
            lockedColor={metaColor}
          />
        </>
      }
    >
      {countdown && <CountdownBar countdown={countdown} />}
    </LocationHero>
  );
};

// ── Exported TripHeader ──────────────────────────────────────────────────

export function TripHeader(props: TripHeaderProps) {
  // Idea stage: stripped-down header — no destination/dates/silhouette/gear/countdown.
  if (props.stage === "idea") {
    return <IdeaHeader tripName={props.tripName} myRole={props.myRole} />;
  }

  // Compute countdown once; render only when there's something useful to show.
  const result = getTripCountdown(props.tripStartDate ?? null, props.tripEndDate ?? null, props.stage);
  const countdown = result.type === "idea" || result.type === "no_dates" ? null : result;

  if (props.isLocked) {
    return <HeroHeader {...props} countdown={countdown} />;
  }
  return <PlainHeader {...props} countdown={countdown} />;
}
