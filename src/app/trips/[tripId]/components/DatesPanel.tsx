"use client";

import { useMemo, useState } from "react";
import { Calendar, CalendarCheck, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate, formatDateRangeCompact } from "@/lib/dates";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { DatePollCard } from "../tabs/components/DatePollCard";
import { DatePickerPanel } from "../tabs/components/DatePickerPanel";
import { ConfirmDatesModal } from "./ConfirmDatesModal";
import type { TripData } from "../tabs/types";

// ── Types ────────────────────────────────────────────────────────────────

interface DatesPanelProps {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onTabChange?: (tab: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nightsBetween(start: string, end: string): number {
  return Math.max(
    1,
    Math.round(
      (parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / 86400000
    )
  );
}

function formatLongDate(d: string): string {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * DatesPanel — owner-only admin surface for trip dates.
 *
 * Two modes (owner, !datesLocked):
 *   1. set:   segmented control on "Pick your Dates" — renders DatePickerPanel
 *   2. poll:  segmented control on "Poll the Crew" — DatePollCard below
 *
 * Clicking "Set dates" in DatePickerPanel opens ConfirmDatesModal, which
 * handles the poll-clear/preserve logic before committing. DatesPanel is
 * owner-only; non-owners see DatePollCard directly from ActionCenter.
 */
export function DatesPanel({
  trip,
  canEdit: _canEdit,
  isOwner,
  isOpen: _isOpen,
  onToggle: _onToggle,
  onTabChange,
}: DatesPanelProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;

  // Fetch poll data whenever a poll might be active so we can check for
  // window matches in the ConfirmDatesModal. tRPC dedupes this against
  // DatePollCard's identical query, so no extra network cost.
  const { data: poll } = trpc.datePoll.get.useQuery(
    { tripId },
    { enabled: isOwner && !datesLocked }
  );
  const pollWindows = (poll?.windows ?? []) as Array<{
    id: string;
    start_date: string;
    end_date: string;
  }>;

  // Local UI state — initialized from server pollMode so the correct tab is
  // shown on mount. The server-derived ACTIVE badge and empty-state grid handle
  // any external state changes (e.g. poll cancelled from another session)
  // without needing a synchronization effect.
  const [mode, setMode] = useState<"set" | "poll">(pollMode ? "poll" : "set");
  const [showDatesModal, setShowDatesModal] = useState(false);
  // Pending dates are captured from DatePickerPanel's onSave callback and
  // forwarded to ConfirmDatesModal (which handles poll-clear/preserve logic).
  const [pendingStart, setPendingStart] = useState("");
  const [pendingEnd, setPendingEnd] = useState("");

  // ── Mutations ──────────────────────────────────────────────────────────

  const lockDates = trpc.trips.lockDates.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old
          ? {
              ...old,
              start_date: vars.startDate,
              end_date: vars.endDate,
              poll_mode: false,
            }
          : old
      );
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSuccess() {
      setPendingStart("");
      setPendingEnd("");
      setShowDatesModal(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const setPollActive = trpc.datePoll.setPollMode.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, poll_mode: vars.pollMode } : old
      );
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── Derived header state ───────────────────────────────────────────────

  const state: ArcCardState = datesLocked
    ? "done"
    : pollMode
    ? "inProgress"
    : "none";

  const headerLabel = datesLocked ? "Dates Selected" : "Dates";

  const headerNote = useMemo(() => {
    if (datesLocked) return formatDateRangeCompact(trip.start_date, trip.end_date);
    return "TBD";
  }, [datesLocked, trip.start_date, trip.end_date]);

  // ── Actions ────────────────────────────────────────────────────────────

  /**
   * Called by ConfirmDatesModal. preservePoll=true means the user chose to keep
   * existing poll windows (only possible when the dates match a poll window).
   */
  const handleConfirmDates = (preservePoll: boolean) => {
    if (!pendingStart || !pendingEnd || pendingStart >= pendingEnd) return;
    // Clear windows unless the user explicitly chose to preserve them
    if (pollMode && !preservePoll) {
      setPollActive.mutate({ tripId, pollMode: false });
    }
    lockDates.mutate({ tripId, startDate: pendingStart, endDate: pendingEnd });
  };

  /** Called by DatePickerPanel when the user clicks "Set dates" with valid inputs. */
  const handleDatePickerSave = (start: string, end: string) => {
    setPendingStart(start);
    setPendingEnd(end);
    setShowDatesModal(true);
  };

  const handleSelectPollSegment = () => {
    const savedY = window.scrollY;
    setMode("poll");
    requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: "instant" }));
    // Poll only activates server-side when the first date window is added
    // (handled inside DatePollCard). Nothing to mutate here.
  };

