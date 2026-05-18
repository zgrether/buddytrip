"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useParams } from "next/navigation";
import { IconCheck, IconPlus, IconX } from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import {
  getEffectiveStatus,
  type TripStatusFields,
  type TripDisplayStatus,
} from "@/lib/tripStatus";
import { formatDateRange } from "@/lib/dates";
import { getLocationInfo } from "@/lib/locationUtils";

/**
 * Trip switcher — opens from the grid icon in TopNav.
 *
 * Renders both surfaces (mobile bottom-sheet + desktop dropdown) in
 * one component, gated by CSS responsive classes. Same data feeds both
 * — only the chrome differs.
 *
 * Trips are grouped Active ({idea, planning, going, now}) and Past, with
 * a section divider only when both groups are populated. The currently
 * visited trip (read from /trips/[tripId] params) gets a tinted icon
 * background + checkmark next to its name.
 */

interface TripSwitcherProps {
  open: boolean;
  onClose: () => void;
}

// Minimum shape we read from the trips list. The actual query returns
// every column; we just type the fields we use here.
type SwitcherTrip = TripStatusFields & {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  locked_destination_title: string | null;
  locked_destination_location: string | null;
};

const ACTIVE_STATUSES: TripDisplayStatus[] = ["idea", "planning", "going", "now"];

