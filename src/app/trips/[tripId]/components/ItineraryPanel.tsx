"use client";

import { useMemo } from "react";
import {
  Calendar,
  Clock,
  Flag,
  Home,
  Hotel,
  Plane,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate, fmtTime12 } from "@/lib/dates";
import { Avatar } from "@/components/Avatar";
import {
  buildItinerary,
  groupByDay,
  bucketDays,
  isHappeningNow,
  todayLocalISO,
  dayNumber,
  type ItineraryEvent,
  type ItineraryDay,
} from "./itinerary";

// ── Props ─────────────────────────────────────────────────────────────────

export interface ItineraryPanelProps {
  tripId: string;
  tripStartDate?: string | null;
  /** Effective trip status (`getTripStatus(trip)`) — "idea" | "upcoming" | "now" | "past". */
  status: string;
  onTabChange?: (tab: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function dayHeaderText(date: string): string {
  return parseLocalDate(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shortDayHeaderText(date: string): string {
  return parseLocalDate(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function eventTimeLabel(time: string | null): string {
  return time ? fmtTime12(time) : "All day";
}

// ── Sub-components ────────────────────────────────────────────────────────

function EventIcon({ event }: { event: ItineraryEvent }) {
  const sizeStyle = {
    width: 32,
    height: 32,
    background: "var(--color-bt-card-raised)",
    color: "var(--color-bt-text-dim)",
  };
  const wrap = (icon: React.ReactNode) => (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full"
      style={sizeStyle}
      aria-hidden
    >
      {icon}
    </div>
  );

  switch (event.kind) {
    case "schedule":
      return wrap(
        event.itemType === "golf" ? <Flag size={14} /> : <Clock size={14} />
      );
    case "lodging-checkin":
      return wrap(<Home size={14} />);
    case "lodging-checkout":
      return wrap(<Hotel size={14} />);
    case "arrival":
      return (
        <Avatar
          name={event.displayName}
          avatarIcon={event.avatarIcon ?? null}
          size="md"
        />
      );
  }
}

function HappeningNowPill() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{
        background: "var(--color-bt-warning-faint)",
        color: "var(--color-bt-warning)",
        border: "1px solid var(--color-bt-warning)",
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
        style={{ background: "var(--color-bt-warning)" }}
      />
      Happening now
    </span>
  );
}

function EventRow({
  event,
  highlightToday,
}: {
  event: ItineraryEvent;
  highlightToday: boolean;
}) {
  const happeningNow = highlightToday && isHappeningNow(event.date, event.time);
  const arrival = event.kind === "arrival";

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card)",
        border: highlightToday
          ? "1px solid var(--color-bt-accent-border)"
          : "1px solid var(--color-bt-border)",
      }}
    >
      <EventIcon event={event} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className="text-xs font-semibold tabular-nums"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {eventTimeLabel(event.time)}
          </span>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {event.title}
          </span>
          {happeningNow && <HappeningNowPill />}
          {arrival && event.kind === "arrival" && (
            <Plane
              size={12}
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-hidden
            />
          )}
        </div>
        {event.subtitle && (
          <p
            className="mt-0.5 truncate text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {event.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function DayHeader({
  date,
  variant,
  tripStart,
}: {
  date: string;
  variant: "today" | "upcoming" | "past";
  tripStart?: string | null;
}) {
  if (variant === "today") {
    return (
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={14} style={{ color: "var(--color-bt-accent)" }} />
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          Today
        </span>
        <span
          className="text-xs font-medium"
          style={{ color: "var(--color-bt-text)" }}
        >
          {shortDayHeaderText(date)}
        </span>
      </div>
    );
  }

  const dayNum = dayNumber(date, tripStart ?? null);
  const prefix = dayNum != null ? `Day ${dayNum} — ` : "";
  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {prefix}
        {dayHeaderText(date)}
      </span>
    </div>
  );
}

function DayBlock({
  day,
  variant,
  tripStart,
}: {
  day: ItineraryDay;
  variant: "today" | "upcoming" | "past";
  tripStart?: string | null;
}) {
  return (
    <div>
      <DayHeader date={day.date} variant={variant} tripStart={tripStart} />
      <div className="space-y-1.5">
        {day.events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            highlightToday={variant === "today"}
          />
        ))}
      </div>
    </div>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      {children}
    </section>
  );
}

