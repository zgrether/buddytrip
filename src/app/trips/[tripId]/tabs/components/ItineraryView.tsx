"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  Clock,
  Home,
  MapPin,
  Plane,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { UserAvatar } from "@/components/UserAvatar";
import { parseLocalDate, fmtTime12 } from "@/lib/dates";
import { addDays, differenceInDays } from "@/lib/tripStatus";
import {
  buildItinerary,
  groupByDay,
  todayLocalISO,
  type ItineraryEvent,
  type ItineraryLogisticsItem,
  type ItineraryScheduleItem,
  type ItineraryTripMember,
} from "../../components/itinerary";
import type { TripData } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────

type FilterKey = "all" | "lodging" | "travel" | "events";

type EventCategory = "lodging" | "travel" | "event";

function categoryOf(event: ItineraryEvent): EventCategory {
  switch (event.kind) {
    case "lodging-checkin":
    case "lodging-checkout":
      return "lodging";
    case "arrival":
      return "travel";
    case "schedule":
      return "event";
  }
}

export interface ItineraryViewProps {
  trip: TripData;
  isOwner: boolean;
  /** When provided (owner only), shows an X button on the empty-state
      mock-up that backs out of the activation. */
  onCancel?: () => void;
}

/**
 * ItineraryView — the live content of the home-tab Itinerary panel.
 *
 *   1. ITINERARY section header (sits at the top of the view, mirroring
 *      Schedule / Crew tab headers).
 *   2. Filter pills: All / Lodging / Travel / Events. Each non-All pill
 *      only renders when that category has at least one event AND, for
 *      Travel, when getting_there_enabled is on (don't tease a filter
 *      for a feature the owner hasn't activated).
 *   3. Day-by-day timeline from trip start through trip end, pulling from
 *      confirmed schedule items, lodging check-in/out, and shared travel
 *      arrivals.
 *   4. When activated but no content exists, a visually appealing empty
 *      state mirrors the intro modal preview. Owners get an X button
 *      that backs out of the activation entirely.
 *
 * Getting There used to render here too — it now lives in its own panel
 * (GettingTherePanel), so it's no longer included.
 */
