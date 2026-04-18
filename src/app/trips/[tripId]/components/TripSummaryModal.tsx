"use client";

import { AlertTriangle, BedDouble, CalendarCheck, CalendarDays, MapPin, Send, Sparkles, Users } from "lucide-react";
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
 * TripSummaryModal — "where you are, what's up next" glimpse shown before
 * the owner advances the trip from planning → going. Two panels:
 *
 *   1. Basics (destination · dates · crew) — the bits that gate the
 *      transition. Unset destination or unlocked dates show warning
 *      styling to tie back to the warning callout below.
 *   2. Lodging + Schedule — broken out separately because they're
 *      optional context, not a gate.
 *
 * Crafting any invitation message happens elsewhere; this modal is
 * read-only recap + confirmation.
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
  const hasDestination = destination.trim().length > 0;
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const crewCount = members.length;

  // Lodging — logistics_items with type='lodging', split by is_confirmed.
  const lodgingItems = logistics.filter((l) => (l as { type?: string }).type === "lodging");
  const lodgingConfirmed = lodgingItems.filter(
    (l) => (l as { is_confirmed?: boolean }).is_confirmed
  ).length;
  const lodgingUnconfirmed = lodgingItems.length - lodgingConfirmed;

  // Schedule — reservations. "Confirmed" = has a confirmation_number.
  const scheduleConfirmed = reservations.filter(
    (r) => ((r as { confirmation_number?: string }).confirmation_number ?? "").trim().length > 0
  ).length;
  const scheduleUnconfirmed = reservations.length - scheduleConfirmed;

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
          Here&apos;s where things stand. When you&apos;re ready, we&apos;ll open up the
          next set of planning features — no rush if your dates aren&apos;t locked
          in yet, and nothing you&apos;ve already set up goes away.
        </p>

        {/* ── Basics panel — destination, dates, crew ─────────────────── */}
        <div
          className="space-y-2 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
        >
          <SummaryRow
            icon={<MapPin size={14} />}
            label="Destination"
            value={hasDestination ? destination : "Not set yet"}
            needsAttention={!hasDestination}
          />
          <SummaryRow
            icon={<CalendarDays size={14} />}
            label="Dates"
            value={hasLockedDate && dateRange ? dateRange : "Not locked yet"}
            needsAttention={!hasLockedDate}
          />
          <SummaryRow
            icon={<Users size={14} />}
            label="Crew"
            value={`${crewCount} ${crewCount === 1 ? "person" : "people"}`}
          />
        </div>

        {/* ── Warning — wired back to the rows that need attention ────── */}
        {(!hasLockedDate || !hasDestination) && (
          <div
            className="mt-2 flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: "var(--color-bt-warning-bg, rgba(217,119,6,0.1))" }}
          >
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-warning)" }} />
            <p className="text-sm" style={{ color: "var(--color-bt-warning)" }}>
              {!hasLockedDate && !hasDestination
                ? "Lock a destination and a date first — your crew will want to know where and when."
                : !hasLockedDate
                  ? "Lock a date first — your crew will want to know when."
                  : "Lock a destination first — your crew will want to know where."}
            </p>
          </div>
        )}

        {/* ── Soft nudge + Pro Tip ─────────────────────────────────────── */}
        <p className="mt-4 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          Lodging and schedule don&apos;t have to be firm to continue — this is just
          your starting point as the trip gets closer.
        </p>
        <p className="mt-2 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          <span className="block font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Pro Tip:
          </span>
          Designate anyone in the crew to help plan and they can lock in any of
          these items.
        </p>

        {/* ── Lodging + Schedule panel ─────────────────────────────────── */}
        <div
          className="mt-3 space-y-2 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
        >
          <CountRow
            icon={<BedDouble size={14} />}
            label="Lodging"
            confirmed={lodgingConfirmed}
            unconfirmed={lodgingUnconfirmed}
          />
          <CountRow
            icon={<CalendarCheck size={14} />}
            label="Schedule"
            confirmed={scheduleConfirmed}
            unconfirmed={scheduleUnconfirmed}
          />
        </div>

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
  needsAttention = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  needsAttention?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
        style={{
          background: needsAttention
            ? "var(--color-bt-warning-bg, rgba(217,119,6,0.15))"
            : "var(--color-bt-card)",
          color: needsAttention ? "var(--color-bt-warning)" : "var(--color-bt-accent)",
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
      <span
        className="flex flex-1 items-center gap-1.5 truncate"
        style={{ color: needsAttention ? "var(--color-bt-warning)" : "var(--color-bt-text)" }}
      >
        {needsAttention && <AlertTriangle size={12} className="flex-shrink-0" />}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

function CountRow({
  icon,
  label,
  confirmed,
  unconfirmed,
}: {
  icon: React.ReactNode;
  label: string;
  confirmed: number;
  unconfirmed: number;
}) {
  const total = confirmed + unconfirmed;

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
      <span className="flex flex-1 flex-wrap items-center gap-1.5">
        {total === 0 ? (
          <span style={{ color: "var(--color-bt-text-dim)" }}>Nothing added yet</span>
        ) : (
          <>
            <CountChip count={confirmed} label="confirmed" tone="confirmed" />
            <CountChip count={unconfirmed} label="unconfirmed" tone="unconfirmed" />
          </>
        )}
      </span>
    </div>
  );
}

function CountChip({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: "confirmed" | "unconfirmed";
}) {
  if (count === 0) {
    return (
      <span
        className="text-[12px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        0 {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium"
      style={
        tone === "confirmed"
          ? {
              background: "var(--color-bt-tag-bg)",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-accent-border)",
            }
          : {
              background: "var(--color-bt-card)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {count} {label}
    </span>
  );
}
