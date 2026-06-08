"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useParams } from "next/navigation";
import { IconCheck, IconPlus } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import {
  getEffectiveStatus,
  type TripStatusFields,
  type TripDisplayStatus,
} from "@/lib/tripStatus";
import { formatDateRange } from "@/lib/dates";
import { getLocationInfo } from "@/lib/locationUtils";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * Trip switcher — opens from the grid icon in TopNav.
 *
 * Renders both surfaces (mobile bottom-sheet + desktop dropdown) in
 * one component, gated by CSS responsive classes. Same data feeds both
 * — only the chrome differs.
 *
 * Trips are grouped Active ({idea, upcoming, now}) and Past, with a section
 * divider only when both groups are populated. The currently visited trip
 * (read from /trips/[tripId] params) gets a tinted icon background +
 * checkmark next to its name.
 */

interface TripSwitcherProps {
  open: boolean;
  onClose: () => void;
}

// Minimum shape we read from the trips list. The actual query returns
// every column; we just type the fields we use here.
type SwitcherTrip = TripStatusFields & {
  id: string;
  slug?: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  locked_destination_title: string | null;
  locked_destination_location: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

// Active-group ordering bucket:
//   0 — trips WITH dates, ordered by countdown (soonest start first; a trip
//       happening now has the earliest/negative countdown so it floats up)
//   1 — committed trips with NO dates yet (between dated trips and ideas)
//   2 — ideas (idea phase) sink to the bottom
function activeBucket(t: SwitcherTrip): 0 | 1 | 2 {
  if (t.start_date) return 0;
  if (getEffectiveStatus(t) === "idea") return 2;
  return 1;
}

export function TripSwitcher({ open, onClose }: TripSwitcherProps) {
  const router = useRouter();
  const params = useParams<{ tripId?: string }>();
  const currentTripId = params?.tripId ?? null;

  // SSR-safe portal target. The mobile dim backdrop needs to render
  // outside the TopNav (which sets backdrop-filter and therefore
  // becomes a containing block for any descendant position:fixed),
  // otherwise the backdrop is sized to the header bounds and only
  // dims the title bar — exactly the bug this whole component had.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Canonical "are we in the browser" flag for the portal target.
    // Synchronizing with an external system (document) is exactly the
    // setState-in-effect use the React docs whitelist.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const { data: trips = [] } = trpc.trips.list.useQuery(undefined, {
    enabled: open, // don't fire query until user opens the switcher
  });

  // Group by effective status — active first, past last.
  const { activeTrips, pastTrips } = useMemo(() => {
    const active: SwitcherTrip[] = [];
    const past: SwitcherTrip[] = [];
    for (const t of trips as SwitcherTrip[]) {
      const status = getEffectiveStatus(t);
      if (status === "past") past.push(t);
      else active.push(t);
    }
    // Active: dated (by countdown) → dateless committed → ideas.
    active.sort((a, b) => {
      const ba = activeBucket(a);
      const bb = activeBucket(b);
      if (ba !== bb) return ba - bb;
      if (ba === 0) {
        // Dated trips by countdown — soonest start first.
        return (a.start_date ?? "").localeCompare(b.start_date ?? "");
      }
      // Dateless + ideas: most-recently-touched first.
      const ak = a.updated_at ?? a.created_at ?? "";
      const bk = b.updated_at ?? b.created_at ?? "";
      return bk.localeCompare(ak);
    });
    // Past: most-recently-ended first.
    past.sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
    return { activeTrips: active, pastTrips: past };
  }, [trips]);

  // ── Dismiss handlers — mirrors the notifications bell panel in TopNav ──
  // Outside-click uses mousedown (same as the bell). The listener is only
  // registered when open=true, which means it is added AFTER the click event
  // that opened the panel — so the synthesised mousedown from the opening tap
  // has already fired and won't spuriously trigger a close.
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        if ((e.target as Element)?.closest?.("[data-trip-switcher-trigger]")) return;
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, onClose]);

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  const body = (
    <TripSwitcherBody
      activeTrips={activeTrips}
      pastTrips={pastTrips}
      currentTripId={currentTripId}
      onSelectTrip={(id) => handleNavigate(`/trips/${id}`)}
      onNewTrip={() => handleNavigate("/trips/new")}
    />
  );

  if (!open) return null;

  return (
    <>
      {/* Mobile dim backdrop — sm:hidden so it disappears once the panel
          switches to absolute positioning on larger screens.
          Portaled to <body> so it escapes TopNav's containing block
          (the header sets backdrop-filter, which per spec creates a
          containing block for descendant position:fixed elements — a
          backdrop rendered inline here would be sized to the header
          and only dim the title bar). */}
      {mounted && createPortal(
        <div
          className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={onClose}
          aria-hidden="true"
        />,
        document.body,
      )}

      {/* Panel — fixed on mobile (drops below nav), absolute on desktop.
          fixed top-14 = 56px from the header's own top edge (backdrop-filter
          makes the header the containing block for fixed children), which
          places the panel flush below the nav bar. Same trick as the bell
          notification dropdown. */}
      <ScrollLock>
      <div
        ref={dropdownRef}
        role="dialog"
        aria-label="My trips"
        className="fixed left-4 top-14 z-50 w-[calc(100vw-32px)] max-w-[320px] overflow-hidden rounded-xl shadow-2xl sm:absolute sm:left-0 sm:top-full sm:mt-1 sm:w-[280px] sm:rounded-[14px] sm:shadow-none"
        style={{
          background: "var(--color-bt-card)",
          border: "0.5px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "0.5px solid var(--color-bt-border)" }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            My trips
          </span>
          <button
            type="button"
            onClick={() => handleNavigate("/dashboard")}
            className="text-xs transition-colors hover:opacity-80"
            style={{ color: "var(--color-bt-accent)" }}
          >
            View all
          </button>
        </div>
        <div style={{ maxHeight: "min(480px, calc(100vh - 80px))", overflowY: "auto" }}>
          {body}
        </div>
      </div>
      </ScrollLock>
    </>
  );
}

// ── Body (shared between mobile sheet + desktop dropdown) ───────────────

function TripSwitcherBody({
  activeTrips,
  pastTrips,
  currentTripId,
  onSelectTrip,
  onNewTrip,
}: {
  activeTrips: SwitcherTrip[];
  pastTrips: SwitcherTrip[];
  currentTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  onNewTrip: () => void;
}) {
  const showDividers = activeTrips.length > 0 && pastTrips.length > 0;
  const noTrips = activeTrips.length === 0 && pastTrips.length === 0;

  return (
    <div>
      {showDividers && <SectionDivider label="Active" />}
      {activeTrips.map((trip, idx) => (
        <TripSwitcherRow
          key={trip.id}
          trip={trip}
          isCurrent={trip.id === currentTripId}
          isLast={!showDividers && idx === activeTrips.length - 1 && pastTrips.length === 0}
          onClick={() => onSelectTrip(trip.slug ?? trip.id)}
        />
      ))}

      {showDividers && <SectionDivider label="Past" />}
      {pastTrips.map((trip, idx) => (
        <TripSwitcherRow
          key={trip.id}
          trip={trip}
          isCurrent={trip.id === currentTripId}
          isLast={idx === pastTrips.length - 1}
          onClick={() => onSelectTrip(trip.slug ?? trip.id)}
        />
      ))}

      {noTrips && (
        <div
          className="px-4 py-6 text-center text-xs"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          You don&apos;t have any trips yet.
        </div>
      )}

      {/* New trip row — dashed-plus icon container restored to keep
          parity with the trip rows' 34px icon slot and signal "create"
          vs the avatar/state-silhouette icons in the rows above. */}
      <button
        type="button"
        onClick={onNewTrip}
        className="flex w-full items-center transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{
          gap: 10,
          padding: "11px 16px",
          borderTop: "0.5px solid var(--color-bt-border)",
        }}
      >
        <span
          className="flex flex-shrink-0 items-center justify-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "transparent",
            border: "1.5px dashed rgba(45, 212, 191, 0.4)",
            color: "var(--color-bt-accent)",
          }}
          aria-hidden="true"
        >
          <IconPlus size={16} stroke={2} />
        </span>
        <span
          className="text-[13px] font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          New trip
        </span>
      </button>
    </div>
  );
}

