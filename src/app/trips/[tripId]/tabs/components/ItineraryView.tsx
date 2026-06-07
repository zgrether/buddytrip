"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Home,
  MapPin,
  Navigation,
  Plane,
  Trophy,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";
import { parseLocalDate, fmtTime12 } from "@/lib/dates";
import { addDays, differenceInDays } from "@/lib/tripStatus";
import {
  buildItinerary,
  groupByDay,
  groupDayBlocks,
  summarizeLodging,
  todayLocalISO,
  type ItineraryEvent,
  type ItineraryLogisticsItem,
  type ItineraryScheduleItem,
  type ItineraryTripMember,
  type LodgingStay,
} from "../../components/itinerary";
import type { TripData } from "../types";
import { DOMAIN_COLORS, type Domain } from "@/lib/domainColors";

// ── Types ─────────────────────────────────────────────────────────────────

type FilterKey = "all" | "lodging" | "travel" | "events";

type EventCategory = "lodging" | "travel" | "event";

type ArrivalEvent = Extract<ItineraryEvent, { kind: "arrival" }>;

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
  /** Optional slot rendered on the right of the ITINERARY header row.
   *  ItineraryPanel uses this to inject the "← Setup guide" toggle when
   *  the guide is currently dismissed. */
  headerAction?: import("react").ReactNode;
}

/**
 * ItineraryView — the live content of the home-tab Itinerary panel.
 *
 *   1. ITINERARY section header (sits at the top of the view, mirroring
 *      Schedule / Crew tab headers).
 *   2. Filter pills: All / Lodging / Travel / Events. Each non-All pill
 *      only renders when that category has at least one event. The Travel
 *      pill shows whenever member arrivals exist — travel is entered per
 *      crew member on the Crew tab, so there's no owner activation gate.
 *   3. Day-by-day timeline from trip start through trip end, pulling from
 *      confirmed schedule items, lodging check-in/out, and crew members'
 *      travel arrivals.
 *   4. When activated but no content exists, a visually appealing empty
 *      state mirrors the intro modal preview. Owners get an X button
 *      that backs out of the activation entirely.
 */
