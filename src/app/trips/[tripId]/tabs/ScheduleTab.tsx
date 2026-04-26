"use client";

import { useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  Flag,
  MapPin,
  Plus,
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
  onConfirmToggle,
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
}: {
  item: ScheduleItem;
  canEdit: boolean;
  onConfirmToggle: () => void;
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
}) {
  const movable = canEdit;

  return (
    <>
      {/* Drop insertion line */}
      {showDropIndicator && (
        <div
          className="mb-1 h-0.5 rounded-full"
          style={{ background: "var(--color-bt-accent)" }}
        />
      )}
      <div
        draggable={movable}
        onDragStart={movable ? onDragStart : undefined}
        onDragOver={canEdit ? onDragOver : undefined}
        onDrop={canEdit ? onDrop : undefined}
        className="mb-2 flex items-start gap-2 rounded-xl px-4 py-3 transition-all"
        style={{
          background: item.is_confirmed ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
          border: `1px solid ${item.is_confirmed ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
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

      {/* Type icon */}
      {item.item_type === "golf" && (
        <Flag size={14} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
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
        {item.item_type === "golf" && item.tee_times && item.tee_times.length > 0 && (
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
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {/* Confirm toggle: only when item has a date */}
        {canEdit && item.scheduled_date && (
          <button
            onClick={onConfirmToggle}
            className="rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: item.is_confirmed ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            {item.is_confirmed ? "Confirmed 🔒" : "Confirm"}
          </button>
        )}
        {!canEdit && item.is_confirmed && (
          <span className="text-[11px] font-medium" style={{ color: "var(--color-bt-accent)" }}>
            Confirmed ✓
          </span>
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

        {canEdit && !item.is_confirmed && (
          <button
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Remove item"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
    </>
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
  const dragState = useRef<{ groupDate: string | null; idx: number; item: ScheduleItem } | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null | false>(false);
  const [dragOverIdx, setDragOverIdx] = useState<{ groupDate: string | null; idx: number } | null>(null);

  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });
  const allItems = scheduleItems as ScheduleItem[];

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

    // Day groups
    for (const date of sortedDates) {
      const dayNum = dayNumber(date, trip.start_date ?? null);
      groups.push({
        date,
        label: dayNum ? `Day ${dayNum} — ${fmtDayHeader(date)}` : fmtDayHeader(date),
        items: sortWithinDay(dateMap.get(date) ?? []),
      });
    }

    return groups;
  }, [visibleItems, trip.start_date, trip.end_date]);

  const unconfirmedCount = allItems.filter((i) => !i.is_confirmed).length;

  const confirmItem = trpc.schedule.confirm.useMutation({
    async onMutate(vars) {
      await utils.schedule.list.cancel({ tripId });
      const prev = utils.schedule.list.getData({ tripId });
      utils.schedule.list.setData({ tripId }, (old) =>
        old?.map((item) =>
          item.id === vars.itemId ? { ...item, is_confirmed: true } : item
        )
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.schedule.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.schedule.list.invalidate({ tripId }),
  });

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
            ? { ...item, scheduled_date: vars.scheduledDate ?? item.scheduled_date }
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

  const unconfirmItem = trpc.schedule.unconfirm.useMutation({
    async onMutate(vars) {
      await utils.schedule.list.cancel({ tripId });
      const prev = utils.schedule.list.getData({ tripId });
      utils.schedule.list.setData({ tripId }, (old) =>
        old?.map((item) =>
          item.id === vars.itemId
            ? { ...item, is_confirmed: false, confirmed_at: null, confirmed_by: null }
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

  const handleConfirmToggle = (item: ScheduleItem) => {
    if (item.is_confirmed) {
      unconfirmItem.mutate({ tripId, itemId: item.id });
    } else {
      confirmItem.mutate({ tripId, itemId: item.id });
    }
  };

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

    // Cross-group — move item to new day
    updateItem.mutate({
      tripId,
      itemId: draggedItem.id,
      scheduledDate: targetGroupDate,
    });
  };

  return (
    <div className={embedded ? undefined : "px-4"}>
      <section>
        {/* ── Unconfirmed nudge — same card style as Crew nudge, at top of tab ── */}
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
                {unconfirmedCount} item{unconfirmedCount !== 1 ? "s" : ""} still need confirmation
              </p>
              <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                Confirm items to lock them into the schedule
              </p>
            </div>
          </div>
        )}

        {!embedded && (
          <h2
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Schedule
          </h2>
        )}

        {/* Guidance text — stage-aware */}
        <p
          className="mb-3 text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {stage === "planning"
            ? "Start adding items to your schedule — you can edit and reorganize at any time. All confirmed items will appear on the official schedule for the crew once the trip has been officially kicked off."
            : "Keep your schedule up to date — any confirmed items will be shown on the crew's official schedule."}
        </p>

        {/* Dates dependency notice — only shows when no dates are set (mutually
            exclusive with the unconfirmed nudge above). Not dot-driven — it's a
            prerequisite notice, not an action-required state. */}
        {!trip.start_date && (
          <div
            className="mb-4 flex items-center justify-between rounded-xl px-4 py-3"
            style={{
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
            }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ color: "var(--color-bt-warning)", flexShrink: 0 }}
              >
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 5v3.5M8 10.5v.5" />
              </svg>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-bt-warning)" }}>
                  Items are unscheduled
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  Set trip dates to assign items to specific days
                </p>
              </div>
            </div>

            {trip.planning_tier === "basic" ? (
              <button
                onClick={onNavigateToDates}
                className="ml-4 flex-shrink-0 text-xs font-semibold"
                style={{
                  color: "var(--color-bt-accent)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Set dates &rarr;
              </button>
            ) : (
              <>
                <button
                  onClick={() => setDatesModalOpen(true)}
                  className="ml-4 flex-shrink-0 text-xs font-semibold"
                  style={{
                    color: "var(--color-bt-accent)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
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

        {/* Type selector — add buttons */}
        {canEdit && (
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setAddMode("general")}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <ClipboardList size={15} />
              <Plus size={12} /> Item
            </button>
            <button
              onClick={() => setAddMode("golf")}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Flag size={15} />
              <Plus size={12} /> Golf
            </button>
          </div>
        )}

        {allItems.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-10 w-10" />}
            headline="No schedule items yet"
            subtext={canEdit ? "Add items to plan your trip's agenda." : "The organizer hasn't added any schedule items yet."}
          />
        ) : (
          <div className="space-y-5">
            {/* eslint-disable react-hooks/refs */}
            {dayGroups.map((group) => (
              <div
                key={group.date ?? "__unscheduled"}
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
                className="rounded-xl px-3 py-2 -mx-3 transition-colors"
                style={{
                  background: dragOverGroup === group.date
                    ? "var(--color-bt-accent-faint, rgba(13,148,136,0.06))"
                    : "transparent",
                  border: dragOverGroup === group.date
                    ? "1.5px dashed var(--color-bt-accent-border)"
                    : "1.5px dashed transparent",
                }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <CalendarDays
                    size={14}
                    style={{ color: dragOverGroup === group.date ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                  />
                  <p
                    className="text-[13px] font-semibold"
                    style={{ color: dragOverGroup === group.date ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}
                  >
                    {group.label}
                    {dragOverGroup === group.date && (
                      <span className="ml-2 text-[11px] font-normal" style={{ color: "var(--color-bt-accent)" }}>
                        Drop here
                      </span>
                    )}
                  </p>
                </div>

                {group.items.length === 0 ? (
                  <p
                    className="ml-6 text-xs italic"
                    style={{ color: dragOverGroup === group.date ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                  >
                    {dragOverGroup === group.date ? "Drop to schedule here" : "Nothing scheduled"}
                  </p>
                ) : (
                  <>
                    {group.items.map((item, idx) => (
                      <ScheduleItemRow
                        key={item.id}
                        item={item}
                        canEdit={canEdit}
                        onConfirmToggle={() => handleConfirmToggle(item)}
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
            ))}
            {/* eslint-enable react-hooks/refs */}
          </div>
        )}
      </section>

      {addMode === "general" && (
        <AddScheduleItemSheet tripId={tripId} itemType="general" onClose={() => setAddMode(null)} />
      )}
      {addMode === "golf" && (
        <AddScheduleItemSheet tripId={tripId} itemType="golf" onClose={() => setAddMode(null)} />
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
              Delete schedule item?
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              &ldquo;{confirmDelete.title}&rdquo; will be permanently removed from the schedule.
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
