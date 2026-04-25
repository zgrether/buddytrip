"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  CalendarRange,
  Check,
  ChevronRight,
  Hotel,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { formatDateRangeCompact } from "@/lib/dates";
import type { TripData } from "../types";
import { DatePollCard } from "./DatePollCard";

// ── Types ─────────────────────────────────────────────────────────────────

export type TileKey = "dates" | "crew" | "lodging" | "schedule";
export type TileState = "empty" | "complete" | "skipped";

export interface PlanningGridProps {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  onTabChange?: (tab: string) => void;
  /** Opens the TripSummaryModal, which fires advanceToGoing. */
  onAdvanceToGoing?: () => void;
}

// ── Tile primitives ───────────────────────────────────────────────────────

interface TileStyling {
  background: string;
  border: string;
  opacity: number;
  iconBg: string;
  iconColor: string;
  labelColor: string;
}

function stylingForState(state: TileState, isActive: boolean): TileStyling {
  if (isActive) {
    return {
      background: "var(--color-bt-accent-faint)",
      border: "1px solid var(--color-bt-accent-border)",
      opacity: 1,
      iconBg: "var(--color-bt-accent-faint)",
      iconColor: "var(--color-bt-accent)",
      labelColor: "var(--color-bt-accent)",
    };
  }
  if (state === "complete") {
    return {
      background: "var(--color-bt-accent-faint)",
      border: "1px solid var(--color-bt-accent-border)",
      opacity: 1,
      iconBg: "var(--color-bt-accent-faint)",
      iconColor: "var(--color-bt-accent)",
      labelColor: "var(--color-bt-accent)",
    };
  }
  if (state === "skipped") {
    return {
      background: "var(--color-bt-card)",
      border: "1px solid var(--color-bt-border)",
      opacity: 0.6,
      iconBg: "var(--color-bt-card-raised)",
      iconColor: "var(--color-bt-text-dim)",
      labelColor: "var(--color-bt-text-dim)",
    };
  }
  return {
    background: "var(--color-bt-card)",
    border: "1px solid var(--color-bt-border)",
    opacity: 1,
    iconBg: "var(--color-bt-card-raised)",
    iconColor: "var(--color-bt-text-dim)",
    labelColor: "var(--color-bt-text-dim)",
  };
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  state: TileState;
  /** Visual-only override — true when the dates tile has its accordion
   *  expanded, so it picks up the active styling. */
  isActive?: boolean;
  /** Empty-state body. */
  emptyDescription: string;
  emptyCTA: string;
  /** Complete-state body. */
  completeValue?: string;
  completeSub?: React.ReactNode;
  /** canEdit gates the Skip affordance. */
  canEdit: boolean;
  /** Called when the tile body (not the skip button) is clicked. */
  onClick?: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  skipping: boolean;
  /** Optional warning shown below "Not needed for this trip" when skipped. */
  skippedNudge?: React.ReactNode;
  testId?: string;
}

function Tile({
  icon: Icon,
  label,
  state,
  isActive,
  emptyDescription,
  emptyCTA,
  completeValue,
  completeSub,
  canEdit,
  onClick,
  onSkip,
  onUnskip,
  skipping,
  skippedNudge,
  testId,
}: TileProps) {
  const styling = stylingForState(state, !!isActive);
  // All tiles are navigable regardless of state — checkmark means "addressed",
  // not "locked". onClick prop being set is the only gate.
  const clickable = !!onClick;

  return (
    <div
      data-testid={testId}
      data-state={state}
      data-active={isActive ? "true" : undefined}
      onClick={clickable ? onClick : undefined}
      className="relative flex flex-col rounded-xl p-3 transition-colors"
      style={{
        background: styling.background,
        border: styling.border,
        opacity: styling.opacity,
        minHeight: 130,
        cursor: clickable ? "pointer" : "default",
      }}
    >
      {/* Top row: icon + status indicator */}
      <div className="mb-2 flex items-start justify-between">
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: styling.iconBg, color: styling.iconColor }}
        >
          <Icon size={22} strokeWidth={1.75} />
        </span>

        {state === "complete" && (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            aria-label="Complete"
          >
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        {state === "skipped" && (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
            }}
            aria-label="Skipped"
          >
            <X size={11} strokeWidth={2.5} />
          </span>
        )}
      </div>

      {/* Label */}
      <p
        className="mb-1 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: styling.labelColor }}
      >
        {label}
      </p>

      {/* Body */}
      {state === "complete" ? (
        <>
          {completeValue && (
            <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {completeValue}
            </p>
          )}
          {completeSub && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {completeSub}
            </p>
          )}
        </>
      ) : state === "skipped" ? (
        <div className="space-y-1">
          <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Not needed for this trip
          </p>
          {skippedNudge}
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
          {emptyDescription}
        </p>
      )}

      {/* Footer: CTA + Skip (empty), or Undo (skipped) */}
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        {state === "empty" && (
          <>
            {clickable ? (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: "var(--color-bt-accent)" }}
              >
                {emptyCTA}
                <ChevronRight size={10} />
              </span>
            ) : (
              <span />
            )}
            {canEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSkip();
                }}
                disabled={skipping}
                className="text-[11px] disabled:opacity-40"
                style={{
                  color: "var(--color-bt-text-dim)",
                  background: "transparent",
                  border: "none",
                  textDecoration: "underline dotted",
                  textUnderlineOffset: 2,
                }}
              >
                Skip
              </button>
            )}
          </>
        )}
        {state === "skipped" && canEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnskip();
            }}
            disabled={skipping}
            className="ml-auto text-[11px] disabled:opacity-40"
            style={{
              color: "var(--color-bt-text-dim)",
              background: "transparent",
              border: "none",
              textDecoration: "underline dotted",
              textUnderlineOffset: 2,
            }}
          >
            Undo skip
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main grid ─────────────────────────────────────────────────────────────