export function ItineraryView({ trip, isOwner: _isOwner, onCancel, headerAction }: ItineraryViewProps) {
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

  // Lodging renders as a block above the day list (not inline), so summarize
  // confirmed properties by check-in date. The inline day rows below exclude
  // lodging-kind events.
  const lodgingStays = useMemo(
    () => summarizeLodging(logisticsItems as unknown as ItineraryLogisticsItem[]),
    [logisticsItems],
  );

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
  // Don't tease a filter the user can't actually use. Lodging now comes from
  // the summarized block (not inline events).
  const hasLodging = lodgingStays.length > 0;
  const hasTravel = events.some((e) => categoryOf(e) === "travel");
  const hasEvents = events.some((e) => categoryOf(e) === "event");

  // The lodging block shows only under All or Lodging.
  const showLodgingBlock =
    lodgingStays.length > 0 &&
    (activeFilters.has("all") || activeFilters.has("lodging"));

  // Per-day arrivals group shows only under All or Travel.
  const showArrivals = activeFilters.has("all") || activeFilters.has("travel");

  // Show pill row only if there's >1 category to filter between. Travel
  // arrivals weave in from crew members' own travel plans (Crew tab), so the
  // Travel pill shows whenever arrivals exist — no separate enable gate.
  const visibleCategoryCount =
    (hasLodging ? 1 : 0) + (hasTravel ? 1 : 0) + (hasEvents ? 1 : 0);
  const showFilterPills = visibleCategoryCount > 1;

  const isEmpty = days.length === 0 || events.length === 0;

  // ── Render ─────────────────────────────────────────────────────────────
  // Header only appears once there's content — when the panel is showing
  // its empty-state mock-up, the dashed card stands on its own.
  return (
    // flex+h-full chain keeps the empty-state mock-up filling its column.
    // h-full collapses harmlessly to auto in single-column contexts where
    // the parent has no defined height (the Home tab now renders the
    // itinerary full-width — Travel Plans moved to the Crew tab).
    <div className="flex h-full flex-col space-y-3">
      {/* Header — ITINERARY eyebrow on the left, optional headerAction
          (e.g. the "Setup guide" toggle) on the right. Always rendered
          so the orienting label and the route back to the guide stay
          available even on the empty-state mockup. Filter pills under
          the row only render when there's actually content to filter
          (visibleCategoryCount > 1).
          items-baseline so the eyebrow h2 stays glued to its own
          baseline instead of being centered against the slightly
          taller action button — otherwise items-center pushes the h2
          ~1px lower than the same eyebrow on other tabs. */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            className="text-[11px] font-semibold uppercase"
            style={{
              color: "var(--color-bt-accent)",
              letterSpacing: "0.1em",
            }}
          >
            Itinerary
          </h2>
          {headerAction && (
            <div className="flex flex-shrink-0 items-center">
              {headerAction}
            </div>
          )}
        </div>

        {!isEmpty && showFilterPills && (
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill
              label="All"
              tone="all"
              active={activeFilters.has("all")}
              onClick={() => toggleFilter("all")}
            />
            {hasLodging && (
              <FilterPill
                label="Lodging"
                tone="lodging"
                active={activeFilters.has("lodging")}
                onClick={() => toggleFilter("lodging")}
              />
            )}
            {hasTravel && (
              <FilterPill
                label="Travel"
                tone="travel"
                active={activeFilters.has("travel")}
                onClick={() => toggleFilter("travel")}
              />
            )}
            {hasEvents && (
              <FilterPill
                label="Events"
                tone="events"
                active={activeFilters.has("events")}
                onClick={() => toggleFilter("events")}
              />
            )}
          </div>
        )}
      </div>

      {showLodgingBlock && <LodgingBlock stays={lodgingStays} />}

      {isEmpty ? (
        <EmptyItineraryState onCancel={onCancel} />
      ) : (
        <div className="space-y-4">
          {(() => {
            // Anchor day numbering on trip.start_date so off-range dates read
            // correctly (Day 0 = night before, etc.).
            const dayNumOf = (date: string) =>
              trip.start_date
                ? differenceInDays(parseLocalDate(date), parseLocalDate(trip.start_date)) + 1
                : null;

            // Per-day visible content under the active filter.
            const dayData = new Map<
              string,
              { arrivals: ArrivalEvent[]; items: ItineraryEvent[] }
            >();
            for (const date of days) {
              const dayEvents = eventsByDate.get(date) ?? [];
              const arrivals = showArrivals
                ? (dayEvents.filter((e) => e.kind === "arrival") as ArrivalEvent[])
                : [];
              // Lodging check-in/out stay inline; only arrivals are pulled out.
              const items = dayEvents
                .filter((e) => e.kind !== "arrival")
                .filter(showEvent);
              dayData.set(date, { arrivals, items });
            }

            const renderDay = (date: string, compact = false) => {
              const dd = dayData.get(date)!;
              return (
                <DaySection
                  key={date}
                  date={date}
                  dayNumber={dayNumOf(date)}
                  isToday={date === today}
                  arrivals={dd.arrivals}
                  events={dd.items}
                  compact={compact}
                />
              );
            };

            // Past days collapse into one "Earlier" line; runs of 2+ empty
            // upcoming days compress into a band (lone empties stay a single
            // "Nothing scheduled" day). Emptiness is computed AFTER the filter.
            const blocks = groupDayBlocks(
              days.map((date) => {
                const dd = dayData.get(date)!;
                return { date, empty: dd.arrivals.length === 0 && dd.items.length === 0 };
              }),
              today,
            );

            return blocks.map((block, i) => {
              if (block.type === "past") {
                return (
                  <PastRun
                    key="past"
                    dates={block.dates}
                    dayNumOf={dayNumOf}
                    renderDay={renderDay}
                  />
                );
              }
              if (block.type === "emptyRun") {
                return block.dates.length === 1 ? (
                  renderDay(block.dates[0])
                ) : (
                  <EmptyRunBand key={`run-${i}`} dates={block.dates} dayNumOf={dayNumOf} />
                );
              }
              return renderDay(block.date);
            });
          })()}
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
    // flex-1 = grow to fill the section's h-full container so this dashed
    // box matches the height of the Travel Plans panel's empty state when
    // they're side-by-side. Extra height shows up as empty space BELOW
    // the mock content, inside the dashed border.
    <div
      className="relative flex flex-1 flex-col rounded-xl p-4"
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

// ── ArrivalsGroup ─────────────────────────────────────────────────────────
// Collapsible per-day arrivals summary at the top of a day: "Arrivals · N"
// (teal travel category) expands to Flying / Driving / Other groups (only
// modes with people; WHITE labels) of avatar + first-name + time chips.
// Untimed arrivals render "TBD" in a dashed chip; timed people sort first
// (the arrivals arrive pre-sorted by time, untimed last).

const ARRIVAL_MODES: { key: ArrivalEvent["mode"]; label: string; Icon: LucideIcon }[] = [
  { key: "flying", label: "Flying", Icon: Plane },
  { key: "driving", label: "Driving", Icon: Car },
  { key: "other", label: "Other", Icon: Navigation },
];

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function ArrivalsGroup({ arrivals }: { arrivals: ArrivalEvent[] }) {
  const [open, setOpen] = useState(false);
  const groups = ARRIVAL_MODES.map((m) => ({
    ...m,
    people: arrivals.filter((a) => a.mode === m.key),
  })).filter((m) => m.people.length > 0);

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        borderLeft: "3px solid var(--color-bt-accent)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3"
        aria-expanded={open}
      >
        <span
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
        >
          <Plane size={13} />
        </span>
        <span className="flex-1 text-left text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Arrivals{" "}
          <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}>
            · {arrivals.length}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="flex-shrink-0 transition-transform"
          style={{
            color: "var(--color-bt-text-dim)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>

      {open && (
        <div
          className="mt-2.5 flex flex-col gap-2.5 pt-2.5"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          {groups.map((g) => (
            <div key={g.key} className="flex items-start gap-2.5">
              <span
                className="flex w-[72px] flex-shrink-0 items-center gap-1.5 pt-1 text-xs font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                <g.Icon size={13} />
                {g.label}
              </span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {g.people.map((p) => (
                  <PersonChip key={p.memberId} person={p} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonChip({ person }: { person: ArrivalEvent }) {
  const untimed = !person.time;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-[3px] pl-[3px] pr-2.5"
      style={{
        background: "var(--color-bt-card-raised)",
        border: `1px ${untimed ? "dashed" : "solid"} var(--color-bt-border)`,
      }}
    >
      <Avatar
        name={person.displayName}
        avatarIcon={person.avatarIcon ?? null}
        sizePx={22}
        muted={person.isGuest ?? false}
      />
      {/* Name + time share a baseline so the smaller time doesn't ride higher
          than the name; the outer chip still center-aligns the avatar. */}
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className="text-[12px] font-semibold leading-none"
          style={{ color: "var(--color-bt-text)" }}
        >
          {firstName(person.displayName)}
        </span>
        <span
          className="text-[11px] leading-none"
          style={{
            color: "var(--color-bt-text-dim)",
            fontStyle: untimed ? "italic" : undefined,
          }}
        >
          {untimed ? "TBD" : fmtTime12(person.time as string)}
        </span>
      </span>
    </span>
  );
}

// ── LodgingBlock ──────────────────────────────────────────────────────────
// Horizontal flex-wrap row of confirmed properties, ordered by check-in,
// sitting under the ITINERARY/filters row (no "where we're staying" label).
// Each tile: planning-blue home icon, name, "Jun 17 – 19 · 2 nights" meta,
// and a Directions button (collapses to the pin icon on mobile). Matches the
// design source's `.hy-prop` recipe (planning-tinted via color-mix on tokens).

const PLANNING_TILE_BG = "color-mix(in srgb, var(--color-bt-planning) 18%, var(--color-bt-card))";
const PLANNING_BTN_BG = "color-mix(in srgb, var(--color-bt-planning) 13%, var(--color-bt-card))";
const PLANNING_BTN_BORDER = "color-mix(in srgb, var(--color-bt-planning) 24%, transparent)";

/** "Jun 17 – 19 · 2 nights · Sleeps 8" — single month collapses to one label;
 *  nights appended when check-out is known; "· Sleeps N" appended when known. */
function formatStayMeta(stay: LodgingStay): string {
  const ci = parseLocalDate(stay.checkIn);
  const ciMonth = ci.toLocaleDateString("en-US", { month: "short" });
  let range: string;
  if (!stay.checkOut) {
    range = `${ciMonth} ${ci.getDate()}`;
  } else {
    const co = parseLocalDate(stay.checkOut);
    const coMonth = co.toLocaleDateString("en-US", { month: "short" });
    range =
      ciMonth === coMonth
        ? `${ciMonth} ${ci.getDate()} – ${co.getDate()}`
        : `${ciMonth} ${ci.getDate()} – ${coMonth} ${co.getDate()}`;
  }
  const nights =
    stay.nights != null ? ` · ${stay.nights} night${stay.nights === 1 ? "" : "s"}` : "";
  const sleeps = stay.sleeps ? ` · Sleeps ${stay.sleeps}` : "";
  return `${range}${nights}${sleeps}`;
}

function LodgingBlock({ stays }: { stays: LodgingStay[] }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {stays.map((stay) => (
        <div
          key={stay.id}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{
            flex: "1 1 240px",
            minWidth: 0,
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
            style={{ color: "var(--color-bt-planning)", background: PLANNING_TILE_BG }}
          >
            <Home size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {stay.name}
            </p>
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {formatStayMeta(stay)}
            </p>
          </div>
          {stay.address && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stay.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-semibold"
              style={{
                color: "var(--color-bt-planning)",
                background: PLANNING_BTN_BG,
                border: `1px solid ${PLANNING_BTN_BORDER}`,
              }}
              aria-label={`Directions to ${stay.name}`}
            >
              <MapPin size={13} />
              <span className="hidden sm:inline">Directions</span>
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── FilterPill ────────────────────────────────────────────────────────────

type PillTone = "all" | "lodging" | "travel" | "events";

// Each filter pill borrows its content area's domain color (item accents),
// so the itinerary filters read in the same hues as their source tabs.
// "All" uses Home teal — the itinerary lives on the Home tab.
const PILL_DOMAIN: Record<PillTone, Domain> = {
  all: "home",
  lodging: "lodging",
  travel: "travel",
  events: "events",
};

function FilterPill({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: PillTone;
  active: boolean;
  onClick: () => void;
}) {
  const { color, faint } = DOMAIN_COLORS[PILL_DOMAIN[tone]];
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
          ? {
              background: faint,
              color,
              border: `1px solid ${color}`,
            }
          : {
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {/* Domain dot — always tinted to the area's hue so the color reads
          even on inactive pills (where the label itself stays neutral). */}
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </button>
  );
}

// ── DaySection ────────────────────────────────────────────────────────────

// ── Collapsing run bands (past days + empty-day runs) ─────────────────────

function shortDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Split a date run into a white "Days N–M" part and a gray date part.
 *  `days` is null when day numbers aren't available (e.g. no trip start). */
function rangeParts(
  dates: string[],
  dayNumOf: (d: string) => number | null
): { days: string | null; dates: string } {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const datePart =
    first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`;
  const n0 = dayNumOf(first);
  const n1 = dayNumOf(last);
  let days: string | null = null;
  if (n0 != null && n1 != null && n0 >= 1) {
    days = n0 === n1 ? `Day ${n0}` : `Days ${n0}–${n1}`;
  }
  return { days, dates: datePart };
}

/** Collapsed dashed band — shared by the past-days and empty-run rows. */
function RunBand({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left"
      style={{
        background: "var(--color-bt-card)",
        border: "1px dashed var(--color-bt-border)",
        color: "var(--color-bt-text-dim)",
      }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 text-[12.5px]">{children}</span>
      {/* Neutral (white), not teal — these bands are de-emphasized, not a CTA. */}
      <span
        className="flex flex-shrink-0 items-center gap-1 text-[11.5px] font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        Show <ChevronDown size={13} />
      </span>
    </button>
  );
}

function CollapseControl({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-1 pt-1 text-[11.5px] font-semibold"
      style={{ color: "var(--color-bt-text)" }}
    >
      <ChevronUp size={13} /> {label}
    </button>
  );
}

// Past days: collapsed "Earlier … done" line; expanded = dimmed + shrunk days.
function PastRun({
  dates,
  dayNumOf,
  renderDay,
}: {
  dates: string[];
  dayNumOf: (d: string) => number | null;
  renderDay: (date: string, compact: boolean) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    const { days, dates: dlabel } = rangeParts(dates, dayNumOf);
    return (
      <RunBand icon={<Check size={15} style={{ color: "var(--color-bt-accent)" }} />} onClick={() => setOpen(true)}>
        <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>
          Earlier{days ? ` · ${days}` : ""}
        </span>
        {` · ${dlabel} · done`}
      </RunBand>
    );
  }
  return (
    <div className="space-y-4">
      <div className="space-y-4 opacity-50">
        {dates.map((date) => renderDay(date, true))}
      </div>
      <CollapseControl label="Hide past days" onClick={() => setOpen(false)} />
    </div>
  );
}

// A run of 2+ empty upcoming days: collapsed band; expanded = individual
// "Nothing scheduled" days.
function EmptyRunBand({
  dates,
  dayNumOf,
}: {
  dates: string[];
  dayNumOf: (d: string) => number | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    const { days, dates: dlabel } = rangeParts(dates, dayNumOf);
    return (
      <RunBand
        icon={<Calendar size={15} style={{ color: "var(--color-bt-text-dim)" }} />}
        onClick={() => setOpen(true)}
      >
        {days && (
          <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>{days}</span>
        )}
        {days ? ` · ${dlabel} · open` : `${dlabel} · open`}
      </RunBand>
    );
  }
  return (
    <div className="space-y-4">
      {dates.map((date) => (
        <DaySection
          key={date}
          date={date}
          dayNumber={dayNumOf(date)}
          isToday={false}
          arrivals={[]}
          events={[]}
        />
      ))}
      <CollapseControl label="Collapse open days" onClick={() => setOpen(false)} />
    </div>
  );
}

function DaySection({
  date,
  dayNumber,
  isToday,
  arrivals,
  events,
  compact = false,
}: {
  date: string;
  dayNumber: number | null;
  isToday: boolean;
  arrivals: ArrivalEvent[];
  events: ItineraryEvent[];
  /** Tighter spacing for the dimmed past-day expansion. */
  compact?: boolean;
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
      <div className={`flex items-center gap-2 ${compact ? "mb-1" : "mb-2"}`}>
        {/* Day # gray, date white; TODAY (teal badge) carries the emphasis. */}
        <p className="text-[10px] font-bold uppercase tracking-widest">
          {dayLabel && (
            <span style={{ color: "var(--color-bt-text-dim)" }}>{dayLabel}</span>
          )}
          <span style={{ color: "var(--color-bt-text)" }}>{dateLabel}</span>
        </p>
        {isToday && (
          <span
            className="rounded-full px-2 py-[2px] text-[9.5px] font-bold tracking-wide"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
          >
            TODAY
          </span>
        )}
      </div>
      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        {arrivals.length > 0 && <ArrivalsGroup arrivals={arrivals} />}
        {events.map((event) => (
          <EventCard key={event.id} event={event} compact={compact} />
        ))}
        {arrivals.length === 0 && events.length === 0 && (
          <p className="pl-3 text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Nothing scheduled
          </p>
        )}
      </div>
    </section>
  );
}

// ── EventCard ─────────────────────────────────────────────────────────────

function EventCard({ event, compact = false }: { event: ItineraryEvent; compact?: boolean }) {
  const category = categoryOf(event);

  // Golf: show tee times or "Walk on"; everything else shows the stored
  // time, or "Anytime" when untimed-but-dated (time is display-only — the
  // item's slot is set by Agenda drag order, not the clock).
  const timeLabel =
    event.kind === "schedule" && event.itemType === "golf"
      ? event.teeTimes === null || event.teeTimes === undefined
        ? "Anytime"
        : event.teeTimes.length === 0
        ? "Walk on"
        : event.teeTimes.map(fmtTime12).join(" · ")
      : event.time
      ? fmtTime12(event.time)
      : "Anytime";

  // Left accent stripe — neutral card with a 3px colored left border so
  // each category is scannable without the heavy full-background tint.
  // Stripe color matches the FilterPill tones for visual consistency.
  let stripeColor: string;
  let iconBg: string;
  let iconColor: string;
  let Icon: LucideIcon | null;

  if (category === "lodging") {
    stripeColor = "var(--color-bt-planning)";
    iconBg = "var(--color-bt-blue-bg)";
    iconColor = "var(--color-bt-planning)";
    Icon = Home;
  } else if (category === "travel") {
    stripeColor = "var(--color-bt-accent)";
    iconBg = "var(--color-bt-accent-faint)";
    iconColor = "var(--color-bt-accent)";
    Icon = Plane;
  } else {
    stripeColor = "var(--color-bt-ready)";
    iconBg = "var(--color-bt-ready-bg)";
    iconColor = "var(--color-bt-ready)";
    Icon = Clock;
  }

  // Address is set on lodging events (item.address) and golf schedule
  // events (course_location). When present, render a tap-to-map link.
  const address = "address" in event ? event.address ?? null : null;

  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-3 ${compact ? "py-1.5" : "py-2.5"}`}
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        borderLeft: `3px solid ${stripeColor}`,
      }}
    >
      {event.kind === "arrival" ? (
        <Avatar
          name={event.displayName}
          avatarIcon={event.avatarIcon ?? null}
          size="md"
        />
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
        {event.kind === "schedule" && event.competitionEvents?.map((ce) => (
          <div key={ce.id} className="mt-1.5 flex items-center gap-1.5">
            <Trophy size={11} style={{ color: "var(--color-bt-accent)" }} />
            <span className="text-[11px] font-medium" style={{ color: "var(--color-bt-text)" }}>
              {ce.title}
            </span>
          </div>
        ))}
      </div>
      {address && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex flex-shrink-0 items-center gap-0.5 self-center text-[11px] font-semibold"
          style={{ color: "var(--color-bt-planning)" }}
          aria-label={`Open ${event.title} in Google Maps`}
        >
          <MapPin size={11} />
          Map →
        </a>
      )}
    </div>
  );
}
