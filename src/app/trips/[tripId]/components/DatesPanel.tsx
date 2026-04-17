"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";
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
 *   1. idle/set:    segmented control on "Set Dates" — pickers revealed below
 *   2. poll:        segmented control on "Poll the Crew" — DatePollCard below
 *
 * Switching to "Poll the Crew" segment fires setPollMode(true) if not already.
 * Setting dates with an active poll cascades: lockDates + setPollMode(false).
 * The Set button is two-stage: first click shows a confirmation message,
 * second click executes. Confirm message is context-aware (poll active vs not).
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

  // Local UI state — segmented control selection + date picker values
  const [mode, setMode] = useState<"set" | "poll">(pollMode ? "poll" : "set");
  const [showSetConfirm, setShowSetConfirm] = useState(false);
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");

  // Sync mode with server state (e.g. poll cancelled from another session)
  useEffect(() => {
    setMode(pollMode ? "poll" : "set");
  }, [pollMode]);

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
      setShowSetConfirm(false);
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

  const handleSetDatesConfirm = () => {
    if (!directStart || !directEnd || directStart >= directEnd) return;
    // If a poll is active, cascade clear it alongside locking dates
    if (pollMode) {
      setPollActive.mutate({ tripId, pollMode: false });
    }
    lockDates.mutate({ tripId, startDate: directStart, endDate: directEnd });
  };

  const handleSelectPollSegment = () => {
    setMode("poll");
    setShowSetConfirm(false);
    if (!pollMode) {
      setPollActive.mutate({ tripId, pollMode: true });
    }
  };

  const handleSelectSetSegment = () => {
    setMode("set");
    setShowSetConfirm(false);
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

  // Owner, not-locked — segmented control state machine.
  const valid = !!directStart && !!directEnd && directStart < directEnd;

  const confirmMessage = pollMode
    ? "This will lock these dates and clear the poll. Are you sure?"
    : "Lock these dates?";

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
        {/* ── Segmented control: Set Dates | Poll the Crew ──────────────── */}
        <div
          className="flex overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--color-bt-border)" }}
        >
          <button
            type="button"
            onClick={handleSelectSetSegment}
            className="flex flex-1 items-center justify-center py-2.5 text-sm font-medium transition-colors"
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
            Set Dates
          </button>
          <div
            className="w-px self-stretch"
            style={{ background: "var(--color-bt-border)" }}
          />
          <button
            type="button"
            onClick={handleSelectPollSegment}
            disabled={setPollActive.isPending}
            className="flex flex-1 items-center justify-center py-2.5 text-sm font-medium transition-colors"
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
            Poll the Crew
          </button>
        </div>

        {/* ── Set Dates content: pickers + two-stage confirm ─────────────── */}
        {mode === "set" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Start date
              </label>
              <input
                type="date"
                value={directStart}
                onChange={(e) => {
                  setDirectStart(e.target.value);
                  setShowSetConfirm(false);
                }}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                End date
              </label>
              <input
                type="date"
                value={directEnd}
                onChange={(e) => {
                  setDirectEnd(e.target.value);
                  setShowSetConfirm(false);
                }}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </div>

            {/* Two-stage confirm message */}
            {showSetConfirm && valid && (
              <p
                className="text-xs leading-snug"
                style={{ color: "var(--color-bt-warning)" }}
              >
                {confirmMessage}
              </p>
            )}

            <button
              type="button"
              disabled={!valid || lockDates.isPending}
              onClick={() => {
                if (!showSetConfirm) {
                  setShowSetConfirm(true);
                } else {
                  handleSetDatesConfirm();
                }
              }}
              className="w-full rounded-xl py-2.5 text-sm font-semibold transition-opacity"
              style={{
                background: valid ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
                color: valid ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                opacity: valid ? 1 : 0.6,
                cursor: valid ? "pointer" : "not-allowed",
              }}
            >
              {lockDates.isPending ? "Setting…" : "Set dates"}
            </button>
          </div>
        )}

        {/* ── Poll the Crew content: DatePollCard ───────────────────────── */}
        {mode === "poll" && <DatePollCard trip={trip} isOwner={true} />}
      </div>
    </PlanningRow>
  );
}