/**
 * PlanningGrid — the Home tab surface during the PLANNING stage.
 *
 * Four tiles (Dates / Crew / Lodging / Schedule) in a 2×2 grid.
 * Each tile has three states: empty, complete, skipped. The Dates tile
 * opens an inline accordion below the grid with "Pick Dates" / "Poll the
 * Crew" segments. Below everything, a "View Itinerary" button advances
 * the trip to going once every tile is either complete or skipped.
 */
export function PlanningGrid({
  trip,
  canEdit,
  isOwner,
  onTabChange,
  onAdvanceToGoing,
}: PlanningGridProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: logisticsItems = [] } = trpc.logistics.list.useQuery({ tripId });
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId });

  // ── Derived counts + locked date ───────────────────────────────────────
  const crewCount = members.length;
  const hasCrew = crewCount > 1; // more than just the owner

  // Lodging lives on the logistics_items table under type='lodging';
  // reservations is for tee-times/restaurants/transport.
  const lodgingItems = (logisticsItems as Array<{ type: string; is_confirmed?: boolean | null }>).filter(
    (r) => r.type === "lodging",
  );
  const lodgingCount = lodgingItems.length;
  const lodgingConfirmed = lodgingItems.filter((r) => r.is_confirmed).length;
  const lodgingPending = lodgingCount - lodgingConfirmed;

  const scheduleCount = (scheduleItems as Array<unknown>).length;

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;
  const lockedDateLabel = useMemo(
    () => (datesLocked ? formatDateRangeCompact(trip.start_date, trip.end_date) : null),
    [datesLocked, trip.start_date, trip.end_date],
  );

  // ── Tile states ────────────────────────────────────────────────────────
  const planningSkipped: string[] = Array.isArray((trip as unknown as { planning_skipped?: unknown }).planning_skipped)
    ? ((trip as unknown as { planning_skipped: string[] }).planning_skipped ?? [])
    : [];

  const stateFor = (tile: TileKey, complete: boolean): TileState => {
    if (complete) return "complete";
    if (planningSkipped.includes(tile)) return "skipped";
    return "empty";
  };

  const datesState = stateFor("dates", datesLocked);
  const crewState = stateFor("crew", hasCrew);
  const lodgingState = stateFor("lodging", lodgingCount > 0);
  const scheduleState = stateFor("schedule", scheduleCount > 0);

  const allResolved = [datesState, crewState, lodgingState, scheduleState].every(
    (s) => s === "complete" || s === "skipped",
  );

  // ── Dates accordion ────────────────────────────────────────────────────
  const [datesPanelOpen, setDatesPanelOpen] = useState(false);
  const [dateMode, setDateMode] = useState<"set" | "poll">(pollMode ? "poll" : "set");

  // Close the panel when the user skips dates.
  useEffect(() => {
    if (datesState === "skipped") {
      setDatesPanelOpen(false);
    }
  }, [datesState]);

  // Pick-your-dates form state
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");
  const [confirmClearPoll, setConfirmClearPoll] = useState(false);

  const lockDates = trpc.trips.lockDates.useMutation({
    onSuccess() {
      setDirectStart("");
      setDirectEnd("");
      setConfirmClearPoll(false);
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });
  const setPollActive = trpc.datePoll.setPollMode.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const handleSet = () => {
    if (!directStart || !directEnd || directStart >= directEnd) return;
    if (pollMode && !confirmClearPoll) {
      setConfirmClearPoll(true);
      return;
    }
    if (pollMode) setPollActive.mutate({ tripId, pollMode: false });
    lockDates.mutate({ tripId, startDate: directStart, endDate: directEnd });
  };

  // ── Skip / unskip ──────────────────────────────────────────────────────
  // Track which tile is currently mutating so only that tile's button
  // dims — otherwise all four buttons would flash together while a single
  // mutation is in flight.
  const [pendingTile, setPendingTile] = useState<TileKey | null>(null);
  const skipTile = trpc.trips.skipPlanningTile.useMutation({
    onSettled() {
      setPendingTile(null);
      utils.trips.getById.invalidate({ tripId });
    },
  });
  const unskipTile = trpc.trips.unskipPlanningTile.useMutation({
    onSettled() {
      setPendingTile(null);
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const handleSkip = (tile: TileKey) => {
    setPendingTile(tile);
    skipTile.mutate({ tripId, tile });
  };
  const handleUnskip = (tile: TileKey) => {
    setPendingTile(tile);
    unskipTile.mutate({ tripId, tile });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Orientation copy — always visible */}
      <p className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Destination locked in — now let&apos;s get the details sorted.
      </p>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <Tile
          testId="planning-tile-dates"
          icon={CalendarRange}
          label="Dates"
          state={datesState}
          isActive={datesPanelOpen}
          emptyDescription="Not set yet"
          emptyCTA="Set dates"
          completeValue={lockedDateLabel ?? undefined}
          canEdit={canEdit}
          onClick={canEdit ? () => setDatesPanelOpen((v) => !v) : undefined}
          onSkip={() => handleSkip("dates")}
          onUnskip={() => handleUnskip("dates")}
          skipping={pendingTile === "dates"}
        />
        <Tile
          testId="planning-tile-crew"
          icon={Users}
          label="Crew"
          state={crewState}
          emptyDescription="No one added yet"
          emptyCTA="Add crew"
          completeValue={`${crewCount} ${crewCount === 1 ? "person" : "people"}`}
          canEdit={canEdit}
          onClick={() => onTabChange?.("crew")}
          onSkip={() => handleSkip("crew")}
          onUnskip={() => handleUnskip("crew")}
          skipping={pendingTile === "crew"}
        />
        <Tile
          testId="planning-tile-lodging"
          icon={Hotel}
          label="Lodging"
          state={lodgingState}
          emptyDescription="Nothing added yet"
          emptyCTA="Add property"
          completeValue={`${lodgingCount} ${lodgingCount === 1 ? "option" : "options"}`}
          completeSub={
            lodgingCount > 0 ? (
              <>
                <span style={{ color: "var(--color-bt-accent)" }}>{lodgingConfirmed} confirmed</span>
                {" · "}
                <span style={{ color: "var(--color-bt-warning)" }}>{lodgingPending} pending</span>
              </>
            ) : null
          }
          canEdit={canEdit}
          onClick={() => onTabChange?.("lodging")}
          onSkip={() => handleSkip("lodging")}
          onUnskip={() => handleUnskip("lodging")}
          skipping={pendingTile === "lodging"}
          skippedNudge={
            lodgingState === "skipped" && crewState === "complete" ? (
              <p className="text-[11px]" style={{ color: "var(--color-bt-warning)" }}>
                Your crew won&apos;t know where you&apos;re staying
              </p>
            ) : undefined
          }
        />
        <Tile
          testId="planning-tile-schedule"
          icon={Calendar}
          label="Schedule"
          state={scheduleState}
          emptyDescription="Nothing planned yet"
          emptyCTA="Add items"
          completeValue={`${scheduleCount} ${scheduleCount === 1 ? "item" : "items"}`}
          canEdit={canEdit}
          onClick={() => onTabChange?.("schedule")}
          onSkip={() => handleSkip("schedule")}
          onUnskip={() => handleUnskip("schedule")}
          skipping={pendingTile === "schedule"}
          skippedNudge={
            scheduleState === "skipped" && crewState === "complete" ? (
              <p className="text-[11px]" style={{ color: "var(--color-bt-warning)" }}>
                Your crew won&apos;t know what&apos;s planned
              </p>
            ) : undefined
          }
        />
      </div>

      {/* ── Dates accordion ─────────────────────────────────────────────── */}
      {datesPanelOpen && canEdit && (
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "var(--shadow-raised)",
          }}
          data-testid="planning-dates-panel"
        >
          {/* Segmented control */}
          <div className="p-3">
            <div
              className="flex rounded-xl p-1"
              style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
            >
              <button
                type="button"
                onClick={() => setDateMode("set")}
                data-active={dateMode === "set"}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold"
                style={
                  dateMode === "set"
                    ? { background: "var(--color-bt-card)", color: "var(--color-bt-text)", boxShadow: "var(--shadow-card)" }
                    : { background: "transparent", color: "var(--color-bt-text-dim)" }
                }
              >
                <CalendarRange size={12} />
                Pick your Dates
              </button>
              <button
                type="button"
                onClick={() => hasCrew && setDateMode("poll")}
                disabled={!hasCrew}
                data-active={dateMode === "poll"}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={
                  dateMode === "poll" && hasCrew
                    ? { background: "var(--color-bt-card)", color: "var(--color-bt-text)", boxShadow: "var(--shadow-card)" }
                    : { background: "transparent", color: "var(--color-bt-text-dim)" }
                }
              >
                <Users size={12} />
                Poll the Crew
              </button>
            </div>

            {!hasCrew && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Add crew members first —{" "}
                <button
                  type="button"
                  onClick={() => onTabChange?.("crew")}
                  className="font-semibold underline"
                  style={{ color: "var(--color-bt-accent)", background: "transparent", border: "none" }}
                >
                  go to Crew tab →
                </button>
              </p>
            )}
          </div>

          {/* Body */}
          {dateMode === "set" ? (
            <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: "var(--color-bt-border)" }}>
              <p className="mb-2 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Already know the dates? Lock them in directly.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[140px] flex-1">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                    Start date
                  </label>
                  <input
                    type="date"
                    value={directStart}
                    onChange={(e) => setDirectStart(e.target.value)}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                    style={{
                      background: "var(--color-bt-base)",
                      borderColor: "var(--color-bt-border)",
                      color: "var(--color-bt-text)",
                    }}
                  />
                </div>
                <div className="min-w-[140px] flex-1">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                    End date
                  </label>
                  <input
                    type="date"
                    value={directEnd}
                    onChange={(e) => setDirectEnd(e.target.value)}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                    style={{
                      background: "var(--color-bt-base)",
                      borderColor: "var(--color-bt-border)",
                      color: "var(--color-bt-text)",
                    }}
                  />
                </div>
                {!confirmClearPoll && (
                  <button
                    type="button"
                    onClick={handleSet}
                    disabled={
                      !directStart ||
                      !directEnd ||
                      directStart >= directEnd ||
                      lockDates.isPending
                    }
                    className="flex-shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >
                    Set
                  </button>
                )}
              </div>

              {confirmClearPoll && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[13px]"
                  style={{ background: "var(--color-bt-warning-faint)", borderColor: "var(--color-bt-warning-border)" }}
                >
                  <span style={{ color: "var(--color-bt-text)" }}>
                    This will clear the poll. Are you sure?
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmClearPoll(false)}
                    className="ml-auto rounded-lg px-3 py-1 text-xs font-semibold"
                    style={{ color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSet}
                    disabled={lockDates.isPending || setPollActive.isPending}
                    className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >
                    Confirm
                  </button>
                </div>
              )}
            </div>
          ) : hasCrew ? (
            <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: "var(--color-bt-border)" }}>
              <DatePollCard
                trip={trip}
                isOwner={isOwner}
                onManageCrew={canEdit && onTabChange ? () => onTabChange("crew") : undefined}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* ── View Itinerary ─────────────────────────────────────────────── */}
      {isOwner && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {allResolved ? (
              <>
                Everything&apos;s set —{" "}
                <span style={{ color: "var(--color-bt-accent)" }}>let&apos;s make it official</span>
              </>
            ) : (
              "Complete or skip all four areas to continue"
            )}
          </p>
          <button
            type="button"
            data-testid="view-itinerary-btn"
            disabled={!allResolved}
            onClick={allResolved ? onAdvanceToGoing : undefined}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold"
            style={
              allResolved
                ? {
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                    cursor: "pointer",
                  }
                : {
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    border: "1px solid var(--color-bt-border)",
                    cursor: "not-allowed",
                  }
            }
          >
            View Itinerary
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
