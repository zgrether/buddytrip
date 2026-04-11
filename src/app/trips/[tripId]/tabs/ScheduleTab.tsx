"use client";

import { useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarDays,
  Clock,
  Plus,
  X,
  GripVertical,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate } from "@/lib/dates";
import { AddScheduleItemSheet } from "../components/AddScheduleItemSheet";
import type { TabProps } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

interface ScheduleItem {
  id: string;
  title: string;
  detail?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  is_confirmed: boolean;
  sort_order: number;
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
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  item: ScheduleItem;
  canEdit: boolean;
  onConfirmToggle: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? onDragStart : undefined}
      onDragOver={canEdit ? onDragOver : undefined}
      onDrop={canEdit ? onDrop : undefined}
      className="mb-2 flex items-start gap-2 rounded-xl px-4 py-3 transition-colors"
      style={{
        background: item.is_confirmed ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
        border: `1px solid ${item.is_confirmed ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
      }}
    >
      {canEdit && (
        <GripVertical
          size={16}
          className="mt-0.5 hidden flex-shrink-0 cursor-grab lg:block"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
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
        {item.scheduled_time && (
          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <Clock size={10} />
            {item.scheduled_time}
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {canEdit && (
          <button
            onClick={onConfirmToggle}
            className="rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: item.is_confirmed ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            {item.is_confirmed ? "Confirmed ✓" : "Confirm"}
          </button>
        )}
        {!canEdit && item.is_confirmed && (
          <span className="text-[11px] font-medium" style={{ color: "var(--color-bt-accent)" }}>
            Confirmed ✓
          </span>
        )}

        {canEdit && (
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
  );
}

// ── ScheduleTab ─────────────────────────────────────────────────────────

export function ScheduleTab({ trip, canEdit }: TabProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const dragState = useRef<{ groupDate: string | null; idx: number; item: ScheduleItem } | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null | false>(false);

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
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const removeItem = trpc.schedule.remove.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const reorder = trpc.schedule.reorder.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
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

  const handleConfirmToggle = (item: ScheduleItem) => {
    if (item.is_confirmed) return;
    confirmItem.mutate({ tripId, itemId: item.id });
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

    // Same group — simple reorder
    if (sourceDate === targetGroupDate) {
      if (fromIdx === toIdx) return;
      const newItems = [...targetItems];
      const [moved] = newItems.splice(fromIdx, 1);
      newItems.splice(toIdx, 0, moved);
      reorderInGroup(targetGroupDate, newItems);
      return;
    }

    // Cross-group — update the item's date
    updateItem.mutate({
      tripId,
      itemId: draggedItem.id,
      scheduledDate: targetGroupDate,
    });
  };

  return (
    <div className="px-4">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Schedule
          </h2>
          {canEdit && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                border: "1.5px dashed var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
              }}
            >
              <Plus size={14} />
              Add item
            </button>
          )}
        </div>

        {/* Unconfirmed banner */}
        {canEdit && unconfirmedCount > 0 && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5"
            style={{
              background: "var(--color-bt-warning-faint)",
              color: "var(--color-bt-warning)",
            }}
          >
            <AlertTriangle size={14} />
            <span className="text-[13px] font-medium">
              {unconfirmedCount} item{unconfirmedCount !== 1 ? "s" : ""} still need confirmation
            </span>
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
                  }
                } : undefined}
                onDrop={canEdit ? () => {
                  setDragOverGroup(false);
                  if (dragState.current && dragState.current.groupDate !== group.date) {
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
                  group.items.map((item, idx) => (
                    <ScheduleItemRow
                      key={item.id}
                      item={item}
                      canEdit={canEdit}
                      onConfirmToggle={() => handleConfirmToggle(item)}
                      onRemove={() => removeItem.mutate({ tripId, itemId: item.id })}
                      onMoveUp={() => handleMove(group.date, group.items, idx, "up")}
                      onMoveDown={() => handleMove(group.date, group.items, idx, "down")}
                      isFirst={idx === 0}
                      isLast={idx === group.items.length - 1}
                      onDragStart={() => { dragState.current = { groupDate: group.date, idx, item }; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDragDrop(group.date, group.items, idx)}
                    />
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {showAdd && (
        <AddScheduleItemSheet tripId={tripId} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
