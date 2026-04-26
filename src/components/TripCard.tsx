"use client";

import type { FC } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Calendar } from "lucide-react";
import { useTheme } from "next-themes";
import { StatusBadge, getTripStatus } from "./StatusBadge";
import { RoleBadge } from "./RoleBadge";
import { parseLocalDate } from "@/lib/dates";
import { isGrayscale as checkGrayscale } from "@/lib/tripStatus";
import { trpc } from "@/lib/trpc-client";
import type { TripRole } from "@/server/middleware";
import { getLocationInfo } from "@/lib/locationUtils";
import { temporalGradient } from "@/lib/temporalGradient";
import { getTripCountdown } from "@/lib/tripCountdown";
import { CountdownBar } from "@/components/TripHeader";

interface Trip {
  id: string;
  title: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Real-world location string ("Bandon, OR"); preferred over the cute idea title. */
  locked_destination_location?: string | null;
  locked_destination_title?: string | null;
  trip_status_override?: string | null;
  stage?: string | null;
  comparison_mode?: boolean | null;
  myRole?: TripRole | null;
}

interface TripCardProps {
  trip: Trip;
  unreadCount?: number;
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return "Dates TBD";
  const fmt = (d: string) =>
    parseLocalDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

export const TripCard: FC<TripCardProps> = ({ trip, unreadCount = 0 }) => {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const status = getTripStatus(trip);
  const grayscale = checkGrayscale(trip);

  // Prefer the real location ("Bandon, OR") — the locked title is the cute
  // idea name and isn't useful past the idea phase. Suppress trip.location
  // when in comparison mode (same logic as the trip detail page to avoid
  // stale destination bleeding through after an owner reopens discussion —
  // lockDestination writes to trip.location but unlockDestination doesn't
  // clear it).
  const displayDest = trip.locked_destination_location
    ?? trip.locked_destination_title
    ?? (trip.comparison_mode ? null : trip.location);

  const { outline, cityPin, showPin, rotation } = getLocationInfo(displayDest ?? "");

  const titleColor = isDark ? "#ffffff" : "rgba(0,0,0,0.85)";
  const subColor = isDark ? "rgba(255,255,255,0.70)" : "rgba(0,0,0,0.55)";
  const metaColor = isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)";

  const handleClick = () => {
    // Seed the getById cache with data we already have so the detail page
    // renders immediately instead of showing a loading spinner.
    const { myRole: _myRole, myStatus: _myStatus, ...tripData } = trip as Trip & {
      myStatus?: string | null;
      [key: string]: unknown;
    };
    utils.trips.getById.setData({ tripId: trip.id }, tripData);
    router.push(`/trips/${trip.id}`);
  };

  // Countdown — derived from trip dates + stage. Rendered as a flush bar at
  // the bottom of the card; the same component lives in TripHeader so the
  // dashboard and trip detail surfaces stay visually consistent.
  const countdownResult = getTripCountdown(
    trip.start_date,
    trip.end_date,
    trip.stage ?? "idea",
  );
  const countdown =
    countdownResult.type === "idea" || countdownResult.type === "no_dates"
      ? null
      : countdownResult;

  return (
    <button
      data-testid={`trip-card-${trip.id}`}
      onClick={handleClick}
      className="relative w-full overflow-hidden rounded-xl text-left transition-all"
      style={{
        background: isDark
          ? (status === "past" ? "var(--color-bt-card)" : temporalGradient(null, true))
          : "var(--color-bt-card)",
        border: isDark ? "none" : "1px solid var(--color-bt-border)",
        filter: grayscale ? "grayscale(100%)" : undefined,
        boxShadow: isDark
          ? "var(--shadow-card)"
          : status !== "past"
            ? "-4px 0 0 var(--color-bt-accent), var(--shadow-card)"
            : "var(--shadow-card)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = isDark
          ? "var(--shadow-raised)"
          : status !== "past"
            ? "-4px 0 0 var(--color-bt-accent), var(--shadow-raised)"
            : "var(--shadow-raised)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = isDark
          ? "var(--shadow-card)"
          : status !== "past"
            ? "-4px 0 0 var(--color-bt-accent), var(--shadow-card)"
            : "var(--shadow-card)";
      }}
    >
      <div className="relative p-4">
      {/* State outline watermark — fixed size, clips overflow */}
      {outline && (
        <div
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 overflow-hidden"
          style={{ width: '80px', height: '64px' }}
          aria-hidden="true"
        >
          <svg
            viewBox={outline.viewBox}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="xMidYMid meet"
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          >
            <path
              d={outline.path}
              style={{
                fill: isDark ? "rgba(255,255,255,0.10)" : "var(--color-bt-state-fill)",
              }}
              stroke="none"
            />
            {showPin && cityPin && (
              <>
                <circle cx={cityPin.x} cy={cityPin.y} r="7" fill="rgba(0,212,170,0.25)" />
                <circle cx={cityPin.x} cy={cityPin.y} r="3.5" fill="#00d4aa" />
              </>
            )}
          </svg>
        </div>
      )}

      {/* Badges — absolute top right, above silhouette */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <StatusBadge status={status} />
        {unreadCount > 0 && (
          <span
            className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>

      {/* Role + Title — right padding keeps text clear of badge cluster */}
      <div className="flex min-w-0 items-center gap-2 pr-24">
        {trip.myRole && <RoleBadge role={trip.myRole} />}
        <h3
          className="truncate text-base font-semibold leading-tight"
          style={{ color: titleColor }}
        >
          {trip.title}
        </h3>
      </div>

      {/* Destination — own row, only when present */}
      {displayDest && (
        <div className="mt-1.5 flex items-center gap-1 text-sm" style={{ color: subColor }}>
          <MapPin size={12} className="shrink-0" />
          <span className="truncate">{displayDest}</span>
        </div>
      )}

      {/* Dates — own row */}
      <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: metaColor }}>
        <Calendar size={11} className="shrink-0" />
        <span>{formatDateRange(trip.start_date, trip.end_date)}</span>
      </div>

      </div>
      {countdown && <CountdownBar countdown={countdown} />}
    </button>
  );
};
