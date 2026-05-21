"use client";

import { AlertTriangle, BedDouble, CalendarCheck, CalendarDays, MapPin, Send, Sparkles, Users, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { formatDateRange } from "@/lib/dates";
import { useModalBackButton } from "@/hooks/useModalBackButton";

export interface TripSummaryModalProps {
  tripId: string;
  trip: {
    title?: string | null;
    about_message?: string | null;
    /**
     * Real-world location of the destination, e.g. "Bandon, OR". This is what
     * crew actually need to know — not the cute idea name (which is just a
     * holdover from the idea-comparison stage and may not validate to anything
     * geographic). Always prefer this over locked_destination_title past the
     * idea phase; title is kept as a fallback for legacy data only.
     */
    locked_destination_location?: string | null;
    locked_destination_title?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    stage?: string | null;
  };
  onClose: () => void;
  onAdvanced: () => void;
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
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });
  const hasLockedDate = !!poll?.lockedWindowId;

  const advance = trpc.trips.advanceToGoing.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      onAdvanced();
      onClose();
    },
  });

  useModalBackButton(onClose);

  // Prefer the real location ("Bandon, OR") over the idea title ("Bandon Dunes"),
  // which is the cute holdover from the idea phase and doesn't help the crew
  // know where they're actually going.
  const destination = trip.locked_destination_location ?? trip.locked_destination_title ?? "";
  const hasDestination = destination.trim().length > 0;
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const crewCount = members.length;
  // In going stage the modal is a view-only recap — the advance CTA
  // doesn't apply anymore, and the "lock destination/date" warning is
  // irrelevant because both are definitionally true by the time we're
  // here (advanceToGoing enforces them).
  const alreadyGoing = trip.stage === "going";

  // Lodging — logistics_items with type='lodging', split by is_confirmed.
  const lodgingItems = logistics.filter((l) => (l as { type?: string }).type === "lodging");
  const lodgingConfirmed = lodgingItems.filter(
    (l) => (l as { is_confirmed?: boolean }).is_confirmed
  ).length;
  const lodgingUnconfirmed = lodgingItems.length - lodgingConfirmed;

  // Schedule — agenda items (schedule_items), split by is_confirmed.
  // Previously read from the legacy `reservations` table which is always
  // empty in production — the count silently showed 0/0 every time.
  const scheduleConfirmed = scheduleItems.filter(
    (s) => (s as { is_confirmed?: boolean }).is_confirmed
  ).length;
  const scheduleUnconfirmed = scheduleItems.length - scheduleConfirmed;

  const handleSend = () => {
    advance.mutate({ tripId });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      {/* Canonical modal structure (CC_MODAL_AUDIT.md Part 2.1) —
          header / body / footer split with the body taking the
          scrollable middle section. */}
      <div
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl lg:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
          maxHeight: "min(85dvh, 720px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center justify-between gap-2 px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles size={16} style={{ color: "var(--color-bt-accent)" }} />
            <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Trip Summary
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
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
          {!alreadyGoing && (!hasLockedDate || !hasDestination) && (
            <div
              className="mt-2 flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: "var(--color-bt-warning-faint)" }}
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
        </div>

        {/* Footer */}
        <div
          className="flex flex-shrink-0 items-center justify-end gap-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            {alreadyGoing ? "Close" : "Not yet"}
          </button>
          {!alreadyGoing && (
            <button
              onClick={handleSend}
              disabled={advance.isPending || !hasLockedDate}
              data-testid="trip-summary-send-btn"
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              <Send size={15} />
              {advance.isPending ? "Sending..." : "View Itinerary"}
            </button>
          )}
        </div>
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
