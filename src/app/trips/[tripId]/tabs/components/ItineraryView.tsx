"use client";

import { useMemo, useState } from "react";
import {
  Clock,
  Home,
  Mail,
  Plane,
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
import { GettingThereSection } from "./GettingThereSection";

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
  onTabChange?: (tab: string) => void;
}

/**
 * ItineraryView — the Home tab surface during the GOING / NOW stages.
 *
 * Replaces the old ActionCenter + ItineraryPanel pair with:
 *   1. Owner-only nudge strip when there are crew members who haven't
 *      joined BuddyTrip yet.
 *   2. Getting There section (per-user travel row + owner pending tally).
 *   3. Filter pills: All / Lodging / Travel / Events (multi-select).
 *   4. Day-by-day timeline from trip start through trip end, pulling from
 *      confirmed schedule items, lodging check-in/out, and shared travel
 *      arrivals — the same data ItineraryPanel was built on, but laid out
 *      as a continuous day-by-day reel.
 */
export function ItineraryView({ trip, isOwner, onTabChange }: ItineraryViewProps) {
  const tripId = trip.id;

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });
  const { data: logisticsItems = [] } = trpc.logistics.list.useQuery({ tripId });

  const unlinkedCrewCount = useMemo(
    () =>
      (members as Array<{ isGuest?: boolean; user?: { is_guest?: boolean } | null }>).filter(
        (m) => m.isGuest || m.user?.is_guest,
      ).length,
    [members],
  );

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

  // ── Day range: trip.start_date → trip.end_date inclusive ───────────────
  const days = useMemo(() => {
    if (!trip.start_date || !trip.end_date) return [];
    const start = parseLocalDate(trip.start_date);
    const end = parseLocalDate(trip.end_date);
    const span = Math.max(0, differenceInDays(end, start));
    const out: string[] = [];
    for (let i = 0; i <= span; i++) {
      const d = addDays(start, i);
      out.push(d.toLocaleDateString("en-CA"));
    }
    return out;
  }, [trip.start_date, trip.end_date]);

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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {isOwner && unlinkedCrewCount > 0 && (
        <UnlinkedCrewNudge count={unlinkedCrewCount} onGoToCrew={() => onTabChange?.("crew")} />
      )}

      <GettingThereSection tripId={tripId} isOwner={isOwner} />

      <div className="flex flex-wrap items-center gap-2">
        <FilterPill label="All" active={activeFilters.has("all")} onClick={() => toggleFilter("all")} />
        <FilterPill label="Lodging" active={activeFilters.has("lodging")} onClick={() => toggleFilter("lodging")} />
        <FilterPill label="Travel" active={activeFilters.has("travel")} onClick={() => toggleFilter("travel")} />
        <FilterPill label="Events" active={activeFilters.has("events")} onClick={() => toggleFilter("events")} />
      </div>

      {days.length === 0 ? (
        <p className="rounded-xl p-4 text-center text-sm italic"
          style={{
            background: "var(--color-bt-card)",
            border: "1px dashed var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
          }}
        >
          Lock your dates to see a day-by-day itinerary.
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((date, i) => (
            <DaySection
              key={date}
              date={date}
              dayNumber={i + 1}
              isToday={date === today}
              events={(eventsByDate.get(date) ?? []).filter(showEvent)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── UnlinkedCrewNudge ─────────────────────────────────────────────────────

function UnlinkedCrewNudge({ count, onGoToCrew }: { count: number; onGoToCrew: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="unlinked-crew-nudge"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
        >
          <Mail size={14} />
        </span>
        <div>
          <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
            {count} {count === 1 ? "person hasn't" : "people haven't"} joined yet
          </p>
          <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
            Send them an email so they can see the plan
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onGoToCrew}
        className="flex-shrink-0 text-xs font-semibold"
        style={{
          color: "var(--color-bt-accent)",
          background: "transparent",
          border: "none",
          whiteSpace: "nowrap",
        }}
      >
        Go to Crew →
      </button>
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
  dayNumber: number;
  isToday: boolean;
  events: ItineraryEvent[];
}) {
  const dateLabel = parseLocalDate(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

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
          Day {dayNumber} — {dateLabel}
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