function PanelHeader() {
  return (
    <div className="mb-3 flex items-start gap-2">
      <Calendar
        size={16}
        style={{ color: "var(--color-bt-text)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Itinerary
        </h2>
        <p
          className="text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Confirmed plans only — planners manage details in the Schedule tab.
        </p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div
        className="h-3 w-32 rounded"
        style={{ background: "var(--color-bt-card-raised)" }}
      />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-12 rounded-xl"
          style={{ background: "var(--color-bt-card-raised)" }}
        />
      ))}
    </div>
  );
}

function EmptyState({
  onTabChange,
}: {
  onTabChange?: (tab: string) => void;
}) {
  return (
    <div
      className="rounded-xl px-4 py-6 text-center"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px dashed var(--color-bt-border)",
      }}
    >
      <Calendar
        size={20}
        className="mx-auto mb-1.5"
        style={{ color: "var(--color-bt-text-dim)" }}
      />
      <p
        className="text-sm font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        Nothing confirmed yet.
      </p>
      <p
        className="mt-0.5 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Organizers can confirm items in the Schedule tab.
      </p>
      {onTabChange && (
        <button
          type="button"
          onClick={() => onTabChange("schedule")}
          className="mt-2 text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Open the Schedule tab
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function ItineraryPanel({
  tripId,
  tripStartDate,
  status,
  onTabChange,
}: ItineraryPanelProps) {
  // Hidden entirely during the idea phase.
  const hidden = status === "idea";

  // Always call hooks in the same order.
  const scheduleQuery = trpc.schedule.list.useQuery(
    { tripId },
    { enabled: !hidden }
  );
  const logisticsQuery = trpc.logistics.list.useQuery(
    { tripId },
    { enabled: !hidden }
  );
  const membersQuery = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: !hidden }
  );

  const events = useMemo(() => {
    if (hidden) return [];
    return buildItinerary({
      scheduleItems: scheduleQuery.data ?? [],
      logisticsItems: logisticsQuery.data ?? [],
      members: membersQuery.data ?? [],
    });
  }, [
    hidden,
    scheduleQuery.data,
    logisticsQuery.data,
    membersQuery.data,
  ]);

  const buckets = useMemo(() => {
    const days = groupByDay(events);
    return bucketDays(days, todayLocalISO());
  }, [events]);

  if (hidden) return null;

  const isLoading =
    scheduleQuery.isLoading ||
    logisticsQuery.isLoading ||
    membersQuery.isLoading;

  return (
    <PanelShell>
      <PanelHeader />

      {isLoading ? (
        <LoadingSkeleton />
      ) : events.length === 0 ? (
        <EmptyState onTabChange={onTabChange} />
      ) : (
        <div className="space-y-4">
          {/* Past — collapsed behind <details> */}
          {buckets.past.length > 0 && (
            <details className="group">
              <summary
                className="cursor-pointer select-none text-xs font-medium"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Earlier on this trip ({buckets.past.reduce((sum, d) => sum + d.events.length, 0)})
              </summary>
              <div
                className="mt-2 space-y-4"
                style={{ opacity: 0.55 }}
              >
                {buckets.past.map((day) => (
                  <DayBlock
                    key={day.date}
                    day={day}
                    variant="past"
                    tripStart={tripStartDate}
                  />
                ))}
              </div>
            </details>
          )}

          {/* Today — flared */}
          {buckets.today && (
            <DayBlock
              day={buckets.today}
              variant="today"
              tripStart={tripStartDate}
            />
          )}

          {/* Upcoming */}
          {buckets.upcoming.map((day) => (
            <DayBlock
              key={day.date}
              day={day}
              variant="upcoming"
              tripStart={tripStartDate}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
