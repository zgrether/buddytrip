"use client";

import { BedDouble, CalendarCheck, CalendarDays, MapPin, Send, Sparkles, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { formatDateRange } from "@/lib/dates";
import { useModalBackButton } from "@/hooks/useModalBackButton";

export interface TripSummaryModalProps {
  tripId: string;
  trip: {
    title?: string | null;
    about_message?: string | null;
    locked_destination_title?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  onClose: () => void;
  onAdvanced: (ghostsWithoutEmail: string[]) => void;
}

/**
 * TripSummaryModal — "where you are, and what's up next" glimpse shown
 * before the owner advances the trip from planning → going. Renders a
 * read-only recap (destination, dates, crew, lodging, schedule) plus a
 * soft nudge that partial info is fine for RSVPs but the crew may want
 * more detail later. Actual planning — including any invitation message
 * — happens elsewhere; this modal is just the confirmation.
 *
 * If no date is locked, a warning sits below the summary and the send
 * button stays disabled.
 */
export function TripSummaryModal({ tripId, trip, onClose, onAdvanced }: TripSummaryModalProps) {
  const utils = trpc.useUtils();

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: logistics = [] } = trpc.logistics.list.useQuery({ tripId });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId });
  const hasLockedDate = !!poll?.lockedWindowId;

  const advance = trpc.trips.advanceToGoing.useMutation({
    onSuccess(result) {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      onAdvanced(result.ghostsWithoutEmail ?? []);
      onClose();
    },
  });

  useModalBackButton(onClose);

  const destination = trip.locked_destination_title ?? "";
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const crewCount = members.length;

  const lodgingItems = logistics.filter((l) => (l as { type?: string }).type === "lodging");
  const lodgingConfirmed = lodgingItems.filter((l) => (l as { is_confirmed?: boolean }).is_confirmed).length;
  const lodgingCount = lodgingItems.length;

  const scheduleCount = reservations.length;

  const handleSend = () => {
    advance.mutate({ tripId });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-t-2xl p-6 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={16} style={{ color: "var(--color-bt-accent)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Trip Summary
          </h2>
        </div>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Here&apos;s where things stand. When you&apos;re ready, send it to kick off RSVPs.
        </p>

        {/* ── Summary panel ────────────────────────────────────────────── */}
        <div
          className="space-y-2 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
        >
          <SummaryRow
            icon={<MapPin size={14} />}
            label="Destination"
            value={destination || "—"}
          />
          <SummaryRow
            icon={<CalendarDays size={14} />}
            label="Dates"
            value={dateRange || "Not locked yet"}
          />
          <SummaryRow
            icon={<Users size={14} />}
            label="Crew"
            value={`${crewCount} ${crewCount === 1 ? "person" : "people"}`}
          />
          <SummaryRow
            icon={<BedDouble size={14} />}
            label="Lodging"
            value={
              lodgingCount === 0
                ? "Nothing added yet"
                : `${lodgingConfirmed} confirmed · ${lodgingCount} total`
            }
          />
          <SummaryRow
            icon={<CalendarCheck size={14} />}
            label="Schedule"
            value={
              scheduleCount === 0
                ? "Nothing scheduled yet"
                : `${scheduleCount} ${scheduleCount === 1 ? "item" : "items"}`
            }
          />
        </div>

        {/* ── Warning — only when a date isn't locked yet ─────────────── */}
        {!hasLockedDate && (
          <div
            className="mt-3 flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: "var(--color-bt-warning-bg, rgba(217,119,6,0.1))" }}
          >
            <span style={{ color: "var(--color-bt-warning)" }}>⚠</span>
            <p className="text-sm" style={{ color: "var(--color-bt-warning)" }}>
              Lock a date first — your crew will want to know when.
            </p>
          </div>
        )}

        {/* ── Soft "partial info is okay" nudge ────────────────────────── */}
        <p className="mt-3 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          Lodging and schedule don&apos;t have to be locked in to send this — RSVPs
          just need a when and where. Your crew will probably start asking about
          those soon, though, so plan to fill them in as they firm up.
        </p>

        <button
          onClick={handleSend}
          disabled={advance.isPending || !hasLockedDate}
          data-testid="trip-summary-send-btn"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          <Send size={15} />
          {advance.isPending ? "Sending..." : "Let's Go! 🎉"}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Not yet
        </button>
      </div>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
        style={{
          background: "var(--color-bt-card)",
          color: "var(--color-bt-accent)",
        }}
      >
        {icon}
      </span>
      <span
        className="w-20 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {label}
      </span>
      <span className="flex-1 truncate" style={{ color: "var(--color-bt-text)" }}>
        {value}
      </span>
    </div>
  );
}
