"use client";

import { useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  Flag,
  ListPlus,
  MapPin,
  Plus,
  Star,
  Trophy,
  X,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
} from "lucide-react";
import { DatesModal } from "./components/DatesModal";
import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate, fmtTime12 } from "@/lib/dates";
import { AddScheduleItemSheet } from "../components/AddScheduleItemSheet";
import { DND_EVENT_KEY } from "@/components/competition/EventsPanel";
import type { EventRow } from "@/components/competition/EventsPanel";
import type { TabProps } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

interface ScheduleItem {
  id: string;
  item_type: "general" | "golf";
  title: string;
  detail?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  is_confirmed: boolean;
  sort_order: number;
  // Golf fields
  course_id?: string | null;
  course_name?: string | null;
  course_location?: string | null;
  tee_times?: string[] | null;
  // Joined course data
  course?: {
    id: string;
    place_id?: string | null;
    name: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
  // Competition event link
  competition_event_id?: string | null;
  competition_event?: { id: string; title: string; type: string } | null;
}

interface DayGroup {
  date: string | null;
  label: string;
  items: ScheduleItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtDayHeader(d: string) {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function generateTripDays(start: string, end: string): string[] {
  const days: string[] = [];
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const cur = new Date(s);
  while (cur <= e) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function dayNumber(date: string, tripStart: string | null): number | null {
  if (!tripStart) return null;
  const s = parseLocalDate(tripStart).getTime();
  const d = parseLocalDate(date).getTime();
  return Math.floor((d - s) / 86400000) + 1;
}

// ── ScheduleItemRow ─────────────────────────────────────────────────────

function ScheduleItemRow({
  item,
  canEdit,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  isDragging,
  showDropIndicator,
  onDragStart,
  onDragOver,
  onDrop,
  onCompEventDrop,
  onUnlinkCompEvent,
  onUnschedule,
  compDragType,
  onAddToDay,
}: {
  item: ScheduleItem;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  showDropIndicator: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onCompEventDrop?: (eventId: string, itemType: string) => void;
  onUnlinkCompEvent?: () => void;
  /** Day-by-Day rows pass this — the trailing button becomes an X that
   *  sends the item back to On Deck (clears its date). When omitted, the
   *  trailing button is a trash can wired to onRemove (delete). */
  onUnschedule?: () => void;
  /** When non-null, a competition event is being dragged. The row computes
   *  whether it's a valid target and highlights itself accordingly. */
  compDragType?: "GOLF" | "GENERIC" | null;
  /** Mobile-only: open day-picker sheet to schedule this On Deck item. */
  onAddToDay?: () => void;
}) {
  const movable = canEdit;
  // GOLF events can only land on golf items; non-GOLF events land on anything.
  const isValidCompTarget =
    !!compDragType && (compDragType === "GENERIC" || item.item_type === "golf");
  // Suppress the agenda-reorder drop indicator while a comp event is being
  // dragged — its visual cue would be confusing alongside the comp highlight.
  const showReorderIndicator = !compDragType && showDropIndicator;

  return (
    <>
      {/* Drop insertion line */}
      {showReorderIndicator && (
        <div
          className="mb-1 h-0.5 rounded-full"
          style={{ background: "var(--color-bt-accent)" }}
        />
      )}
      <div
        draggable={movable}
        onDragStart={movable ? onDragStart : undefined}
        onDragOver={canEdit ? onDragOver : undefined}
        onDrop={canEdit ? (e) => {
          const compEventId = e.dataTransfer.getData(DND_EVENT_KEY);
          if (compEventId) {
            e.preventDefault();
            e.stopPropagation();
            onCompEventDrop?.(compEventId, item.item_type);
            return;
          }
          onDrop();
        } : undefined}
        className="mb-2 flex items-start gap-2 rounded-xl px-4 py-3 transition-all"
        style={{
          // Teal highlight = "locked in": non-golf needs a date; golf needs
          // a date AND tee times (or walk-on). Unconfirmed golf on a day stays grey.
          background: isValidCompTarget
            ? "var(--color-bt-accent-faint)"
            : (item.item_type === "golf" ? item.is_confirmed : !!item.scheduled_date)
            ? "var(--color-bt-tag-bg)"
            : "var(--color-bt-card)",
          border: isValidCompTarget
            ? "1.5px solid var(--color-bt-accent)"
            : `1px solid ${(item.item_type === "golf" ? item.is_confirmed : !!item.scheduled_date) ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
      {movable && (
        <GripVertical
          size={16}
          className="mt-0.5 hidden flex-shrink-0 cursor-grab lg:block"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
      )}

      {/* Type icon — always present so text aligns across item types */}
      {item.item_type === "golf" ? (
        <Flag size={14} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
      ) : (
        <Calendar size={14} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {item.title}
        </p>
        {item.detail && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {item.detail}
          </p>
        )}
        {/* Golf: course + tee times */}
        {item.item_type === "golf" && (item.course?.name || item.course_name) && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <span className="font-medium">{item.course?.name ?? item.course_name}</span>
            {(item.course?.address || item.course_location) && (
              <a
                href={
                  item.course?.lat && item.course?.lng
                    ? `https://www.google.com/maps/search/?api=1&query=${item.course.lat},${item.course.lng}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.course?.address ?? item.course_location ?? "")}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5"
                style={{ color: "var(--color-bt-accent)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <MapPin size={10} />
                Map
              </a>
            )}
          </div>
        )}
        {item.item_type === "golf" && (
          <>
            {/* Specific tee times */}
            {item.tee_times && item.tee_times.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {item.tee_times.map((t, i) => (
                  <span
                    key={i}
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    {fmtTime12(t)}
                  </span>
                ))}
              </div>
            )}
            {/* Walk on — confirmed without a specific tee time (tee_times = []) */}
            {Array.isArray(item.tee_times) && item.tee_times.length === 0 && (
              <div className="mt-1">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: "var(--color-bt-accent-faint)",
                    color: "var(--color-bt-accent)",
                    border: "1px solid var(--color-bt-accent-border)",
                  }}
                >
                  Walk on
                </span>
              </div>
            )}
          </>
        )}
        {/* Competition event badge — shown when linked to a competition event */}
        {item.competition_event && (
          <div className="mt-0.5 flex items-center gap-1">
            <Trophy size={11} style={{ color: "var(--color-bt-accent)" }} />
            <span className="text-[11px]" style={{ color: "var(--color-bt-accent)" }}>
              {item.competition_event.title}
            </span>
            {canEdit && onUnlinkCompEvent && (
              <button
                onClick={(e) => { e.stopPropagation(); onUnlinkCompEvent(); }}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                style={{ color: "var(--color-bt-accent)" }}
                title="Remove competition link"
                aria-label="Remove competition link"
              >
                <X size={10} />
              </button>
            )}
          </div>
        )}
        {/* General: location + time */}
        {item.item_type !== "golf" && item.course_name && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <MapPin size={10} />
            <span>{item.course_name}</span>
            {item.course_location && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.course_location)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5"
                style={{ color: "var(--color-bt-accent)" }}
                onClick={(e) => e.stopPropagation()}
              >
                Map
              </a>
            )}
          </div>
        )}
        {item.item_type !== "golf" && item.scheduled_time && (
          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <Clock size={10} />
            {item.scheduled_time}
          </div>
        )}
        {/* Mobile-only: schedule to a day via picker (replaces drag on touch) */}
        {canEdit && onAddToDay && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddToDay(); }}
            className="mt-2 flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 lg:hidden"
            style={{
              color: "var(--color-bt-accent)",
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
            }}
          >
            <CalendarDays size={11} />
            Add to a day
          </button>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {/* Golf: prompt to add tee time when unconfirmed (no tee times, not walk-on).
            Opens the edit sheet — same as clicking the pencil — so the user can
            set a tee time or check Walk on to confirm the round. */}
        {canEdit && item.scheduled_date && item.item_type === "golf" && !item.is_confirmed && (
          <button
            onClick={onEdit}
            className="rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Add a tee time
          </button>
        )}

        {movable && (
          <div className="flex flex-col lg:hidden">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="flex h-5 w-5 items-center justify-center transition-opacity disabled:opacity-20"
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-label="Move up"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="flex h-5 w-5 items-center justify-center transition-opacity disabled:opacity-20"
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-label="Move down"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        {canEdit && (
          <button
            onClick={onEdit}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Edit item"
          >
            <Pencil size={12} />
          </button>
        )}

        {canEdit && onUnschedule && (
          <button
            onClick={onUnschedule}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Send back to On Deck"
            title="Send back to On Deck"
          >
            <X size={14} />
          </button>
        )}
        {/* Trash: shown for all On Deck items (onUnschedule absent) regardless of
            confirmation status. Confirmed golf rounds in On Deck have no X button
            (they're not on a day) so without this they'd be impossible to remove.
            Day-by-Day items use the X-to-unschedule flow instead. */}
        {canEdit && !onUnschedule && (
          <button
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Delete item"
            title="Delete item"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
    </>
  );
}

// ── CompEventChip ────────────────────────────────────────────────────────

function CompEventChip({
  event,
  canEdit,
  onDragStarted,
  onDragEnded,
}: {
  event: EventRow;
  canEdit: boolean;
  onDragStarted?: (type: "GOLF" | "GENERIC") => void;
  onDragEnded?: () => void;
}) {
  const isGolf = event.type === "GOLF";
  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? (e) => {
        e.dataTransfer.setData(DND_EVENT_KEY, event.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStarted?.(event.type);
      } : undefined}
      onDragEnd={canEdit ? () => onDragEnded?.() : undefined}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{
        background: "var(--color-bt-card-raised)",
        border: isGolf && !event.agenda_item ? "1px solid var(--color-bt-warning)" : "1px solid var(--color-bt-border)",
      }}
    >
      <span style={{ color: isGolf ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>
        {isGolf ? <Flag size={12} /> : <Star size={12} />}
      </span>
      <p className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: "var(--color-bt-text)" }}>
        {event.title}
      </p>
      {event.scoring_format && (
        <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--color-bt-text-dim)" }}>
          {event.scoring_format}
        </span>
      )}
    </div>
  );
}

