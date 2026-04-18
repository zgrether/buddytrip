"use client";

import { useState } from "react";
import { CalendarDays, MapPin, Send, Sparkles, Users } from "lucide-react";
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
 * TripSummaryModal — lightweight "you're ready to send it" confirmation that
 * replaces WriteInvitationModal. Shows a short recap of what the owner has
 * locked in (destination, dates, crew size), then offers an optional note
 * plus the "Let's go! 🎉" confirmation button.
 *
 * The owner can send with or without a message — `advanceToGoing` now treats
 * aboutMessage as optional. If the date isn't locked yet, we show an inline
 * warning and disable the send button.
 */
export function TripSummaryModal({ tripId, trip, onClose, onAdvanced }: TripSummaryModalProps) {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState(trip.about_message ?? "");

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
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

  const handleSend = () => {
    const trimmed = message.trim();
    advance.mutate({
      tripId,
      ...(trimmed ? { aboutMessage: trimmed } : {}),
    });
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
            Ready to make it official?
          </h2>
        </div>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Here&apos;s the plan you&apos;ve lined up. Send it to kick off RSVPs.
        </p>

        {/* ── Summary rows ─────────────────────────────────────────────── */}
        <div
          className="mb-4 space-y-2 rounded-xl px-4 py-3 text-[13px]"
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
        </div>

        {/* ── Optional message ─────────────────────────────────────────── */}
        <label
          className="mb-1 block text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          A note for the crew <span style={{ textTransform: "none" }}>(optional)</span>
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Hey crew, here's the plan..."
          rows={3}
          className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          This goes out by email to your crew alongside the RSVP.
        </p>

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
