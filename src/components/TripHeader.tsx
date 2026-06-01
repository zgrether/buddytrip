"use client";

import { type FC } from "react";
import { useTheme } from "next-themes";
import { MapPin, Settings } from "lucide-react";
import { RoleBadge } from "@/components/RoleBadge";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import { LocationHero } from "@/components/LocationHero";
import type { TripRole } from "@/server/middleware";
import { getTripCountdown, type CountdownResult } from "@/lib/tripCountdown";
import { TripHeaderDock } from "@/components/TripHeaderDock";

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

// ── Stacked meta block (location top, dates below) ───────────────────────
//
// Lives in the top-right of the header card, immediately left of the gear.
// Mirrors the crew-row pattern: primary identity line in solid text colour
// (location with a small pin), secondary detail in a dimmer smaller font
// (dates). Right-aligned so the stack reads cleanly toward the gear.
//
// Date states still match the prior DatesRow semantics:
//   1. No dates, no poll:    "Set dates →"      (accent / teal)
//   2. No dates, poll active:"Polling crew →"   (warning / amber)
//   3. Dates locked:         "May 26 – Jun 14"  (dim, clickable when canEdit)
//
// The locked-range text is fed from upstream via `formatDateRangeCompact`,
// so the year is already stripped.

interface HeaderMetaProps {
  location?: string | null;
  tripStartDate: string | null | undefined;
  dateRange?: string;
  canEdit: boolean;
  pollActive: boolean;
  onOpenDatesSheet?: () => void;
  /** Primary line color (location) — white on the dark hero gradient,
   *  bt-text on the plain card. */
  primaryColor?: string;
  /** Secondary line color (dates) — dim variants of the primary. */
  secondaryColor?: string;
}

function HeaderMeta({
  location,
  tripStartDate,
  dateRange,
  canEdit,
  pollActive,
  onOpenDatesSheet,
  primaryColor = "var(--color-bt-text)",
  secondaryColor = "var(--color-bt-text-dim)",
}: HeaderMetaProps) {
  const hasDates = !!tripStartDate;
  const hasLocked = hasDates && dateRange && dateRange !== "Dates TBD";
  const clickable = canEdit && !!onOpenDatesSheet;

  // Resolve the dates line once so the layout below stays flat.
  // `null` means "no dates segment for non-editors with no dates set yet".
  let datesNode: React.ReactNode = null;

  if (hasLocked) {
    const content = <span>{dateRange}</span>;
    datesNode = clickable ? (
      <button
        type="button"
        onClick={onOpenDatesSheet}
        className="transition-opacity hover:opacity-80"
        style={{
          color: secondaryColor,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        {content}
      </button>
    ) : (
      <span style={{ color: secondaryColor }}>{content}</span>
    );
  } else if (clickable) {
    if (pollActive) {
      datesNode = (
        <button
          type="button"
          onClick={onOpenDatesSheet}
          style={{
            color: "var(--color-bt-warning)",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          Polling crew &rarr;
        </button>
      );
    } else {
      datesNode = (
        <button
          type="button"
          onClick={onOpenDatesSheet}
          style={{
            color: "var(--color-bt-accent)",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          Set dates &rarr;
        </button>
      );
    }
  }

  const locationNode = location ? (
    <span
      className="flex items-center gap-1 text-[13px] font-medium leading-tight"
      style={{ color: primaryColor }}
    >
      <MapPin size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{location}</span>
    </span>
  ) : null;

  if (!locationNode && !datesNode) return null;

  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5">
      {locationNode}
      {datesNode && (
        <span className="text-[11px] leading-tight">{datesNode}</span>
      )}
    </div>
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
  tripId,
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
      {/* Title and top-right meta share one flex row so the title can
          fill all the way up to the meta strip without a hardcoded
          right-padding reservation. Title shrinks (truncate) first
          when the row is tight; meta+gear stays its natural size. */}
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {myRole && <RoleBadge role={myRole} />}
            <h1
              data-testid="trip-title"
              className="truncate text-xl font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {tripName}
            </h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <HeaderMeta
              location={location}
              tripStartDate={tripStartDate}
              dateRange={dateRange}
              canEdit={!!canEdit}
              pollActive={!!pollActive}
              onOpenDatesSheet={onOpenDatesSheet}
            />
            {onSettingsClick && <SettingsGear onClick={onSettingsClick} />}
          </div>
        </div>
      </div>
      {tripId && (
        <TripHeaderDock
          tripId={tripId}
          countdown={countdown}
          canEdit={!!canEdit}
        />
      )}
    </div>
  );
};

// ── Hero card (locked destination) ───────────────────────────────────────

const HeroHeader: FC<Omit<TripHeaderProps, "isLocked"> & { countdown: LabelledCountdown | null }> = ({
  tripId,
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
  // Hero card sits on the dark temporal-gradient surface regardless of
  // theme, so the meta stack mirrors that contrast: white primary line,
  // semi-transparent white secondary line.
  const metaPrimary = isDark ? "#ffffff" : "rgba(0,0,0,0.85)";
  const metaSecondary = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";

  // Prefer location (locked_destination_location from parent) over lockedTitle
  // (locked_destination_title). Both now hold the same value after the
  // LockConfirmModal fix, but location is semantically the geographic string.
  const displayLocation = location || lockedTitle || "";

  return (
    <LocationHero
      location={displayLocation || tripName}
      tripName={tripName}
      tripStartDate={status === "past" ? tripStartDate : null}
      showStateWatermark={false}
      topContent={
        /* Title and top-right meta share one flex row inside topContent
           — no absolute topRightAction — so the title fills until it
           meets the meta strip. Title shrinks (truncate) first when
           the row gets tight; meta+gear stays its natural size. */
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {myRole && <RoleBadge role={myRole} />}
            <h1
              data-testid="trip-title"
              className="truncate text-2xl font-bold"
              style={{ color: titleColor }}
            >
              {tripName}
            </h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <HeaderMeta
              location={displayLocation}
              tripStartDate={tripStartDate}
              dateRange={dateRange}
              canEdit={!!canEdit}
              pollActive={!!pollActive}
              onOpenDatesSheet={onOpenDatesSheet}
              primaryColor={metaPrimary}
              secondaryColor={metaSecondary}
            />
            {onSettingsClick && <SettingsGear onClick={onSettingsClick} />}
          </div>
        </div>
      }
    >
      {tripId && (
        <TripHeaderDock
          tripId={tripId}
          countdown={countdown}
          canEdit={!!canEdit}
        />
      )}
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