// ── ScheduleTab ─────────────────────────────────────────────────────────

type AddMode = "general" | "golf" | null;

export function ScheduleTab({
  trip,
  canEdit,
  embedded,
  onNavigateToDates,
}: TabProps & { embedded?: boolean; onNavigateToDates?: () => void }) {
  const tripId = trip.id;
  const stage = trip.stage ?? "idea";
  const utils = trpc.useUtils();
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [datesModalOpen, setDatesModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ScheduleItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ScheduleItem | null>(null);
  const [dayPickerItem, setDayPickerItem] = useState<ScheduleItem | null>(null);
  const dragState = useRef<{ groupDate: string | null; idx: number; item: ScheduleItem } | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null | false>(false);
  const [dragOverIdx, setDragOverIdx] = useState<{ groupDate: string | null; idx: number } | null>(null);
  const [unscheduledDragOver, setUnscheduledDragOver] = useState(false);
  // Type of competition event currently being dragged (null when no comp drag).
  // Drives per-item highlighting on Day-by-Day rows.
  const [compDragType, setCompDragType] = useState<"GOLF" | "GENERIC" | null>(null);

  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });
  const allItems = scheduleItems as ScheduleItem[];

  // Competition data — drives the On Deck competition events panel and
  // the drag-to-link interaction onto Day-by-Day agenda items.
  const { data: competition } = trpc.competitions.getByTrip.useQuery({ tripId });
  const { data: competitionEvents = [] } = trpc.events.list.useQuery(
    { tripId, competitionId: competition?.id ?? "" },
    { enabled: !!competition?.id }
  );
  const compEventsTyped = competitionEvents as EventRow[];
  const unlinkedCompEvents = compEventsTyped.filter((e) => !e.agenda_item);

  const linkToAgendaItem = trpc.events.linkToAgendaItem.useMutation({
    async onMutate(vars) {
      const competitionId = competition?.id ?? "";
      await utils.events.list.cancel({ tripId, competitionId });
      await utils.schedule.list.cancel({ tripId });
      const prevEvents = utils.events.list.getData({ tripId, competitionId });
      const prevSchedule = utils.schedule.list.getData({ tripId });

      // Look up the real event so the optimistic badge has the actual title
      // (otherwise the trophy chip shows blank text until the server returns).
      const sourceEvent = (prevEvents as EventRow[] | undefined)?.find((e) => e.id === vars.eventId);
      // And look up the target item so the optimistic event badge has the
      // agenda item's real title/details for symmetry.
      const targetItem = (prevSchedule as ScheduleItem[] | undefined)?.find((s) => s.id === vars.agendaItemId);

      // Optimistically update events: set / clear agenda_item
      utils.events.list.setData({ tripId, competitionId }, (old) =>
        (old as EventRow[] | undefined)?.map((e) => {
          if (e.id === vars.eventId) {
            return {
              ...e,
              agenda_item: vars.agendaItemId && targetItem
                ? {
                    id: targetItem.id,
                    title: targetItem.title,
                    item_type: targetItem.item_type,
                    course_name: targetItem.course_name ?? null,
                    scheduled_date: targetItem.scheduled_date ?? null,
                  }
                : null,
            };
          }
          // Another event currently linked to the same target item — unlink it.
          if (vars.agendaItemId && e.agenda_item?.id === vars.agendaItemId) {
            return { ...e, agenda_item: null };
          }
          return e;
        }) as never
      );

      // Optimistically update schedule items: set / clear competition_event
      utils.schedule.list.setData({ tripId }, (old) =>
        (old as ScheduleItem[] | undefined)?.map((s) => {
          if (s.id === vars.agendaItemId) {
            return {
              ...s,
              competition_event_id: vars.eventId,
              competition_event: sourceEvent
                ? { id: sourceEvent.id, title: sourceEvent.title, type: sourceEvent.type }
                : { id: vars.eventId, title: "", type: "" },
            };
          }
          // Any item previously linked to this event (covers both unlink and
          // re-link to a new item) — clear it.
          if (s.competition_event_id === vars.eventId) {
            return { ...s, competition_event_id: null, competition_event: null };
          }
          return s;
        }) as never
      );

      return { prevEvents, prevSchedule, competitionId };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevEvents) utils.events.list.setData({ tripId, competitionId: ctx.competitionId }, ctx.prevEvents);
      if (ctx?.prevSchedule) utils.schedule.list.setData({ tripId }, ctx.prevSchedule);
    },
    onSettled: (_d, _e, _v, ctx) => {
      utils.events.list.invalidate({ tripId, competitionId: ctx?.competitionId ?? competition?.id ?? "" });
      utils.schedule.list.invalidate({ tripId });
    },
  });

  // Non-editors only see confirmed items
  const visibleItems = canEdit ? allItems : allItems.filter((i) => i.is_confirmed);

  // Build day groups
  const dayGroups = useMemo<DayGroup[]>(() => {
    const tripDays =
      trip.start_date && trip.end_date
        ? generateTripDays(trip.start_date, trip.end_date)
        : [];

    // Collect all dates from items (including outside trip range)
    const itemDates = new Set<string>();
    for (const item of visibleItems) {
      if (item.scheduled_date) itemDates.add(item.scheduled_date);
    }

    const allDates = new Set([...tripDays, ...itemDates]);
    const sortedDates = Array.from(allDates).sort();

    // Group items by date
    const dateMap = new Map<string | null, ScheduleItem[]>();
    for (const item of visibleItems) {
      const key = item.scheduled_date ?? null;
      const arr = dateMap.get(key) ?? [];
      arr.push(item);
      dateMap.set(key, arr);
    }

    const sortWithinDay = (items: ScheduleItem[]) =>
      items.slice().sort((a, b) => a.sort_order - b.sort_order);

    const groups: DayGroup[] = [];

    // Unscheduled at the top
    const unscheduled = dateMap.get(null);
    if (unscheduled && unscheduled.length > 0) {
      groups.push({
        date: null,
        label: "Unscheduled",
        items: sortWithinDay(unscheduled),
      });
    }

    // Day groups — anchor numbering on trip.start_date and label
    // off-range dates as "Pre-trip" / "Post-trip" so an accidental
    // wrong year doesn't read as "Day -32" or "Day 175".
    for (const date of sortedDates) {
      const dayNum = dayNumber(date, trip.start_date ?? null);
      let label: string;
      if (dayNum === null) {
        label = fmtDayHeader(date);
      } else if (trip.end_date && date > trip.end_date) {
        label = `Post-trip · ${fmtDayHeader(date)}`;
      } else if (dayNum < 1) {
        label = `Pre-trip · ${fmtDayHeader(date)}`;
      } else {
        label = `Day ${dayNum} — ${fmtDayHeader(date)}`;
      }
      groups.push({
        date,
        label,
        items: sortWithinDay(dateMap.get(date) ?? []),
      });
    }

    return groups;
  }, [visibleItems, trip.start_date, trip.end_date]);

  // Derived slices used by the two-column layout.
  // unscheduledItems — items with no scheduled_date; live in column 1.
  // scheduledGroups  — day groups with a real date; live in column 2.
  const unscheduledItems = dayGroups.find((g) => g.date === null)?.items ?? [];
  const scheduledGroups = dayGroups.filter((g) => g.date !== null);

  // Golf items assigned to a day but not yet confirmed (no tee times, not walk-on).
  // Non-golf items are auto-confirmed when assigned to a day.
  const unconfirmedCount = allItems.filter(
    (i) => i.item_type === "golf" && !i.is_confirmed && !!i.scheduled_date
  ).length;
  // Items with a scheduled_date that falls outside the trip date range —
  // either the date or the trip itself was entered wrong.
  const outOfRangeCount =
    trip.start_date && trip.end_date
      ? allItems.filter((i) => {
          if (!i.scheduled_date) return false;
          const d = i.scheduled_date.slice(0, 10);
          return d < trip.start_date! || d > trip.end_date!;
        }).length
      : 0;

  const removeItem = trpc.schedule.remove.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const reorder = trpc.schedule.reorder.useMutation({
    async onMutate(vars) {
      await utils.schedule.list.cancel({ tripId });
      const prev = utils.schedule.list.getData({ tripId });
      // Assign sort_order based on position in the new itemIds array
      const orderMap = new Map(vars.itemIds.map((id, i) => [id, i]));
      utils.schedule.list.setData({ tripId }, (old) =>
        old
          ?.map((item) => {
            const newOrder = orderMap.get(item.id);
            return newOrder !== undefined ? { ...item, sort_order: newOrder } : item;
          })
          .sort((a, b) => a.sort_order - b.sort_order)
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.schedule.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.schedule.list.invalidate({ tripId }),
  });

  const updateItem = trpc.schedule.update.useMutation({
    async onMutate(vars) {
      await utils.schedule.list.cancel({ tripId });
      const prev = utils.schedule.list.getData({ tripId });
      utils.schedule.list.setData({ tripId }, (old) =>
        old?.map((item) =>
          item.id === vars.itemId
            ? {
                ...item,
                // Use !== undefined so null is treated as "clear the date"
                // (drops item back to On Deck). ?? would fall through on null.
                scheduled_date: vars.scheduledDate !== undefined
                  ? vars.scheduledDate
                  : item.scheduled_date,
                // Confirmation is driven entirely by the explicit isConfirmed
                // field. Golf items keep their status when moved to On Deck;
                // callers pass isConfirmed: false only for non-golf items.
                ...(vars.isConfirmed !== undefined && {
                  is_confirmed: vars.isConfirmed,
                  confirmed_at: vars.isConfirmed ? item.confirmed_at : null,
                  confirmed_by: vars.isConfirmed ? item.confirmed_by : null,
                }),
              }
            : item
        )
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.schedule.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.schedule.list.invalidate({ tripId }),
  });

  // Reorder within a day group
  const reorderInGroup = (groupDate: string | null, newGroupItems: ScheduleItem[]) => {
    const newAll: ScheduleItem[] = [];
    for (const g of dayGroups) {
      if (g.date === groupDate) {
        newAll.push(...newGroupItems);
      } else {
        newAll.push(...g.items);
      }
    }
    const ids = newAll.map((i) => i.id);
    if (ids.length > 0) {
      reorder.mutate({ tripId, itemIds: ids });
    }
  };

  const handleMove = (groupDate: string | null, items: ScheduleItem[], fromIdx: number, dir: "up" | "down") => {
    const toIdx = dir === "up" ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= items.length) return;
    const newItems = [...items];
    const [moved] = newItems.splice(fromIdx, 1);
    newItems.splice(toIdx, 0, moved);
    reorderInGroup(groupDate, newItems);
  };

  const handleDragDrop = (targetGroupDate: string | null, targetItems: ScheduleItem[], toIdx: number) => {
    if (!dragState.current) return;
    const { groupDate: sourceDate, idx: fromIdx, item: draggedItem } = dragState.current;
    dragState.current = null;
    setDragOverGroup(false);
    setDragOverIdx(null);

    // Same group — simple reorder
    if (sourceDate === targetGroupDate) {
      if (fromIdx === toIdx) return;
      const newItems = [...targetItems];
      const [moved] = newItems.splice(fromIdx, 1);
      newItems.splice(toIdx, 0, moved);
      reorderInGroup(targetGroupDate, newItems);
      return;
    }

    // Cross-group — move item to a new day AND position at toIdx within
    // that day. updateItem changes the date; reorder writes sort_orders so
    // the dropped item lands exactly where the user released it (instead of
    // wherever its old sort_order happens to fall).
    updateItem.mutate({
      tripId,
      itemId: draggedItem.id,
      scheduledDate: targetGroupDate,
      // Non-golf: confirmed when on a day, unconfirmed when in On Deck.
      // Golf: tee times / walk-on drive confirmation — never touch it here.
      ...(draggedItem.item_type !== "golf" && {
        isConfirmed: targetGroupDate !== null,
      }),
    });

    // Build the post-move ordering for the target group: insert dragged item
    // at toIdx. targetItems is the target group's items as they were at the
    // moment of drop — since the dragged item came from a different group,
    // it isn't already in targetItems.
    const newTargetItems = [...targetItems];
    newTargetItems.splice(toIdx, 0, draggedItem);

    // Compose the full ordered list across all groups, omitting the dragged
    // item from its source group and inserting it into the target group.
    // If targetGroupDate is null but dayGroups has no null group yet (all items
    // were scheduled), we won't find it in the loop — track that and prepend.
    const newAll: ScheduleItem[] = [];
    let targetInserted = false;
    for (const g of dayGroups) {
      if (g.date === sourceDate) {
        newAll.push(...g.items.filter((i) => i.id !== draggedItem.id));
      } else if (g.date === targetGroupDate) {
        newAll.push(...newTargetItems);
        targetInserted = true;
      } else {
        newAll.push(...g.items);
      }
    }
    // targetGroupDate === null but no null group existed (all items were
    // scheduled) — prepend the moved item as the first On Deck entry.
    if (!targetInserted) newAll.unshift(...newTargetItems);
    const ids = newAll.map((i) => i.id);
    if (ids.length > 0) {
      reorder.mutate({ tripId, itemIds: ids });
    }
  };

  return (
    <div className={embedded ? undefined : "px-4"}>
      {/* ── Nudges — full-width alerts above the two-column layout ──── */}

      {canEdit && !trip.start_date && allItems.length > 0 && (
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
              style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
            >
              <Calendar size={14} />
            </span>
            <div>
              <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
                Set dates to schedule your agenda
              </p>
              <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                Trip dates let you assign agenda items to specific days
              </p>
            </div>
          </div>
          {trip.planning_tier === "basic" ? (
            <button
              onClick={onNavigateToDates}
              className="flex-shrink-0 text-xs font-semibold"
              style={{ color: "var(--color-bt-accent)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              Set dates &rarr;
            </button>
          ) : (
            <>
              <button
                onClick={() => setDatesModalOpen(true)}
                className="flex-shrink-0 text-xs font-semibold"
                style={{ color: "var(--color-bt-accent)", background: "transparent", border: "none", cursor: "pointer" }}
              >
                Set dates &rarr;
              </button>
              <DatesModal
                isOpen={datesModalOpen}
                onClose={() => setDatesModalOpen(false)}
                tripId={tripId}
                initialStartDate={null}
                initialEndDate={null}
              />
            </>
          )}
        </div>
      )}

      {canEdit && unconfirmedCount > 0 && !!trip.start_date && (
        <div
          className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
          >
            <Calendar size={14} />
          </span>
          <div>
            <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
              {unconfirmedCount} golf round{unconfirmedCount !== 1 ? "s" : ""} still need a tee time
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Add tee times or mark as walk-on to confirm golf rounds for the itinerary
            </p>
          </div>
        </div>
      )}

      {canEdit && outOfRangeCount > 0 && (
        <div
          className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
          >
            <Calendar size={14} />
          </span>
          <div>
            <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
              {outOfRangeCount} item{outOfRangeCount !== 1 ? "s" : ""} fall outside the trip dates
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Double-check the date or update the trip dates if it was entered wrong
            </p>
          </div>
        </div>
      )}

      <section>
        {/* Guidance text — stage-aware */}
        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          This is where you add things like dinner reservations, golf tee times, or ideas for things to do on your trip — snorkeling, hiking, whiskey tasting, whatever. Treat it like a rough draft of your itinerary. Once an item feels ready for the rest of the crew, confirm it and it&apos;ll appear on their trip itinerary.
        </p>

        {allItems.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-10 w-10" />}
            headline="Your agenda is empty"
            subtext={canEdit ? "Add activities, golf rounds, and ideas — then drag them onto days to build the schedule." : "The organizer hasn't added anything yet."}
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">

            {/* ── Column 1: Unscheduled Items ──────────────────────── */}
            <section style={{ alignSelf: "start" }}>
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--color-bt-text-dim)" }}>
                    <ClipboardList size={12} />
                  </span>
                  <h4
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    On Deck
                  </h4>
                </div>
                {canEdit && (
                  <p className="mt-0.5 text-[10px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
                    Drag these to a day to add it to the agenda
                  </p>
                )}
              </div>

              {/* "Unscheduled" day-label — mirrors "Day N — Date" in the right column
                  so both columns line up visually at the same level. */}
              <div className="mb-1.5 flex items-center gap-2">
                <CalendarDays size={14} style={{ color: "var(--color-bt-text-dim)" }} />
                <p className="text-[13px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
                  Unscheduled
                </p>
              </div>

              {unscheduledItems.length === 0 && canEdit ? (
                /* ── Invitation panel — replaces the outer dashed container ── */
                /* Also serves as the drop target for dragging items back from  */
                /* Day-by-Day when On Deck is empty (all items scheduled).      */
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setAddMode("general")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setAddMode("general"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-8 text-center transition-all cursor-pointer"
                  style={{
                    background: unscheduledDragOver ? "var(--color-bt-accent-faint)" : "transparent",
                    border: `1.5px dashed ${unscheduledDragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setUnscheduledDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setUnscheduledDragOver(false);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setUnscheduledDragOver(false);
                    if (dragState.current && dragState.current.groupDate !== null) {
                      handleDragDrop(null, unscheduledItems, unscheduledItems.length);
                    }
                  }}
                >
                  <ListPlus
                    size={22}
                    style={{ color: unscheduledDragOver ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                  />
                  <span className="text-sm font-semibold" style={{ color: unscheduledDragOver ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}>
                    Plan Something
                  </span>
                  <span className="text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                    Add golf rounds, activities, or ideas —<br />drag them onto a day when you&apos;re ready.
                  </span>
                </div>
              ) : (
                /* ── Outer dashed container — items present, or viewer ── */
                <div
                  className="rounded-xl px-3 pt-3 pb-1 transition-colors"
                  style={{
                    background: "transparent",
                    border: `${unscheduledDragOver ? "1.5px" : "1px"} dashed ${
                      unscheduledDragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"
                    }`,
                  }}
                  onDragOver={
                    canEdit
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setUnscheduledDragOver(true);
                        }
                      : undefined
                  }
                  onDragLeave={
                    canEdit
                      ? (e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setUnscheduledDragOver(false);
                          }
                        }
                      : undefined
                  }
                  onDrop={
                    canEdit
                      ? (e) => {
                          e.preventDefault();
                          setUnscheduledDragOver(false);
                          if (dragState.current && dragState.current.groupDate !== null) {
                            handleDragDrop(null, unscheduledItems, unscheduledItems.length);
                          }
                        }
                      : undefined
                  }
                >
                  {unscheduledItems.length === 0 ? (
                    /* Viewer empty state */
                    <p className="text-[11px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
                      All items have been scheduled.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {/* eslint-disable react-hooks/refs */}
                      {unscheduledItems.map((item, idx) => (
                        <ScheduleItemRow
                          key={item.id}
                          item={item}
                          canEdit={canEdit}
                          onEdit={() => setEditItem(item)}
                          onRemove={() => setConfirmDelete(item)}
                          onMoveUp={() => handleMove(null, unscheduledItems, idx, "up")}
                          onMoveDown={() => handleMove(null, unscheduledItems, idx, "down")}
                          isFirst={idx === 0}
                          isLast={idx === unscheduledItems.length - 1}
                          isDragging={
                            !!dragState.current &&
                            dragState.current.groupDate === null &&
                            dragState.current.idx === idx
                          }
                          showDropIndicator={
                            !!dragOverIdx &&
                            dragOverIdx.groupDate === null &&
                            dragOverIdx.idx === idx &&
                            dragState.current?.idx !== idx
                          }
                          onDragStart={() => {
                            dragState.current = { groupDate: null, idx, item };
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverIdx({ groupDate: null, idx });
                          }}
                          onDrop={() => {
                            setDragOverIdx(null);
                            handleDragDrop(null, unscheduledItems, idx);
                          }}
                          onUnlinkCompEvent={item.competition_event_id ? () => {
                            linkToAgendaItem.mutate({ tripId, eventId: item.competition_event_id!, agendaItemId: null });
                          } : undefined}
                        onAddToDay={trip.start_date && trip.end_date ? () => setDayPickerItem(item) : undefined}
                        />
                      ))}
                      {/* eslint-enable react-hooks/refs */}
                      {/* Ghost add button at the bottom of the On Deck list */}
                      {canEdit && (
                        <button
                          onClick={() => setAddMode("general")}
                          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{
                            background: "transparent",
                            color: "var(--color-bt-text-dim)",
                            border: "1px dashed var(--color-bt-border)",
                          }}
                        >
                          <Plus size={12} />
                          Plan Something Else
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* Competition Events — shown below On Deck when competition is active.
                  Drag a competition event onto a Day-by-Day agenda item to link it.
                  Linked events disappear from here (they belong to the agenda item). */}
              {competition && unlinkedCompEvents.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Trophy size={12} style={{ color: "var(--color-bt-text-dim)" }} />
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                      Competition Events
                    </h4>
                  </div>
                  <p className="mb-2 text-[10px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
                    {canEdit ? "Drag onto an agenda item to add it to the schedule, or keep it unscheduled and complete it at any time" : "Competition events for this trip"}
                  </p>
                  <div
                    className="rounded-xl p-3 transition-colors space-y-1.5"
                    style={{
                      border: "1px dashed var(--color-bt-border)",
                      background: "transparent",
                    }}
                  >
                    {unlinkedCompEvents.map((event) => (
                      <CompEventChip
                        key={event.id}
                        event={event}
                        canEdit={canEdit}
                        onDragStarted={(t) => setCompDragType(t)}
                        onDragEnded={() => setCompDragType(null)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── Column 2: Schedule (day groups only) ─────────────── */}
            <section>
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--color-bt-text-dim)" }}>
                    <CalendarDays size={12} />
                  </span>
                  <h4
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Day-by-Day
                  </h4>
                </div>
                {canEdit && (
                  <p
                    className="mt-0.5 text-[10px] italic"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Drop an item onto a day to schedule it
                  </p>
                )}
              </div>

              {scheduledGroups.length === 0 ? (
                <p
                  className="text-[11px] italic"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {trip.start_date
                    ? "Nothing on the schedule yet — drag from On Deck onto a day."
                    : "Set trip dates to see the day-by-day schedule."}
                </p>
              ) : (
                <div className="space-y-5">
                  {/* eslint-disable react-hooks/refs */}
                  {scheduledGroups.map((group) => (
                    <div key={group.date!}>
                      {/* Day label — sits above the dashed drop zone */}
                      <div className="mb-1.5 flex items-center gap-2">
                        <CalendarDays size={14} style={{ color: "var(--color-bt-text-dim)" }} />
                        <p className="text-[13px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
                          {group.label}
                        </p>
                      </div>

                      {/* Dashed drop zone */}
                      <div
                        onDragOver={canEdit ? (e) => {
                          e.preventDefault();
                          if (dragState.current && dragState.current.groupDate !== group.date) {
                            setDragOverGroup(group.date);
                          }
                        } : undefined}
                        onDragEnter={canEdit ? () => {
                          if (dragState.current && dragState.current.groupDate !== group.date) {
                            setDragOverGroup(group.date);
                          }
                        } : undefined}
                        onDragLeave={canEdit ? (e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setDragOverGroup(false);
                            setDragOverIdx(null);
                          }
                        } : undefined}
                        onDrop={canEdit ? (e) => {
                          e.preventDefault();
                          setDragOverGroup(false);
                          setDragOverIdx(null);
                          if (dragState.current) {
                            handleDragDrop(group.date, group.items, group.items.length);
                          }
                        } : undefined}
                        className="rounded-xl px-3 pt-3 pb-1 transition-colors"
                        style={{
                          background: dragOverGroup === group.date
                            ? "var(--color-bt-accent-faint, rgba(13,148,136,0.06))"
                            : "transparent",
                          border: dragOverGroup === group.date
                            ? "1.5px dashed var(--color-bt-accent)"
                            : "1px dashed var(--color-bt-border)",
                        }}
                      >
                      {group.items.length === 0 ? (
                        <p
                          className="mb-2 text-xs italic"
                          style={{ color: dragOverGroup === group.date ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                        >
                          {dragOverGroup === group.date ? "Drop to schedule here" : "Nothing scheduled yet"}
                        </p>
                      ) : (
                        <>
                          {group.items.map((item, idx) => (
                            <ScheduleItemRow
                              key={item.id}
                              item={item}
                              canEdit={canEdit}
                              onEdit={() => setEditItem(item)}
                              onRemove={() => setConfirmDelete(item)}
                              onMoveUp={() => handleMove(group.date, group.items, idx, "up")}
                              onMoveDown={() => handleMove(group.date, group.items, idx, "down")}
                              isFirst={idx === 0}
                              isLast={idx === group.items.length - 1}
                              isDragging={
                                !!dragState.current &&
                                dragState.current.groupDate === group.date &&
                                dragState.current.idx === idx
                              }
                              showDropIndicator={
                                !!dragOverIdx &&
                                dragOverIdx.groupDate === group.date &&
                                dragOverIdx.idx === idx &&
                                dragState.current?.idx !== idx
                              }
                              onDragStart={() => { dragState.current = { groupDate: group.date, idx, item }; }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverIdx({ groupDate: group.date, idx });
                              }}
                              onDrop={() => {
                                setDragOverIdx(null);
                                handleDragDrop(group.date, group.items, idx);
                              }}
                              onCompEventDrop={(eventId, itemType) => {
                                // GOLF events can only link to golf agenda items
                                const draggedEvent = compEventsTyped.find((e) => e.id === eventId);
                                if (draggedEvent?.type === "GOLF" && itemType !== "golf") return;
                                if (competition?.id) {
                                  linkToAgendaItem.mutate({ tripId, eventId, agendaItemId: item.id });
                                }
                              }}
                              onUnlinkCompEvent={item.competition_event_id ? () => {
                                linkToAgendaItem.mutate({ tripId, eventId: item.competition_event_id!, agendaItemId: null });
                              } : undefined}
                              compDragType={compDragType}
                              onUnschedule={() => {
                                updateItem.mutate({
                                  tripId,
                                  itemId: item.id,
                                  scheduledDate: null,
                                  // Non-golf: unconfirmed when sent back to On Deck.
                                  // Golf: keeps its confirmed status (tee times / walk-on drive it).
                                  ...(item.item_type !== "golf" && { isConfirmed: false }),
                                });
                              }}
                            />
                          ))}
                          {/* Bottom drop zone — append to end of day */}
                          {canEdit && dragState.current && (
                            <div
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverIdx({ groupDate: group.date, idx: group.items.length });
                              }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                setDragOverIdx({ groupDate: group.date, idx: group.items.length });
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverIdx(null);
                                handleDragDrop(group.date, group.items, group.items.length);
                              }}
                              className="rounded-md transition-all"
                              style={{
                                height:
                                  dragOverIdx?.groupDate === group.date &&
                                  dragOverIdx?.idx === group.items.length
                                    ? "6px"
                                    : "24px",
                                background:
                                  dragOverIdx?.groupDate === group.date &&
                                  dragOverIdx?.idx === group.items.length
                                    ? "var(--color-bt-accent)"
                                    : "transparent",
                              }}
                            />
                          )}
                        </>
                      )}
                      </div>
                    </div>
                  ))}
                  {/* eslint-enable react-hooks/refs */}
                </div>
              )}
            </section>

          </div>
        )}
      </section>

      {addMode !== null && (
        <AddScheduleItemSheet tripId={tripId} itemType="general" onClose={() => setAddMode(null)} />
      )}

      {/* Edit sheet */}
      {editItem && (
        <AddScheduleItemSheet
          tripId={tripId}
          itemType={editItem.item_type ?? "general"}
          editItem={editItem}
          onClose={() => setEditItem(null)}
        />
      )}

      {/* Day-picker sheet — mobile scheduling for On Deck items */}
      {dayPickerItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={() => setDayPickerItem(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
            style={{ background: "var(--color-bt-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pb-3 pt-5">
              <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Add to a day
              </p>
              <p className="mt-0.5 truncate text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {dayPickerItem.title}
              </p>
            </div>

            {/* Day list */}
            <div className="max-h-72 overflow-y-auto px-3 pb-3">
              {trip.start_date && trip.end_date
                ? generateTripDays(trip.start_date, trip.end_date).map((date) => {
                    const num = dayNumber(date, trip.start_date ?? null);
                    const count = allItems.filter((i) => i.scheduled_date === date).length;
                    return (
                      <button
                        key={date}
                        onClick={() => {
                          updateItem.mutate({
                            tripId,
                            itemId: dayPickerItem.id,
                            scheduledDate: date,
                            // Non-golf: confirmed by being on a day.
                            ...(dayPickerItem.item_type !== "golf" && { isConfirmed: true }),
                          });
                          setDayPickerItem(null);
                        }}
                        className="mb-1.5 flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-opacity hover:opacity-80"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          border: "1px solid var(--color-bt-border)",
                        }}
                      >
                        <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                          {num !== null ? `Day ${num} — ` : ""}{fmtDayHeader(date)}
                        </span>
                        {count > 0 && (
                          <span className="ml-3 flex-shrink-0 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                            {count} item{count !== 1 ? "s" : ""}
                          </span>
                        )}
                      </button>
                    );
                  })
                : null}
            </div>

            {/* Cancel */}
            <div className="px-5 pb-5">
              <button
                onClick={() => setDayPickerItem(null)}
                className="w-full rounded-xl py-2.5 text-sm font-medium"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: "var(--color-bt-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="text-base font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Remove from agenda?
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              &ldquo;{confirmDelete.title}&rdquo; will be permanently removed.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-xl py-2.5 text-sm font-medium"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  removeItem.mutate({ tripId, itemId: confirmDelete.id });
                  setConfirmDelete(null);
                }}
                disabled={removeItem.isPending}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{
                  background: "var(--color-bt-danger)",
                  color: "#fff",
                }}
              >
                {removeItem.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