// ── Section divider ───────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.07em",
        color: "var(--color-bt-text-dim)",
        textTransform: "uppercase",
        padding: "10px 16px 4px",
      }}
    >
      {label}
    </div>
  );
}

// ── Trip row ──────────────────────────────────────────────────────────────

function TripSwitcherRow({
  trip,
  isCurrent,
  isLast,
  onClick,
}: {
  trip: SwitcherTrip;
  isCurrent: boolean;
  isLast: boolean;
  onClick: () => void;
}) {
  const status = getEffectiveStatus(trip);

  // Upcoming trips show a countdown ("5 days" / "Tomorrow") instead of a static
  // "Upcoming" badge — the days-to-go is the useful glance.
  const countdownLabel =
    status === "upcoming" && trip.start_date
      ? (() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const [y, m, d] = trip.start_date.slice(0, 10).split("-").map(Number);
          const start = new Date(y, m - 1, d);
          start.setHours(0, 0, 0, 0);
          const n = Math.round((start.getTime() - today.getTime()) / 86400000);
          if (n <= 0) return null;
          return n === 1 ? "Tomorrow" : `${n} days`;
        })()
      : null;

  const destination =
    trip.locked_destination_location ?? trip.locked_destination_title ?? null;
  const dateRange =
    trip.start_date && trip.end_date
      ? formatDateRange(trip.start_date, trip.end_date)
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center text-left transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{
        gap: 10,
        padding: "11px 16px",
        background: isCurrent ? "rgba(45, 212, 191, 0.05)" : undefined,
        borderBottom: isLast ? undefined : "0.5px solid var(--color-bt-border)",
      }}
    >
      {/* Icon container — single border (no nesting), renders the
          destination's state silhouette when we recognize it, falls
          back to the BuddyTrip flag mark otherwise. */}
      <TripIcon
        location={
          trip.locked_destination_location ?? trip.locked_destination_title ?? null
        }
        isCurrent={isCurrent}
      />

      {/* Center: trip info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[5px]">
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {trip.title}
          </span>
          {isCurrent && (
            <IconCheck
              size={14}
              stroke={2}
              style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
              aria-label="Current trip"
            />
          )}
        </div>
        {/* Destination, then dates on their own line below it. */}
        {destination && (
          <div
            className="truncate"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)", marginTop: 1 }}
          >
            {destination}
          </div>
        )}
        {dateRange && (
          <div
            className="truncate"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)", marginTop: 1 }}
          >
            {dateRange}
          </div>
        )}
        {!destination && !dateRange && (
          <div
            className="truncate"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)", marginTop: 1 }}
          >
            Destination TBD
          </div>
        )}
      </div>

      {/* Right: plain text — countdown for dated trips, else the stage label
          ("Planning" / "Idea" / etc.). No pill badge. */}
      <span
        className="flex-shrink-0"
        style={{ fontSize: 11, fontWeight: 600, color: "var(--color-bt-text-dim)" }}
      >
        {countdownLabel ?? STAGE_LABELS[status]}
      </span>
    </button>
  );
}

