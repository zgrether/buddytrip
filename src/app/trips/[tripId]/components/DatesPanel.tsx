"use client";

import { useMemo, useState } from "react";
import { Calendar, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { parseLocalDate, formatDateRangeCompact } from "@/lib/dates";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import { DatePollCard } from "../tabs/components/DatePollCard";
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
 * Three states (owner, !datesLocked):
 *   1. idle:       two buttons — "Set Dates" and "Poll the Crew"
 *   2. setDates:   pickers revealed below the buttons (local UI only)
 *   3. pollMode:   Set Dates disabled; Poll the Crew becomes
 *                  "Nevermind — cancel poll". Crew availability grid
 *                  (DatePollCard) renders below.
 *
 * Clicking "Poll the Crew" in idle → flips server pollMode=true → state 3.
 * Clicking "Nevermind — cancel poll" in state 3 → flips pollMode=false +
 * clears vote/window data (server-side cascade) → back to state 1.
 * Clicking "Set Dates" → toggles local pickers (state 2).
 * Entering valid dates + clicking Set → lockDates → locked view.
 *
 * DatesPanel is owner-only. Non-owners see DatePollCard directly from
 * ActionCenter; DatesPanel returns null for them.
 */
export function DatesPanel({
  trip,
  canEdit: _canEdit,
  isOwner,
  isOpen: _isOpen,
  onToggle: _onToggle,
  onTabChange: _onTabChange,
}: DatesPanelProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;

  // Header "N options" text needs the live window count. tRPC dedupes
  // this against DatePollCard's identical query, so no extra network cost.
  const { data: poll } = trpc.datePoll.get.useQuery(
    { tripId },
    { enabled: pollMode && isOwner }
  );
  const windowCount = poll?.windows.length ?? 0;

  // Local UI — whether the date pickers are revealed. Reset whenever the
  // user hands control to the poll flow.
  const [showPickers, setShowPickers] = useState(false);
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");

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
      setDirectStart("");
      setDirectEnd("");
      setShowPickers(false);
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
    if (pollMode) return `Poll open · ${windowCount} option${windowCount !== 1 ? "s" : ""}`;
    return "";
  }, [datesLocked, pollMode, windowCount, trip.start_date, trip.end_date]);

  // ── Actions ────────────────────────────────────────────────────────────

  const handleSetDates = () => {
    if (!directStart || !directEnd || directStart >= directEnd) return;
    lockDates.mutate({ tripId, startDate: directStart, endDate: directEnd });
  };

  const handlePollTheCrew = () => {
    setShowPickers(false);
    setPollActive.mutate({ tripId, pollMode: true });
  };

  const handleCancelPoll = () => {
    setPollActive.mutate({ tripId, pollMode: false });
  };

  const handleToggleSetDates = () => {
    if (pollMode) return; // disabled while poll active
    setShowPickers((v) => !v);
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
            {formatLongDate(trip.start_date!)} – {formatLongDate(trip.end_date!)}
          </p>
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {nightsBetween(trip.start_date!, trip.end_date!)} night
            {nightsBetween(trip.start_date!, trip.end_date!) !== 1 ? "s" : ""}
          </p>
        </div>
      </PlanningRow>
    );
  }

  // Owner, not-locked — two-button state machine.
  const valid = !!directStart && !!directEnd && directStart < directEnd;

  return (
    <PlanningRow
      icon={<Calendar size={16} />}
      label={headerLabel}
      note={headerNote}
      warnState={pollMode}
      state={state}
      isOpen={true}
      onToggle={() => {}}
      noExpand={true}
    >
      <div className="space-y-3">
        {/* ── Button row: Set Dates + Poll the Crew / Cancel ──────────── */}
        <div className="flex gap-2">
          {/* Set Dates — disabled while poll is active. When pickers are
              open in idle mode we tint it accent to signal "you're here". */}
          <button
            type="button"
            onClick={handleToggleSetDates}
            disabled={pollMode}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
            style={
              pollMode
                ? {
                    border: "1.5px dashed var(--color-bt-border)",
                    color: "var(--color-bt-text-dim)",
                    background: "transparent",
                    opacity: 0.5,
                    cursor: "not-allowed",
                  }
                : showPickers
                ? {
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                    border: "1.5px solid var(--color-bt-accent)",
                  }
                : {
                    border: "1.5px dashed var(--color-bt-accent)",
                    color: "var(--color-bt-accent)",
                    background: "transparent",
                  }
            }
          >
            Set Dates
          </button>

          {/* Poll the Crew / Nevermind — cancel poll */}
          {pollMode ? (
            <button
              type="button"
              onClick={handleCancelPoll}
              disabled={setPollActive.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
              style={{
                border: "1.5px dashed var(--color-bt-warning)",
                color: "var(--color-bt-warning)",
                background: "transparent",
              }}
            >
              <X size={14} />
              {setPollActive.isPending ? "Cancelling…" : "Nevermind — cancel poll"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePollTheCrew}
              disabled={setPollActive.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
              style={{
                border: "1.5px dashed var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
              }}
            >
              Poll the Crew
            </button>
          )}
        </div>

        {/* ── Expanded: date pickers (idle + Set Dates clicked) ─────────── */}
        {showPickers && !pollMode && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={directStart}
              onChange={(e) => setDirectStart(e.target.value)}
              className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <input
              type="date"
              value={directEnd}
              onChange={(e) => setDirectEnd(e.target.value)}
              className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <button
              type="button"
              disabled={!valid || lockDates.isPending}
              onClick={handleSetDates}
              className="flex-shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity"
              style={{
                background: valid ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: valid ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                opacity: valid ? 1 : 0.6,
                cursor: valid ? "pointer" : "not-allowed",
              }}
            >
              {lockDates.isPending ? "Setting…" : "Set"}
            </button>
          </div>
        )}

        {/* ── Expanded: crew availability (poll active) ─────────────────── */}
        {pollMode && <DatePollCard trip={trip} isOwner={true} />}
      </div>
    </PlanningRow>
  );
}