  const handleSelectSetSegment = () => {
    const savedY = window.scrollY;
    setMode("set");
    requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: "instant" }));
  };

  // ── Render ─────────────────────────────────────────────────────────────

  // Non-owner: DatesPanel doesn't render for them. ActionCenter surfaces
  // the DatePollCard directly for non-owners.
  if (!isOwner) return null;

  // Locked: read-only range display.
  if (datesLocked) {
    return (
      <PlanningRow
        icon={<Calendar size={16} />}
        label={headerLabel}
        note={headerNote}
        state={state}
        isOpen={true}
        onToggle={() => {}}
        noExpand={true}
      >
        <div className="space-y-2">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {formatLongDate(trip.start_date!)} &ndash; {formatLongDate(trip.end_date!)}
          </p>
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {nightsBetween(trip.start_date!, trip.end_date!)} night
            {nightsBetween(trip.start_date!, trip.end_date!) !== 1 ? "s" : ""}
          </p>
        </div>
      </PlanningRow>
    );
  }

  // Owner, not-locked — segmented control state machine.
  //
  // No inner "Dates / TBD" header row here: placement inside the Action
  // Center already says "this needs your attention" — a second heading
  // before the segmented control is pure noise.
  const outerBorder = pollMode
    ? "var(--color-bt-accent-border)"
    : "var(--color-bt-border)";

  return (
    <>
      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--color-bt-card)",
          border: `1px solid ${outerBorder}`,
          boxShadow: "var(--shadow-raised)",
        }}
      >
        <div className="space-y-3">
          {/* ── Segmented control: Pick your Dates | Poll the Crew ─────── */}
          <div
            className="flex overflow-hidden rounded-xl"
            style={{ border: "1px solid var(--color-bt-border)" }}
          >
            <button
              type="button"
              onClick={handleSelectSetSegment}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors"
              style={
                mode === "set"
                  ? {
                      background: "var(--color-bt-card-float)",
                      color: "var(--color-bt-text)",
                    }
                  : {
                      background: "transparent",
                      color: "var(--color-bt-text-dim)",
                    }
              }
            >
              <CalendarCheck size={16} />
              Pick your Dates
            </button>
            <div
              className="w-px self-stretch"
              style={{ background: "var(--color-bt-border)" }}
            />
            <button
              type="button"
              onClick={handleSelectPollSegment}
              disabled={setPollActive.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors"
              style={
                mode === "poll"
                  ? {
                      background: "var(--color-bt-card-float)",
                      color: "var(--color-bt-text)",
                    }
                  : {
                      background: "transparent",
                      color: "var(--color-bt-text-dim)",
                    }
              }
            >
              <Users size={16} />
              Poll the Crew
              {pollMode && (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                  }}
                >
                  Active
                </span>
              )}
            </button>
          </div>

          {/* ── Poll blurb (set-mode blurb lives inside DatePickerPanel) ─ */}
          {mode === "poll" && (
            <p
              className="text-[12px] leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {`Not sure yet? Propose a few options and let your crew vote on what works.${
                pollMode
                  ? " Here’s your message to them — feel free to update it as needed."
                  : ""
              }`}
            </p>
          )}

          {/* ── Pick your Dates: delegates to shared DatePickerPanel ────── */}
          {mode === "set" && (
            <DatePickerPanel
              tripId={tripId}
              initialStartDate={null}
              initialEndDate={null}
              onSave={handleDatePickerSave}
              isSaving={lockDates.isPending}
            />
          )}

          {/* ── Poll the Crew content: DatePollCard ──────────────────────── */}
          {mode === "poll" && (
            <DatePollCard
              trip={trip}
              isOwner={true}
              onManageCrew={onTabChange ? () => onTabChange("crew") : undefined}
            />
          )}
        </div>
      </div>

      {/* Confirmation modal — handles poll-window preserve/clear choice */}
      {showDatesModal && pendingStart && pendingEnd && (
        <ConfirmDatesModal
          startDate={pendingStart}
          endDate={pendingEnd}
          hasPoll={pollMode}
          pollWindows={pollWindows}
          isPending={lockDates.isPending}
          onConfirm={handleConfirmDates}
          onCancel={() => setShowDatesModal(false)}
        />
      )}
    </>
  );
}
