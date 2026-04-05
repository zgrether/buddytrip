"use client";

import { useState } from "react";
import {
  Calendar,
  CalendarDays,
  Hotel,
  Clock,
  Utensils,
  Car,
  Plus,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate } from "@/lib/dates";
import { useModalBackButton } from "@/hooks/useModalBackButton";
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

// ── Helpers ──────────────────────────────────────────────────────────────

const RES_ICON: Record<ReservationType, React.ReactNode> = {
  accommodation: <Hotel size={16} />,
  "tee-time": <Calendar size={16} />,
  restaurant: <Utensils size={16} />,
  transport: <Car size={16} />,
};

const RES_TYPES: { value: ReservationType; label: string }[] = [
  { value: "accommodation", label: "Accommodation" },
  { value: "tee-time", label: "Tee Time" },
  { value: "restaurant", label: "Restaurant" },
  { value: "transport", label: "Transport" },
];

function fmtDate(d: string) {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ── AddReservationModal ─────────────────────────────────────────────────

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

        {/* Type selector */}
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

        {/* Title */}
        <input
          type="text"
          placeholder="Name (e.g. Hilton Downtown)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Date + time row */}
        <div className="mt-2 flex gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
          />
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-32 rounded-xl border px-3 py-2.5 text-sm outline-none"
            style={inputStyle}
            placeholder="Time"
          />
        </div>

        {/* Confirmation # */}
        <input
          type="text"
          placeholder="Confirmation # (optional)"
          value={confirmationNumber}
          onChange={(e) => setConfirmationNumber(e.target.value)}
          className="mt-2 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Notes */}
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-2 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />

        {/* Actions */}
        <button
          onClick={handleSubmit}
          disabled={create.isPending || !title.trim() || !date}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {create.isPending ? "Adding..." : "Add Reservation"}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Reservations section ─────────────────────────────────────────────────

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

  if (reservations.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-10 w-10" />}
        headline="No reservations yet"
        subtext="Tee times, hotels, and more will appear here."
      />
    );
  }

  return (
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
              onClick={() =>
                removeRes.mutate({ tripId, reservationId: res.id })
              }
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── ScheduleTab ─────────────────────────────────────────────────────────

export function ScheduleTab({ trip, canEdit }: TabProps) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="px-4">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Reservations
          </h2>
          {canEdit && (
            <button
              data-testid="add-reservation-btn"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
              style={{
                border: "1.5px dashed var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
              }}
            >
              <Plus size={14} />
              Add
            </button>
          )}
        </div>
        <ReservationsSection tripId={trip.id} canEdit={canEdit} />
      </section>

      {showAdd && (
        <AddReservationModal tripId={trip.id} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