export function ItineraryView({ trip, isOwner: _isOwner, onCancel }: ItineraryViewProps) {
  const tripId = trip.id;

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });
  const { data: logisticsItems = [] } = trpc.logistics.list.useQuery({ tripId });

  // ── Itinerary events ───────────────────────────────────────────────────
  const events = useMemo(
    () =>
      buildItinerary({
        scheduleItems: scheduleItems as unknown as ItineraryScheduleItem[],
        logisticsItems: logisticsItems as unknown as ItineraryLogisticsItem[],
        members: members as unknown as ItineraryTripMember[],
      }),
    [scheduleItems, logisticsItems, members],
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ItineraryEvent[]>();
    for (const day of groupByDay(events)) {
      map.set(day.date, day.events);
    }
    return map;
  }, [events]);

  // ── Day range: trip.start_date → trip.end_date inclusive, PLUS any
  //               event dates that fall outside that range. Dropping
  //               events that fall on the night-before-arrival or the
  //               morning-after-checkout was hiding lodging items the
  //               user had legitimately confirmed.
  const days = useMemo(() => {
    const dateSet = new Set<string>();

    if (trip.start_date && trip.end_date) {
      const start = parseLocalDate(trip.start_date);
      const end = parseLocalDate(trip.end_date);
      const span = Math.max(0, differenceInDays(end, start));
      for (let i = 0; i <= span; i++) {
        dateSet.add(addDays(start, i).toLocaleDateString("en-CA"));
      }
    }

    for (const event of events) {
      dateSet.add(event.date);
    }

    return Array.from(dateSet).sort();
  }, [trip.start_date, trip.end_date, events]);

  const today = todayLocalISO();

  // ── Filter pills ───────────────────────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["all"]));

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (key === "all") {
        return new Set<FilterKey>(["all"]);
      }
      next.delete("all");
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) return new Set<FilterKey>(["all"]);
      return next;
    });
  };

  const showEvent = (event: ItineraryEvent): boolean => {
    if (activeFilters.has("all")) return true;
    const cat = categoryOf(event);
    if (cat === "lodging" && activeFilters.has("lodging")) return true;
    if (cat === "travel" && activeFilters.has("travel")) return true;
    if (cat === "event" && activeFilters.has("events")) return true;
    return false;
  };

  // Per-category counts drive whether each filter pill is shown.
  // Don't tease a filter the user can't actually use.
  const hasLodging = events.some((e) => categoryOf(e) === "lodging");
  const hasTravel = events.some((e) => categoryOf(e) === "travel");
  const hasEvents = events.some((e) => categoryOf(e) === "event");
  const gettingThereEnabled = !!trip.getting_there_enabled;

  // Show pill row only if there's >1 category to filter between
  const visibleCategoryCount =
    (hasLodging ? 1 : 0) + (hasTravel && gettingThereEnabled ? 1 : 0) + (hasEvents ? 1 : 0);
  const showFilterPills = visibleCategoryCount > 1;

  const isEmpty = days.length === 0 || events.length === 0;

  // ── Render ─────────────────────────────────────────────────────────────
  // Header only appears once there's content — when the panel is showing
  // its empty-state mock-up, the dashed card stands on its own.
  return (
    <div className="space-y-3">
      {!isEmpty && (
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Itinerary
        </h2>
      )}

      {showFilterPills && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill label="All" active={activeFilters.has("all")} onClick={() => toggleFilter("all")} />
          {hasLodging && (
            <FilterPill
              label="Lodging"
              active={activeFilters.has("lodging")}
              onClick={() => toggleFilter("lodging")}
            />
          )}
          {hasTravel && gettingThereEnabled && (
            <FilterPill
              label="Travel"
              active={activeFilters.has("travel")}
              onClick={() => toggleFilter("travel")}
            />
          )}
          {hasEvents && (
            <FilterPill
              label="Events"
              active={activeFilters.has("events")}
              onClick={() => toggleFilter("events")}
            />
          )}
        </div>
      )}

      {isEmpty ? (
        <EmptyItineraryState onCancel={onCancel} />
      ) : (
        <div className="space-y-4">
          {days.map((date) => {
            // Anchor day numbering on trip.start_date so dates outside
            // the trip range read correctly (Day 0 = night before, etc.).
            const dayNumber = trip.start_date
              ? differenceInDays(parseLocalDate(date), parseLocalDate(trip.start_date)) + 1
              : null;
            return (
              <DaySection
                key={date}
                date={date}
                dayNumber={dayNumber}
                isToday={date === today}
                events={(eventsByDate.get(date) ?? []).filter(showEvent)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── EmptyItineraryState ─────────────────────────────────────────────────
// Shown when the panel is activated but there are no lodging / travel /
// schedule events to thread together yet. Mirrors the intro modal preview
// so the empty state still hints at what the populated view will look like.
// When onCancel is provided (owner), an X button in the top-right backs
// out of the activation entirely.

function EmptyItineraryState({ onCancel }: { onCancel?: () => void }) {
  return (
    <div
      className="relative rounded-xl p-4"
      style={{
        background: "var(--color-bt-base)",
        border: "1px dashed var(--color-bt-border)",
      }}
    >
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel itinerary"
          data-testid="itinerary-empty-cancel"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>
      )}
      <div className="flex flex-col items-center text-center">
        <div
          className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Calendar size={22} />
        </div>
        <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
          Your timeline will start to fill in
        </p>
        <p
          className="mt-1 max-w-[280px] text-xs leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Lodging check-ins, travel arrivals, and confirmed schedule items
          will weave themselves into the timeline below.
        </p>
      </div>

      {/* Skeleton preview — two-day mini stack mirroring the intro modal */}
      <div
        className="mt-4 space-y-2 rounded-lg p-3"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          opacity: 0.65,
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-bt-accent)" }}
            aria-hidden
          />
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Day 1
          </span>
        </div>
        <SkeletonRow Icon={Home} text="Lodging check-in" time="3:00 PM" iconColor="#60a5fa" />
        <SkeletonRow
          Icon={Plane}
          text="Travel arrival"
          time="5:30 PM"
          iconColor="var(--color-bt-accent)"
        />
        <SkeletonRow Icon={MapPin} text="Welcome dinner" time="7:30 PM" iconColor="var(--color-bt-text-dim)" />

        <div className="mt-3 flex items-center gap-1.5">
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Day 2
          </span>
        </div>
        <SkeletonRow Icon={MapPin} text="Tee time" time="8:00 AM" iconColor="var(--color-bt-text-dim)" />
      </div>
    </div>
  );
}

function SkeletonRow({
  Icon,
  text,
  time,
  iconColor,
}: {
  Icon: LucideIcon;
  text: string;
  time: string;
  iconColor: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon size={11} style={{ color: iconColor }} />
        <span className="truncate text-[11px]" style={{ color: "var(--color-bt-text)" }}>
          {text}
        </span>
      </div>
      <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
        {time}
      </span>
    </div>
  );
}

// ── FilterPill ────────────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className="rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
          ? {
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-accent-border)",
            }
          : {
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {label}
    </button>
  );
}

// ── DaySection ────────────────────────────────────────────────────────────

function DaySection({
  date,
  dayNumber,
  isToday,
  events,
}: {
  date: string;
  dayNumber: number | null;
  isToday: boolean;
  events: ItineraryEvent[];
}) {
  const dateLabel = parseLocalDate(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Day labels: positive numbers stay "Day N"; negative/zero numbers
  // (event falls before trip starts) read as "Pre-trip"; numbers past
  // the trip end read as "Post-trip" — keeps day-1, day-2 etc. anchored
  // to the actual trip dates regardless of off-range events.
  let dayLabel: string;
  if (dayNumber === null) {
    dayLabel = "";
  } else if (dayNumber < 1) {
    dayLabel = "Pre-trip · ";
  } else {
    dayLabel = `Day ${dayNumber} — `;
  }

  return (
    <section data-testid={`day-section-${date}`} data-today={isToday ? "true" : undefined}>
      <div className="mb-2 flex items-center gap-2">
        {isToday && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-bt-accent)" }}
            aria-hidden
          />
        )}
        <p
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{
            color: isToday ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          }}
        >
          {dayLabel}{dateLabel}
        </p>
      </div>
      {events.length === 0 ? (
        <p className="pl-3 text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
          Nothing scheduled
        </p>
      ) : (
        <div className="space-y-1.5">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── EventCard ─────────────────────────────────────────────────────────────

function EventCard({ event }: { event: ItineraryEvent }) {
  const category = categoryOf(event);

  const timeLabel = event.time ? fmtTime12(event.time) : "All day";

  let borderColor: string;
  let iconBg: string;
  let iconColor: string;
  let Icon: LucideIcon | null;

  if (category === "lodging") {
    borderColor = "rgba(96,165,250,0.2)";
    iconBg = "rgba(96,165,250,0.12)";
    iconColor = "#60a5fa";
    Icon = Home;
  } else if (category === "travel") {
    borderColor = "var(--color-bt-accent-border)";
    iconBg = "var(--color-bt-accent-faint)";
    iconColor = "var(--color-bt-accent)";
    Icon = Plane;
  } else {
    borderColor = "var(--color-bt-border)";
    iconBg = "var(--color-bt-card-raised)";
    iconColor = "var(--color-bt-text-dim)";
    Icon = Clock;
  }

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card)",
        border: `1px solid ${borderColor}`,
      }}
    >
      {event.kind === "arrival" ? (
        <UserAvatar name={event.displayName} avatarUrl={null} size="md" />
      ) : (
        <span
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: iconBg, color: iconColor }}
        >
          {Icon && <Icon size={13} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {timeLabel}
        </p>
        <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {event.title}
        </p>
        {event.subtitle && (
          <p className="truncate text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {event.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