export function TripSwitcher({ open, onClose }: TripSwitcherProps) {
  const router = useRouter();
  const params = useParams<{ tripId?: string }>();
  const currentTripId = params?.tripId ?? null;

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
      else if (ACTIVE_STATUSES.includes(status)) active.push(t);
      // 'saved' falls through — we treat it as past for the switcher
      else past.push(t);
    }
    return { activeTrips: active, pastTrips: past };
  }, [trips]);

  // ── Dismiss handlers ─────────────────────────────────────────────────
  // We use `pointerdown` (not `mousedown` or `click`) as the outside-tap
  // detector for both mobile and desktop. This is critical on mobile:
  //
  //   Touch → click (React handler) → setSwitcherOpen(true) → overlay renders
  //   → browser fires synthetic mousedown/mouseup/click at the touch position
  //   → those synthetic events land on the overlay → onClick={onClose} fires
  //   → sheet closes immediately ("ghost click" / "tap-through" bug).
  //
  // Browsers do NOT generate synthetic `pointerdown` events from touch-derived
  // mouse events, so switching to `pointerdown` breaks the ghost-click cycle.
  //
  // We also block for 150 ms after open to absorb any remaining edge cases
  // (e.g. slow devices where the synthetic events arrive late).
  //
  // The overlay div is kept as a visual dim backdrop ONLY — no onClick.
  // All dismiss logic lives in this single document listener.
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileSheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    let blocked = true;
    const unblock = setTimeout(() => { blocked = false; }, 150);
    const onPointerDown = (e: PointerEvent) => {
      if (blocked) return;
      // Clicks inside either panel surface belong to the panel.
      if (dropdownRef.current?.contains(e.target as Node)) return;
      if (mobileSheetRef.current?.contains(e.target as Node)) return;
      // Let the trigger button's own onClick handle the toggle.
      if ((e.target as Element)?.closest?.("[data-trip-switcher-trigger]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      clearTimeout(unblock);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose]);

  // Track client mount so the portal (document.body) is only accessed
  // after hydration — createPortal is a no-op on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
      onViewAll={() => handleNavigate("/dashboard")}
    />
  );

  // ── Mobile bottom sheet ─────────────────────────────────────────────
  // MUST render via a portal into document.body.
  //
  // The TopNav header has `backdropFilter: blur(14px)`. Per the CSS spec,
  // backdrop-filter makes an element the containing block for any
  // `position: fixed` descendants. Without a portal the sheet's
  // `fixed bottom-0` is anchored to the header's bottom edge (y≈56px)
  // rather than the viewport bottom, so the sheet slides up to nearly
  // off-screen and only ~56px of it remains visible.
  //
  // createPortal moves the DOM node to document.body, outside the
  // header's containing block, restoring normal fixed positioning.
  const mobileSheet = open ? (
    <>
      {/* Dim overlay — visual backdrop only. Dismiss handled by the
          document pointerdown listener (ghost-click safe). */}
      <div
        className="fixed inset-0 z-40 md:hidden"
        style={{ background: "var(--color-bt-overlay)" }}
        aria-hidden="true"
      />
      <div
        ref={mobileSheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="My trips"
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[80dvh] overflow-hidden md:hidden"
        style={{
          background: "var(--color-bt-card)",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderTop: "0.5px solid var(--color-bt-border)",
          paddingBottom: "env(safe-area-inset-bottom, 8px)",
          animation: "trip-switcher-slide-up 200ms ease-out",
        }}
      >
        {/* Drag handle */}
        <div
          className="mx-auto mt-[10px] h-1 w-9 rounded-sm"
          style={{ background: "var(--color-bt-border)" }}
          aria-hidden="true"
        />
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "0.5px solid var(--color-bt-border)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            My trips
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          >
            <IconX size={12} stroke={2} />
          </button>
        </div>
        {/* Body */}
        <div className="max-h-[calc(80dvh-72px)] overflow-y-auto">{body}</div>
      </div>
      <style>{`
        @keyframes trip-switcher-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  ) : null;

  return (
    <>
      {/* Mobile sheet — portalled to document.body so position:fixed uses
          the viewport as its containing block, not the backdrop-filter header. */}
      {mounted && createPortal(mobileSheet, document.body)}

      {/* ── Desktop dropdown (visible ≥ md) ─────────────────────────── */}
      {/* position:absolute is unaffected by backdrop-filter, so this can
          stay inside the header's DOM tree for correct relative positioning. */}
      <div className="hidden md:block">
        {open && (
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label="My trips"
            className="absolute right-0 top-full z-50 mt-1 w-[280px] overflow-hidden"
            style={{
              background: "var(--color-bt-card)",
              border: "0.5px solid var(--color-bt-border)",
              borderRadius: 14,
              boxShadow: "var(--shadow-floating)",
            }}
          >
            <div
              className="px-4 py-3"
              style={{ borderBottom: "0.5px solid var(--color-bt-border)" }}
            >
              <span
                className="text-xs font-medium uppercase"
                style={{ color: "var(--color-bt-text-dim)", letterSpacing: "0.04em" }}
              >
                My trips
              </span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">{body}</div>
          </div>
        )}
      </div>
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
  onViewAll,
}: {
  activeTrips: SwitcherTrip[];
  pastTrips: SwitcherTrip[];
  currentTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  onNewTrip: () => void;
  onViewAll: () => void;
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
          onClick={() => onSelectTrip(trip.id)}
        />
      ))}

      {showDividers && <SectionDivider label="Past" />}
      {pastTrips.map((trip, idx) => (
        <TripSwitcherRow
          key={trip.id}
          trip={trip}
          isCurrent={trip.id === currentTripId}
          isLast={idx === pastTrips.length - 1}
          onClick={() => onSelectTrip(trip.id)}
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

      {/* View all trips */}
      <button
        type="button"
        onClick={onViewAll}
        className="block w-full text-center transition-opacity hover:opacity-80"
        style={{
          padding: "10px 16px",
          fontSize: 12,
          color: "var(--color-bt-text-dim)",
        }}
      >
        View all trips →
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
  const stageBadge = STAGE_BADGE_STYLES[status] ?? STAGE_BADGE_STYLES.past;

  const destination =
    trip.locked_destination_location ?? trip.locked_destination_title ?? null;
  const dateRange =
    trip.start_date && trip.end_date
      ? formatDateRange(trip.start_date, trip.end_date)
      : null;
  const sub =
    destination && dateRange
      ? `${destination} · ${dateRange}`
      : destination ?? dateRange ?? "Destination TBD";

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
        <div
          className="truncate"
          style={{
            fontSize: 11,
            color: "var(--color-bt-text-dim)",
            marginTop: 1,
          }}
        >
          {sub}
        </div>
      </div>

      {/* Right: stage badge */}
      <span
        className="flex-shrink-0"
        style={{
          fontSize: 10,
          fontWeight: 500,
          padding: "2px 7px",
          borderRadius: 10,
          background: stageBadge.bg,
          color: stageBadge.fg,
          border: `0.5px solid ${stageBadge.border}`,
        }}
      >
        {STAGE_LABELS[status]}
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

// ── Stage badge palette ───────────────────────────────────────────────────

const STAGE_BADGE_STYLES: Record<
  TripDisplayStatus,
  { bg: string; fg: string; border: string }
> = {
  idea: {
    bg: "rgba(96, 165, 250, 0.1)",
    fg: "#60a5fa",
    border: "rgba(96, 165, 250, 0.2)",
  },
  planning: {
    bg: "rgba(96, 165, 250, 0.1)",
    fg: "#60a5fa",
    border: "rgba(96, 165, 250, 0.2)",
  },
  going: {
    bg: "rgba(45, 212, 191, 0.1)",
    fg: "#2dd4bf",
    border: "rgba(45, 212, 191, 0.2)",
  },
  now: {
    bg: "rgba(45, 212, 191, 0.1)",
    fg: "#2dd4bf",
    border: "rgba(45, 212, 191, 0.2)",
  },
  past: {
    bg: "var(--color-bt-card-raised)",
    fg: "var(--color-bt-text-dim)",
    border: "var(--color-bt-border)",
  },
  saved: {
    bg: "var(--color-bt-card-raised)",
    fg: "var(--color-bt-text-dim)",
    border: "var(--color-bt-border)",
  },
};

const STAGE_LABELS: Record<TripDisplayStatus, string> = {
  idea: "Idea",
  planning: "Planning",
  going: "Going",
  now: "Now",
  past: "Past",
  saved: "Saved",
};
