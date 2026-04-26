"use client";

import { X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DatePickerPanel } from "./DatePickerPanel";
import type { TripData } from "../types";

// ── Types ────────────────────────────────────────────────────────────────

interface DatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  initialStartDate: string | null;
  initialEndDate: string | null;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * DatesModal — advanced mode date-setting modal.
 *
 * Wraps DatePickerPanel in a centred overlay. Advanced mode is pick-dates-only;
 * there is no poll option here. Saving calls the shared lockDates mutation and
 * closes on success.
 */
export function DatesModal({
  isOpen,
  onClose,
  tripId,
  initialStartDate,
  initialEndDate,
}: DatesModalProps) {
  const utils = trpc.useUtils();

  const lockDates = trpc.trips.lockDates.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old
          ? { ...old, start_date: vars.startDate, end_date: vars.endDate }
          : old
      );
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSuccess() {
      onClose();
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const handleSave = (startDate: string, endDate: string) => {
    lockDates.mutate({ tripId, startDate, endDate });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <div>
            <p className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              Set Trip Dates
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Pick your dates to unlock the full schedule
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "none",
              cursor: "pointer",
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pb-5">
          <DatePickerPanel
            tripId={tripId}
            initialStartDate={initialStartDate}
            initialEndDate={initialEndDate}
            onSave={handleSave}
            isSaving={lockDates.isPending}
            onCancel={onClose}
            showDescription={false}
          />
        </div>
      </div>
    </div>
  );
}
