"use client";

import { useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarDays,
  Hotel,
  Clock,
  Utensils,
  Car,
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
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { AddScheduleItemSheet } from "../components/AddScheduleItemSheet";
import type { TabProps } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

type ReservationType = "accommodation" | "tee-time" | "restaurant" | "transport";

interface Reservation {
  id: string;
  type: ReservationType;
  title: string;
  date?: string | null;
  start_time?: string | null;
  confirmation_number?: string | null;
  notes?: string | null;
}

interface ScheduleItem {
  id: string;
  title: string;
  detail?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  is_confirmed: boolean;
  sort_order: number;
}

type UnifiedRow =
  | { source: "schedule"; data: ScheduleItem }
  | { source: "reservation"; data: Reservation };

interface DayGroup {
  date: string | null;
  label: string;
  items: UnifiedRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

const RES_ICON: Record<ReservationType, React.ReactNode> = {
  accommodation: <Hotel size={16} />,
  "tee-time": <Calendar size={16} />,
  restaurant: <Utensils size={16} />,
  transport: <Car size={16} />,
};

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

function rowDate(row: UnifiedRow): string | null {
  return row.source === "schedule"
    ? row.data.scheduled_date ?? null
    : row.data.date ?? null;
}

function rowTime(row: UnifiedRow): string | null {
  return row.source === "schedule"
    ? row.data.scheduled_time ?? null
    : row.data.start_time ?? null;
}

/** Generate YYYY-MM-DD strings for each day from start to end (inclusive). */
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

/** Compute "Day N" label from trip start date. */
function dayNumber(date: string, tripStart: string | null): number | null {
  if (!tripStart) return null;
  const s = parseLocalDate(tripStart).getTime();
  const d = parseLocalDate(date).getTime();
  return Math.floor((d - s) / 86400000) + 1;
}

// ── Unified row component ───────────────────────────────────────────────

function UnifiedItemRow({
  row,
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
  row: UnifiedRow;
  canEdit: boolean;
  onConfirmToggle?: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const isSchedule = row.source === "schedule";
  const isRes = row.source === "reservation";
  const isConfirmed = isSchedule ? row.data.is_confirmed : true;
  const time = rowTime(row);

  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? onDragStart : undefined}
      onDragOver={canEdit ? onDragOver : undefined}
      onDrop={canEdit ? onDrop : undefined}
      className="mb-2 flex items-start gap-2 rounded-xl px-4 py-3 transition-colors"
      style={{
        background: isConfirmed ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
        border: `1px solid ${isConfirmed ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
      }}
    >
      {canEdit && (
        <GripVertical
          size={16}
          className="mt-0.5 hidden flex-shrink-0 cursor-grab lg:block"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
      )}

      {isRes && (
        <span className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }}>
          {RES_ICON[row.data.type]}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {row.data.title}
        </p>
        {isSchedule && row.data.detail && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {row.data.detail}
          </p>
        )}
        {isRes && row.data.notes && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {row.data.notes}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {time && (
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {time}
            </span>
          )}
          {isRes && row.data.confirmation_number && (
            <span>#{row.data.confirmation_number}</span>
          )}
          {isRes && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              Reservation
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {isSchedule && canEdit && onConfirmToggle && (
          <button
            onClick={onConfirmToggle}
            className="rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: isConfirmed ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            {isConfirmed ? "Confirmed ✓" : "Confirm"}
          </button>
        )}
        {isSchedule && !canEdit && isConfirmed && (
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

// ── AddReservationModal ─────────────────────────────────────────────────

const RES_TYPES: { value: ReservationType; label: string }[] = [
  { value: "accommodation", label: "Accommodation" },
  { value: "tee-time", label: "Tee Time" },
  { value: "restaurant", label: "Restaurant" },
  { value: "transport", label: "Transport" },
];

function AddReservationModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const [type, setType] = useState<ReservationType>("accommodation");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");

  const create = trpc.reservations.create.useMutation({
    onSuccess: () => {
      utils.reservations.list.invalidate({ tripId });
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!title.trim() || !date) return;
    create.mutate({
      tripId,
      id: crypto.randomUUID(),
      type,
      title: title.trim(),
      date,
      startTime: startTime || undefined,
      confirmationNumber: confirmationNumber || undefined,
      notes: notes || undefined,
    });
  };

  const inputStyle = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add Reservation
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {RES_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setType(value)}
              className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: type === value ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: type === value ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                border: type === value ? "none" : "1px solid var(--color-bt-border)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Name" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={inputStyle} />
        <div className="mt-2 flex gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-32 rounded-xl border px-3 py-2.5 text-sm outline-none" style={inputStyle} />
        </div>
        <input type="text" placeholder="Confirmation # (optional)" value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={inputStyle} />
        <textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-2 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none" style={inputStyle} />
        <button onClick={handleSubmit} disabled={create.isPending || !title.trim() || !date} className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40" style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}>
          {create.isPending ? "Adding..." : "Add Reservation"}
        </button>
        <button onClick={onClose} className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80" style={{ color: "var(--color-bt-text-dim)" }}>Cancel</button>
      </div>
    </div>
  );
}

// ── ScheduleTab ─────────────────────────────────────────────────────────

export function ScheduleTab({ trip, canEdit }: TabProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [showAddReservation, setShowAddReservation] = useState(false);
  const dragState = useRef<{ groupDate: string | null; idx: number; row: UnifiedRow } | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null | false>(false); // false = no drag

  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId });

  const allSchedule = scheduleItems as ScheduleItem[];
  const allReservations = reservations as Reservation[];

  // Build day groups: trip days (if dates are set) + any extra dates from items
  const dayGroups = useMemo<DayGroup[]>(() => {
    // Collect all unified rows
    const schedRows: UnifiedRow[] = allSchedule.map((s) => ({
      source: "schedule" as const,
      data: s,
    }));
    const resRows: UnifiedRow[] = allReservations.map((r) => ({
      source: "reservation" as const,
      data: r,
    }));
    const allRows = [...schedRows, ...resRows];

    // Generate trip day slots
    const tripDays =
      trip.start_date && trip.end_date
        ? generateTripDays(trip.start_date, trip.end_date)
        : [];

    // Collect all dates present in items (including those outside trip range)
    const itemDates = new Set<string>();
    for (const row of allRows) {
      const d = rowDate(row);
      if (d) itemDates.add(d);
    }

    // Merge trip days + extra item dates, deduplicated and sorted
    const allDates = new Set([...tripDays, ...itemDates]);
    const sortedDates = Array.from(allDates).sort();

    // Group items by date
    const dateMap = new Map<string | null, UnifiedRow[]>();
    for (const row of allRows) {
      const d = rowDate(row);
      const key = d ?? null;
      const arr = dateMap.get(key) ?? [];
      arr.push(row);
      dateMap.set(key, arr);
    }

    // Sort items within each day: schedule items by sort_order, reservations by time
    const sortWithinDay = (items: UnifiedRow[]) =>
      items.slice().sort((a, b) => {
        if (a.source === "schedule" && b.source === "schedule")
          return a.data.sort_order - b.data.sort_order;
        if (a.source === "schedule" && b.source === "reservation") return -1;
        if (a.source === "reservation" && b.source === "schedule") return 1;
        const aTime = (a.data as Reservation).start_time ?? "";
        const bTime = (b.data as Reservation).start_time ?? "";
        return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
      });

    const groups: DayGroup[] = [];

    for (const date of sortedDates) {
      const dayNum = dayNumber(date, trip.start_date ?? null);
      const items = sortWithinDay(dateMap.get(date) ?? []);
      groups.push({
        date,
        label: dayNum ? `Day ${dayNum} — ${fmtDayHeader(date)}` : fmtDayHeader(date),
        items,
      });
      dateMap.delete(date);
    }

    // Empty trip days (no items) still show as sections
    // (already included above since tripDays are in sortedDates)

    // Unscheduled items (null date) — at the TOP so they're visible
    const unscheduled = dateMap.get(null);
    if (unscheduled && unscheduled.length > 0) {
      groups.unshift({
        date: null,
        label: "Unscheduled",
        items: sortWithinDay(unscheduled),
      });
    }

    return groups;
  }, [allSchedule, allReservations, trip.start_date, trip.end_date]);

  // Filter for non-editors: only confirmed schedule items + all reservations
  const visibleGroups = useMemo<DayGroup[]>(() => {
    if (canEdit) return dayGroups;
    return dayGroups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (row) => row.source === "reservation" || (row.data as ScheduleItem).is_confirmed
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [dayGroups, canEdit]);

  const unconfirmedCount = allSchedule.filter((i) => !i.is_confirmed).length;
  const totalItems = allSchedule.length + allReservations.length;

  const confirmItem = trpc.schedule.confirm.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const removeScheduleItem = trpc.schedule.remove.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const removeReservation = trpc.reservations.remove.useMutation({
    onSuccess: () => utils.reservations.list.invalidate({ tripId }),
  });

  const reorder = trpc.schedule.reorder.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const updateScheduleItem = trpc.schedule.update.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ tripId }),
  });

  const updateReservation = trpc.reservations.update.useMutation({
    onSuccess: () => utils.reservations.list.invalidate({ tripId }),
  });

  const handleConfirmToggle = (item: ScheduleItem) => {
    if (item.is_confirmed) return;
    confirmItem.mutate({ tripId, itemId: item.id });
  };

  const handleRemove = (row: UnifiedRow) => {
    if (row.source === "schedule") {
      removeScheduleItem.mutate({ tripId, itemId: row.data.id });
    } else {
      removeReservation.mutate({ tripId, reservationId: row.data.id });
    }
  };

  // Reorder within a day group — rebuilds global schedule item order
  const reorderInGroup = (groupDate: string | null, newGroupItems: UnifiedRow[]) => {
    // Replace the items in the target group, keep all other groups intact
    const newAllItems: UnifiedRow[] = [];
    for (const g of dayGroups) {
      if (g.date === groupDate) {
        newAllItems.push(...newGroupItems);
      } else {
        newAllItems.push(...g.items);
      }
    }
    // Extract schedule IDs in new global order
    const schedIds = newAllItems
      .filter((r) => r.source === "schedule")
      .map((r) => r.data.id);
    if (schedIds.length > 0) {
      reorder.mutate({ tripId, itemIds: schedIds });
    }
  };

  const handleMove = (groupDate: string | null, items: UnifiedRow[], fromIdx: number, dir: "up" | "down") => {
    const toIdx = dir === "up" ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= items.length) return;
    const newItems = [...items];
    const [moved] = newItems.splice(fromIdx, 1);
    newItems.splice(toIdx, 0, moved);
    reorderInGroup(groupDate, newItems);
  };

  const handleDragDrop = (targetGroupDate: string | null, targetItems: UnifiedRow[], toIdx: number) => {
    if (!dragState.current) return;
    const { groupDate: sourceDate, idx: fromIdx, row: draggedRow } = dragState.current;
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

    // Cross-group — update the item's date, then reorder
    if (draggedRow.source === "schedule") {
      updateScheduleItem.mutate({
        tripId,
        itemId: draggedRow.data.id,
        scheduledDate: targetGroupDate,
      });
    } else {
      updateReservation.mutate({
        tripId,
        reservationId: draggedRow.data.id,
        date: targetGroupDate ?? undefined,
      });
    }
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
          <div className="flex gap-2">
            {canEdit && (
              <>
                <button
                  onClick={() => setShowAddSchedule(true)}
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
                <button
                  onClick={() => setShowAddReservation(true)}
                  className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                  style={{
                    border: "1.5px dashed var(--color-bt-accent)",
                    color: "var(--color-bt-accent)",
                    background: "transparent",
                  }}
                >
                  <Plus size={14} />
                  Reservation
                </button>
              </>
            )}
          </div>
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

        {totalItems === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-10 w-10" />}
            headline="No schedule items yet"
            subtext={canEdit ? "Add items to plan your trip's agenda." : "The organizer hasn't added any schedule items yet."}
          />
        ) : (
          <div className="space-y-5">
            {visibleGroups.map((group) => (
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
                  // Only clear if leaving the container entirely (not entering a child)
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
                {/* Day header */}
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
                  group.items.map((row, idx) => (
                    <UnifiedItemRow
                      key={`${row.source}-${row.data.id}`}
                      row={row}
                      canEdit={canEdit}
                      onConfirmToggle={
                        row.source === "schedule"
                          ? () => handleConfirmToggle(row.data as ScheduleItem)
                          : undefined
                      }
                      onRemove={() => handleRemove(row)}
                      onMoveUp={() => handleMove(group.date, group.items, idx, "up")}
                      onMoveDown={() => handleMove(group.date, group.items, idx, "down")}
                      isFirst={idx === 0}
                      isLast={idx === group.items.length - 1}
                      onDragStart={() => { dragState.current = { groupDate: group.date, idx, row }; }}
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

      {showAddSchedule && (
        <AddScheduleItemSheet tripId={tripId} onClose={() => setShowAddSchedule(false)} />
      )}
      {showAddReservation && (
        <AddReservationModal tripId={tripId} onClose={() => setShowAddReservation(false)} />
      )}
    </div>
  );
}