// ── Trip icon (state silhouette + flag fallback) ─────────────────────────

/**
 * 34px square icon container that renders either:
 *   - the destination's US-state silhouette (when the location parses
 *     to a recognized state via getLocationInfo), or
 *   - the BuddyTrip flag mark (same SVG as the TopNav logo) as a
 *     neutral, location-agnostic fallback for international /
 *     unrecognized / TBD destinations.
 *
 * Single border, no nested borders.
 */
function TripIcon({
  location,
  isCurrent,
}: {
  location: string | null;
  isCurrent: boolean;
}) {
  const info = location ? getLocationInfo(location) : null;
  const outline = info?.outline ?? null;

  return (
    <span
      className="flex flex-shrink-0 items-center justify-center overflow-hidden"
      style={{
        width: 34,
        height: 34,
        borderRadius: 9,
        background: isCurrent
          ? "rgba(45, 212, 191, 0.1)"
          : "var(--color-bt-card-raised)",
        border: isCurrent
          ? "0.5px solid rgba(45, 212, 191, 0.25)"
          : "0.5px solid var(--color-bt-border)",
        color: "var(--color-bt-accent)",
      }}
      aria-hidden="true"
    >
      {outline ? (
        <svg
          viewBox={outline.viewBox}
          width={22}
          height={22}
          preserveAspectRatio="xMidYMid meet"
          style={
            info?.rotation
              ? { transform: `rotate(${info.rotation}deg)` }
              : undefined
          }
        >
          <path d={outline.path} fill="currentColor" stroke="none" />
        </svg>
      ) : (
        // Fallback: BuddyTrip flag (same path as the TopNav logo)
        <svg width={16} height={16} viewBox="0 0 100 100">
          <path
            d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"
            fill="currentColor"
          />
        </svg>
      )}
    </span>
  );
}

// ── Stage labels (plain text on the right of each row) ────────────────────

const STAGE_LABELS: Record<TripDisplayStatus, string> = {
  idea: "Idea",
  upcoming: "Planning",
  now: "Now",
  past: "Past",
};
