"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import {
  addMonths,
  applyRangeClick,
  atNoon,
  isOutOfBounds,
  isSameDay,
  isWithinRange,
  monthMatrix,
  nightsBetween,
  rangePresets,
  startOfMonth,
  type DateRange,
} from "@/lib/calendar";
import type { TripData } from "../tabs/types";

// ── Types ────────────────────────────────────────────────────────────────

interface DatesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  trip: TripData;
  isOwner: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * DatesSheet — explicit "pick dates" surface.
 *
 * Opens from the "Set dates →" / locked-range link in the trip header.
 *
 * Single mode: lock dates directly via the inline FullRangeCalendar.
 * Pre-filled when dates already locked; offers a "Clear dates" link in
 * that case. Polling lives entirely on the home tab now (inside
 * FreshTripGuide → SetDatesFlipCard → DatePollCard) — committing dates
 * here is an explicit override that kills any active poll (windows,
 * votes, and the flag), since the owner has consciously chosen to skip
 * the crew's input.
 *
 * Renders as a centred modal — same fixed-inset overlay treatment used by
 * DatesModal across the rest of the trip detail page (the trip header lives
 * inside the page content, not the backdrop-filter nav, so position:fixed
 * is anchored to the viewport as expected).
 */
export function DatesSheet({
  isOpen,
  onClose,
  tripId,
  trip,
  isOwner,
}: DatesSheetProps) {
  const utils = trpc.useUtils();

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollActiveServer = !!trip.poll_mode;

  // Range lives at the sheet level so the calendar can stay a pure
  // controlled component and the footer Cancel/Save/Clear buttons can
  // act on the same state. Seed from the trip's saved dates when the
  // sheet opens.
  const [range, setRange] = useState<DateRange>(() => ({
    start: trip.start_date ? atNoon(new Date(trip.start_date)) : null,
    end: trip.end_date ? atNoon(new Date(trip.end_date)) : null,
  }));

  // Reset the local range each time the sheet opens, so a previous edit
  // session doesn't persist into the next open. (Mounting once and
  // toggling visibility is cheaper than remounting; this useEffect runs
  // exactly when isOpen flips true.)
  useEffect(() => {
    if (isOpen) {
      setRange({
        start: trip.start_date ? atNoon(new Date(trip.start_date)) : null,
        end: trip.end_date ? atNoon(new Date(trip.end_date)) : null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // DatesSheet is always mounted on the trip page (visibility gated by
  // isOpen), so pass isOpen as the `enabled` flag — otherwise the hook
  // pushes a phantom history entry even while closed and silently eats the
  // first back-press on every trip page.
  useModalBackButton(onClose, isOpen);

  // ── Mutations ──────────────────────────────────────────────────────────

  const lockDates = trpc.trips.lockDates.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
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
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
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

  // datePoll.unlock clears trip.start_date / trip.end_date AND removes the
  // associated date_window if it has no votes — same procedure used by
  // SetDatesFlipCard's Clear button. Leaves the poll itself untouched so
  // a re-poll is possible.
  const clearDatesMutation = trpc.datePoll.unlock.useMutation({
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // setPollMode({pollMode: false}) is a full wipe — deletes every window,
  // every vote, closes the poll row, and flips trip.poll_mode = false.
  // We fire this *before* lockDates whenever the trip has an active poll
  // so the explicit pick takes precedence over the in-flight crew vote.
  const endPoll = trpc.datePoll.setPollMode.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, poll_mode: false } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── Derived state ──────────────────────────────────────────────────────

  // YYYY-MM-DD using local parts so a UTC-shifted toISOString() doesn't
  // slip the saved string back a day in non-UTC zones.
  const localYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const rangeYMD: { start: string | null; end: string | null } = {
    start: range.start ? localYMD(range.start) : null,
    end: range.end ? localYMD(range.end) : null,
  };
  const rangeValid = !!(range.start && range.end);
  const rangeEmpty = !range.start && !range.end;
  const sameAsInitial =
    rangeYMD.start === (trip.start_date ?? null) &&
    rangeYMD.end === (trip.end_date ?? null);

  // Save enabled in two cases:
  //   1. The user picked a complete new (or different) range — we'll
  //      lockDates.
  //   2. The user cleared a previously-locked range — we'll unlock so
  //      the trip drops back to a date-less state. (Empty selection on
  //      a trip that already had no dates is a no-op, so disabled.)
  const canSave =
    !sameAsInitial &&
    ((rangeValid) || (rangeEmpty && datesLocked));

  const pendingMutation =
    lockDates.isPending ||
    endPoll.isPending ||
    clearDatesMutation.isPending;

  // ── Actions ────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!canSave || pendingMutation) return;
    // Clear path: user emptied a previously-locked range.
    if (rangeEmpty && datesLocked) {
      clearDatesMutation.mutate({ tripId }, { onSuccess: onClose });
      return;
    }
    // Lock path: full valid range. End any active poll first — the
    // explicit pick takes precedence over the in-flight crew vote
    // (server wipes windows + votes; lockDates pins the dates and
    // sets trip.poll_mode = false in one row update).
    //
    // Sequenced (not concurrent) so endPoll's DELETE of date_windows
    // can't race with lockDates' INSERT of the new window — a
    // concurrent run could leave a dangling locked date with no
    // backing window, and on some races caused lockDates to error
    // (which kept the modal open because the lockDates.onSuccess
    // close handler never fired).
    if (!range.start || !range.end) return;
    try {
      if (pollActiveServer) {
        await endPoll.mutateAsync({ tripId, pollMode: false });
      }
      await lockDates.mutateAsync({
        tripId,
        startDate: localYMD(range.start),
        endDate: localYMD(range.end),
      });
      onClose();
    } catch {
      // Either mutation's onError already rolled back the optimistic
      // cache write; nothing else to do here except keep the modal
      // open so the user can retry.
    }
  };

  /** Clear only wipes the local working selection now — committing the
   *  empty selection via Save is what actually clears the dates on the
   *  trip row. This keeps Clear and Save in the same explicit "review →
   *  commit" model as InfoTileModal. */
  const handleClearSelection = () => {
    setRange({ start: null, end: null });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop + centred container. Click outside to dismiss. */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Trip dates"
      >
        <div
          className="w-full max-w-[480px] overflow-hidden rounded-t-2xl sm:rounded-2xl"
          style={{
            // Matches InfoTileModal: card-float surface + the shared
            // floating shadow token so every "decision" modal in the
            // app sits on the same raised plane.
            background: "var(--color-bt-card-float)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "var(--shadow-floating)",
            maxHeight: "min(85dvh, 720px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — h3 + dim subtitle + 8x8 close button, mirroring
              the InfoTileModal cadence. */}
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <h3
                className="text-base font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                Trip dates
              </h3>
              <p
                className="mt-0.5 text-[12px] leading-snug"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Lock in when the trip starts and ends. Everything else
                hangs off these bookends.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Body — scrolls when content overflows. Single mode: pick
              dates. Polling lives entirely on the home tab now
              (FreshTripGuide → DatePollCard); committing dates here is
              an explicit override that ends any in-flight crew vote. */}
          <div
            className="overflow-y-auto px-5 pb-4"
            style={{ maxHeight: "calc(85dvh - 180px)" }}
          >
            <PickDatesMode
              datesLocked={datesLocked}
              pollActive={pollActiveServer}
              isOwner={isOwner}
              range={range}
              onRangeChange={setRange}
            />
          </div>

          {/* Footer — bordered top, Cancel + Save on the right, Clear on
              the left (only when there's a selection to wipe). Same
              shape as InfoTileModal. Clear is local-only now: it wipes
              the working selection. Committing that empty selection via
              Save is what actually clears the dates on the trip row,
              keeping intent explicit and reviewable. */}
          {isOwner && (
            <div
              className="flex items-center gap-2 px-5 py-3"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              {(range.start || range.end) ? (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="text-[13px] font-medium transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-bt-text-dim)" }}
                  data-testid="dates-sheet-clear"
                >
                  Clear
                </button>
              ) : null}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
                data-testid="dates-sheet-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave || pendingMutation}
                className="flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-on-accent, #0d1f1a)",
                }}
                data-testid="dates-sheet-save"
              >
                {pendingMutation && <Loader2 size={13} className="animate-spin" />}
                Save
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Pick-dates mode ─────────────────────────────────────────────────────

function PickDatesMode({
  datesLocked,
  pollActive,
  isOwner,
  range,
  onRangeChange,
}: {
  datesLocked: boolean;
  /** True when trip.poll_mode is set. Surfaces a small warning above the
   *  picker so the owner knows committing dates here will end the crew's
   *  in-flight vote. */
  pollActive: boolean;
  isOwner: boolean;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
}) {
  // Members can't lock dates; show them the locked range read-only.
  if (!isOwner) {
    return (
      <div
        className="rounded-xl px-4 py-4"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <p
          className="text-[13px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {datesLocked
            ? "The organizer has locked the trip dates."
            : "The organizer hasn't picked the dates yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Poll-active warning — the owner has a crew vote in flight; let
          them know that committing dates here will end the poll (windows
          + votes wiped). Polling lives on the home tab (FreshTripGuide
          → DatePollCard); this modal is the explicit override route. */}
      {!datesLocked && pollActive && (
        <div
          className="rounded-lg px-3 py-2 text-[12px] leading-snug"
          style={{
            background: "var(--color-bt-accent-faint)",
            border: "1px solid var(--color-bt-accent-border)",
            color: "var(--color-bt-text-dim)",
          }}
        >
          <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>
            A date poll is open.
          </span>{" "}
          Picking dates here will end the poll and clear the crew&apos;s
          votes.
        </div>
      )}

      {/* Full-size inline calendar — controlled component. State lives at
          the DatesSheet level so the footer's Cancel/Clear/Save buttons
          act on the same range. Same round-cap / fill-bar / pill-preset
          design as the lodging DatePicker. */}
      <FullRangeCalendar range={range} onRangeChange={onRangeChange} />
    </div>
  );
}

// ── FullRangeCalendar ─────────────────────────────────────────────────────
//
// Full-size inline range picker for the DatesSheet's Pick mode. Same
// design vocabulary as src/components/DatePicker.tsx (round caps with a
// continuous in-range fill bar behind them, round-pill quick presets,
// SMTWTFS weekday header, today dot) but rendered inline rather than as
// a popover. The flip card's compact picker (SetDatesFlipCard's
// InlineRangeCalendar) uses the same vocabulary at smaller cell sizes;
// this one runs at DatePicker's ROW_H/CAP_PX so the modal's calendar
// reads like the lodging picker at native scale.

const FULL_ROW_H = 36;
const FULL_CAP_PX = 32;
const FULL_CAP_TEXT = "var(--color-bt-on-accent, #0d1f1a)";

function FullRangeCalendar({
  range,
  onRangeChange,
}: {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
}) {
  const today = useMemo(() => atNoon(new Date()), []);
  const accent = "var(--color-bt-accent)";
  const accentFaint = "var(--color-bt-accent-faint)";

  // View (the focused month) is local — it's purely presentational state.
  // Seed from the current selection's start, falling back to today.
  const [view, setView] = useState<Date>(() =>
    range.start ? startOfMonth(range.start) : startOfMonth(today),
  );

  // Hover state for the day cells. Matches src/components/DatePicker.tsx
  // (the lodging popover) — non-cap, in-bounds days draw a 1px inset
  // accent ring on hover so the pointer always reads as a primed target.
  const [hovered, setHovered] = useState<Date | null>(null);

  const matrix = useMemo(() => monthMatrix(view), [view]);
  const presets = useMemo(() => rangePresets(today), [today]);
  const nights = range.start && range.end ? nightsBetween(range.start, range.end) : null;

  const monthLabel = view.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const handleDayClick = (day: Date) => {
    if (isOutOfBounds(day, null, null)) return;
    onRangeChange(applyRangeClick(range, day));
  };

  return (
    <div className="flex flex-col">
      {/* Presets — round-pill quick selections, matching the lodging
          DatePicker popover's preset row. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onRangeChange(p.range);
              if (p.range.start) setView(startOfMonth(p.range.start));
            }}
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Month nav */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setView((v) => addMonths(v, -1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronLeft size={16} />
        </button>
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {monthLabel}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView((v) => addMonths(v, 1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="flex h-7 items-center justify-center text-[10px] font-semibold uppercase"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — round caps with the continuous fill bar behind them.
          Bar peeks out from under the cap on the side that faces its
          partner, giving the range a single continuous strip. */}
      <div className="grid grid-cols-7">
        {matrix.flat().map((day, idx) => {
          const inMonth = day.getMonth() === view.getMonth();
          const isStart = isSameDay(day, range.start);
          const isEnd = isSameDay(day, range.end);
          const isCap = isStart || isEnd;
          const between = isWithinRange(day, range);
          const hasEnd = !!range.end;
          const isToday = isSameDay(day, today);
          const showFill = between || (isStart && hasEnd) || isEnd;
          return (
            <div key={idx} className="relative" style={{ height: FULL_ROW_H }}>
              {showFill && (
                <div
                  className="absolute inset-y-1"
                  style={{
                    left: isStart ? "50%" : 0,
                    right: isEnd ? "50%" : 0,
                    background: accentFaint,
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => setHovered(day)}
                onMouseLeave={() => setHovered(null)}
                className="relative mx-auto flex items-center justify-center rounded-full text-[13px] transition-colors"
                style={{
                  width: FULL_CAP_PX,
                  height: FULL_CAP_PX,
                  background: isCap ? accent : "transparent",
                  color: isCap
                    ? FULL_CAP_TEXT
                    : inMonth
                      ? "var(--color-bt-text)"
                      : "var(--color-bt-text-dim)",
                  fontWeight: isCap ? 700 : 400,
                  opacity: inMonth ? 1 : 0.45,
                  // Teal 1px inset ring on hover, but only for non-cap
                  // days (caps already carry the accent fill). Matches
                  // DatePicker's hover treatment.
                  boxShadow:
                    isSameDay(day, hovered) && !isCap
                      ? `inset 0 0 0 1px ${accent}`
                      : "none",
                }}
                data-testid={`full-day-${day.toISOString().slice(0, 10)}`}
              >
                {day.getDate()}
                {isToday && !isCap && (
                  <span
                    className="absolute bottom-1 h-1 w-1 rounded-full"
                    style={{ background: accent }}
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Status line — quietly echoes the working selection so the user
          can scan "how many nights am I about to lock in." Commit
          happens in the modal footer's Save button. */}
      <p
        className="mt-2 text-center text-[11px]"
        style={{ color: "var(--color-bt-text-dim)" }}
        data-testid="dates-sheet-status"
      >
        {nights != null
          ? `${nights} night${nights === 1 ? "" : "s"}`
          : range.start
            ? "Pick an end date"
            : "Pick a range"}
      </p>
    </div>
  );
}
