"use client";

import { useRef, useState } from "react";
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
      {/* Drag handle — desktop only */}
      {canEdit && (
        <GripVertical
          size={16}
          className="mt-0.5 hidden flex-shrink-0 cursor-grab lg:block"
          style={{ color: "var(--color-bt-text-dim)" }}
        />
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {item.title}
          </p>
        </div>
        {item.detail && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {item.detail}
          </p>
        )}
        {item.scheduled_date && (
          <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            <Calendar size={10} />
            {fmtDate(item.scheduled_date)}
            {item.scheduled_time && (
              <>
                <Clock size={10} className="ml-1" />
                {item.scheduled_time}
              </>
            )}
          </p>
        )}
      </div>

      {/* Right side controls */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {/* Confirm toggle */}
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
          <span
            className="text-[11px] font-medium"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Confirmed ✓
          </span>
        )}

        {/* Mobile reorder arrows */}
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

        {/* Delete */}
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

// ── Reservations section (kept from original) ───────────────────────────

function ReservationsSection({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId });

  const removeRes = trpc.reservations.remove.useMutation({
    onSuccess: () => utils.reservations.list.invalidate({ tripId }),
  });

  if (reservations.length === 0) return null;

  return (
    <section className="mt-6">
      <h2
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Reservations
      </h2>
      <div className="space-y-2">
        {(reservations as Reservation[]).map((res) => (
          <div
            key={res.id}
            data-testid={`reservation-${res.id}`}
            className="flex items-start gap-3 rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <span style={{ color: "var(--color-bt-accent)" }}>{RES_ICON[res.type]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                {res.title}
              </p>
              <div
                className="mt-1 flex flex-wrap gap-2 text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {res.date && (
                  <span className="flex items-center gap-1">
                    <Calendar size={10} />
                    {fmtDate(res.date)}
                  </span>
                )}
                {res.start_time && (
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {res.start_time}
                  </span>
                )}
                {res.confirmation_number && (
                  <span>#{res.confirmation_number}</span>
                )}
              </div>
              {res.notes && (
                <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  {res.notes}
                </p>
              )}
            </div>
            {canEdit && (
              <button
                onClick={() => removeRes.mutate({ tripId, reservationId: res.id })}
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── AddReservationModal (kept from original) ────────────────────────────

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
  const dragIdx = useRef<number | null>(null);

  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });

  const allItems = scheduleItems as ScheduleItem[];
  // Non-editors only see confirmed items
  const visibleItems = canEdit ? allItems : allItems.filter((i) => i.is_confirmed);
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

  const handleConfirmToggle = (item: ScheduleItem) => {
    if (item.is_confirmed) {
      // Unconfirm via update (set is_confirmed = false)
      // For now, confirm is one-way. Can be extended.
      return;
    }
    confirmItem.mutate({ tripId, itemId: item.id });
  };

  const handleMove = (fromIndex: number, direction: "up" | "down") => {
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= visibleItems.length) return;
    const newOrder = [...visibleItems];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    reorder.mutate({ tripId, itemIds: newOrder.map((i) => i.id) });
  };

  const handleDragDrop = (toIndex: number) => {
    if (dragIdx.current === null || dragIdx.current === toIndex) return;
    const newOrder = [...visibleItems];
    const [moved] = newOrder.splice(dragIdx.current, 1);
    newOrder.splice(toIndex, 0, moved);
    dragIdx.current = null;
    reorder.mutate({ tripId, itemIds: newOrder.map((i) => i.id) });
  };

  return (
    <div className="px-4">
      {/* Schedule section */}
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

        {/* READY stage unconfirmed banner */}
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

        {visibleItems.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-10 w-10" />}
            headline="No schedule items yet"
            subtext={canEdit ? "Add items to plan your trip's agenda." : "The organizer hasn't added any schedule items yet."}
          />
        ) : (
          visibleItems.map((item, idx) => (
            <ScheduleItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              onConfirmToggle={() => handleConfirmToggle(item)}
              onRemove={() => removeItem.mutate({ tripId, itemId: item.id })}
              onMoveUp={() => handleMove(idx, "up")}
              onMoveDown={() => handleMove(idx, "down")}
              isFirst={idx === 0}
              isLast={idx === visibleItems.length - 1}
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDragDrop(idx)}
            />
          ))
        )}
      </section>

      {/* Reservations — kept at the bottom */}
      <ReservationsSection tripId={tripId} canEdit={canEdit} />

      {/* Modals */}
      {showAddSchedule && (
        <AddScheduleItemSheet tripId={tripId} onClose={() => setShowAddSchedule(false)} />
      )}
      {showAddReservation && (
        <AddReservationModal tripId={tripId} onClose={() => setShowAddReservation(false)} />
      )}
    </div>
  );
}
