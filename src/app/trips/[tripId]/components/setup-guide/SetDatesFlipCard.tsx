"use client";

import { useMemo, useState, type FC, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
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
import { DOMAIN_COLORS } from "@/lib/domainColors";
import { CalendarThumbnail } from "./thumbnails";
import type { TripData } from "../../tabs/types";

// ── SetDatesFlipCard ──────────────────────────────────────────────────────
//
// Step 1 of the FreshTripGuide. The card flips in place on tap to reveal a
// compact range calendar (no navigation, no native date inputs). The same
// reusable calendar primitives `@/lib/calendar` exposes drive the grid —
// what the rest of the app uses everywhere else — just rendered inline at
// a tighter cell size so the month fits inside a step-card-sized container.
//
// Poll tab gating:
//   - <2 crew  → "Add the crew first" redirect with Invite + quiet fallback
//   - ≥2 crew  → hand off to DatesSheet's existing poll builder (we don't
//                duplicate the inline poll UI).

export interface SetDatesFlipCardProps {
  tripId: string;
  trip: TripData;
  /** Opens the existing DatesSheet — used by the Poll branch (≥2 crew). */
  onOpenDatesSheet?: () => void;
  /** Navigate to the Crew tab — used by the Poll-branch <2 crew redirect. */
  onTabChange?: (tab: string) => void;
  /** Set to true once trip.start_date is locked. Renders the done state. */
  done?: boolean;
  /** Summary shown in the done state, e.g. "May 26 – Jun 14". */
  doneSummary?: string;
}

type PickerTab = "pick" | "poll";

const STEP_NUMBER = 1;

// Compact day-cell height tuned so a 6-row month fits without the card
// scrolling on its own.
const DAY_CELL_PX = 27;
// Minimum flipped-card height — covers the picker tab strip + presets +
// month grid + Save row at the tightest viewport so the card grows to fit
// instead of clamping the calendar.
const FLIPPED_MIN_H = 390;

export const SetDatesFlipCard: FC<SetDatesFlipCardProps> = ({
  tripId,
  trip,
  onOpenDatesSheet,
  onTabChange,
  done = false,
  doneSummary,
}) => {
  const tint = DOMAIN_COLORS.home;
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<PickerTab>("pick");
  const utils = trpc.useUtils();

  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const crewCount = members.length;

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
          : old,
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setFlipped(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── Front face (default) ──────────────────────────────────────────────
  const front: ReactNode = (
    <div className="flex h-full flex-col">
      <div
        className="mb-3 flex h-20 items-center justify-center overflow-hidden rounded-lg"
        style={{
          background: tint.faint,
          color: tint.color,
          opacity: done ? 0.55 : 1,
        }}
        aria-hidden="true"
      >
        <CalendarThumbnail />
      </div>
      <p
        className="text-[13px] font-semibold leading-tight"
        style={{ color: "var(--color-bt-text)" }}
      >
        Set your dates
      </p>
      {done && doneSummary ? (
        <p className="mt-1 text-[12px]" style={{ color: tint.color }}>
          {doneSummary}
        </p>
      ) : (
        <p
          className="mt-1 text-[11px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Lock a range or poll the crew — bookends the day-by-day timeline.
        </p>
      )}
      <div className="mt-3">
        {done ? (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="guide-step-dates-change"
          >
            Change
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="w-full rounded-lg py-2 text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="guide-step-dates-cta"
          >
            Set dates
          </button>
        )}
      </div>
    </div>
  );

  // ── Back face (flipped — picker) ──────────────────────────────────────
  const back: ReactNode = (
    <div className="flex h-full flex-col">
      {/* Tab strip + back button */}
      <div className="mb-2 flex items-center justify-between">
        <div
          className="inline-flex rounded-lg p-0.5"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          {(["pick", "poll"] as const).map((value) => {
            const active = tab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
                style={
                  active
                    ? { background: tint.faint, color: tint.color }
                    : { background: "transparent", color: "var(--color-bt-text-dim)" }
                }
                data-testid={`guide-dates-tab-${value}`}
              >
                {value === "pick" ? "Pick" : "Poll"}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setFlipped(false)}
          aria-label="Back to step card"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
          data-testid="guide-dates-flip-back"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {tab === "pick" ? (
        <InlineRangeCalendar
          initialStart={trip.start_date ?? null}
          initialEnd={trip.end_date ?? null}
          saving={lockDates.isPending}
          accent={tint.color}
          accentFaint={tint.faint}
          onSave={(start, end) =>
            lockDates.mutate({
              tripId,
              startDate: start.toISOString().slice(0, 10),
              endDate: end.toISOString().slice(0, 10),
            })
          }
        />
      ) : crewCount < 2 ? (
        <div className="flex flex-1 flex-col items-start gap-2">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: tint.faint, color: tint.color }}
            aria-hidden="true"
          >
            <Users size={16} />
          </span>
          <p
            className="text-[13px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Add the crew first
          </p>
          <p
            className="text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Polling needs at least two people — invite the crew, then come
            back to set up the date poll.
          </p>
          <div className="mt-1 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onTabChange?.("crew")}
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
              style={{
                background: tint.color,
                color: "var(--color-bt-on-accent, #0d1f1a)",
              }}
              data-testid="guide-dates-poll-invite-crew"
            >
              Invite crew
            </button>
            <button
              type="button"
              onClick={() => setTab("pick")}
              className="text-[11px] transition-opacity hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
              data-testid="guide-dates-poll-fallback-pick"
            >
              or just pick the dates yourself
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-start gap-2">
          <p
            className="text-[13px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Poll the crew
          </p>
          <p
            className="text-[11px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Propose a few date ranges and the crew votes. Set up the
            options in the dates sheet.
          </p>
          <button
            type="button"
            onClick={() => {
              setFlipped(false);
              onOpenDatesSheet?.();
            }}
            className="mt-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="guide-dates-poll-launch"
          >
            Set up date poll →
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative" style={{ perspective: 1200 }}>
      {/* Step number badge — sits above both faces. */}
      <span
        className="absolute -top-2 left-3 z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
        style={{
          background: tint.color,
          color: "var(--color-bt-on-accent, #0d1f1a)",
        }}
        aria-hidden="true"
      >
        {STEP_NUMBER}
      </span>
      <div
        className="relative w-full"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 450ms cubic-bezier(.2,.8,.2,1)",
          // Grow to the picker's height when flipped so the calendar never
          // has to scroll inside the card; collapse back when front-side.
          minHeight: flipped ? FLIPPED_MIN_H : undefined,
        }}
        data-testid="guide-step-dates"
      >
        {/* Front */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            overflow: "hidden",
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          className="absolute inset-0 rounded-xl p-4"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            transform: "rotateY(180deg)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            overflow: "hidden",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
};

// ── InlineRangeCalendar ──────────────────────────────────────────────────
//
// Compact always-open range calendar driven by `@/lib/calendar` primitives.
// Same selection mechanic as the global DatePicker (click start → click
// end → range fills in), but rendered inline at tighter cell sizes so a
// full month fits inside the flip-card-sized container without scroll.

function InlineRangeCalendar({
  initialStart,
  initialEnd,
  saving,
  accent,
  accentFaint,
  onSave,
}: {
  initialStart: string | null;
  initialEnd: string | null;
  saving: boolean;
  accent: string;
  accentFaint: string;
  onSave: (start: Date, end: Date) => void;
}) {
  const today = atNoon(new Date());
  const [range, setRange] = useState<DateRange>(() => ({
    start: initialStart ? atNoon(new Date(initialStart)) : null,
    end: initialEnd ? atNoon(new Date(initialEnd)) : null,
  }));
  const [view, setView] = useState<Date>(() =>
    range.start ? startOfMonth(range.start) : startOfMonth(today),
  );

  const matrix = useMemo(() => monthMatrix(view), [view]);
  const presets = useMemo(() => rangePresets(today), [today]);
  const nights = range.start && range.end ? nightsBetween(range.start, range.end) : null;

  const monthLabel = view.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const handleDayClick = (day: Date) => {
    if (isOutOfBounds(day, null, null)) return;
    setRange((cur) => applyRangeClick(cur, day));
  };

  const canSave = !!(range.start && range.end);

  return (
    <div className="flex flex-1 flex-col">
      {/* Presets */}
      <div className="mb-2 flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setRange(p.range);
              if (p.range.start) setView(startOfMonth(p.range.start));
            }}
            className="rounded-md px-2 py-1 text-[10px] font-medium transition-colors"
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

      {/* Month header */}
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView((v) => addMonths(v, -1))}
          aria-label="Previous month"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronLeft size={13} />
        </button>
        <span
          className="text-[11px] font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setView((v) => addMonths(v, 1))}
          aria-label="Next month"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span
            key={`${w}-${i}`}
            className="text-[9px] font-semibold uppercase"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {w}
          </span>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-px">
        {matrix.flat().map((day, idx) => {
          const inMonth = day.getMonth() === view.getMonth();
          const isStart = isSameDay(day, range.start);
          const isEnd = isSameDay(day, range.end);
          const inRange = isWithinRange(day, range);
          const isToday = isSameDay(day, today);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleDayClick(day)}
              className="relative flex items-center justify-center text-[11px] font-medium transition-colors"
              style={{
                height: DAY_CELL_PX,
                color: !inMonth
                  ? "var(--color-bt-text-dim)"
                  : isStart || isEnd
                    ? "var(--color-bt-on-accent, #0d1f1a)"
                    : "var(--color-bt-text)",
                background: isStart || isEnd
                  ? accent
                  : inRange
                    ? accentFaint
                    : "transparent",
                borderRadius:
                  isStart && isEnd
                    ? 6
                    : isStart
                      ? "6px 0 0 6px"
                      : isEnd
                        ? "0 6px 6px 0"
                        : 0,
                opacity: inMonth ? 1 : 0.4,
              }}
              data-testid={`day-${day.toISOString().slice(0, 10)}`}
            >
              {day.getDate()}
              {isToday && !isStart && !isEnd && (
                <span
                  className="absolute bottom-[2px] h-[3px] w-[3px] rounded-full"
                  style={{ background: accent }}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Save row */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className="text-[10px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {nights != null ? `${nights} night${nights === 1 ? "" : "s"}` : "Pick a range"}
        </span>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => {
            if (canSave) onSave(range.start!, range.end!);
          }}
          className="rounded-md px-3 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: accent,
            color: "var(--color-bt-on-accent, #0d1f1a)",
          }}
          data-testid="guide-dates-save"
        >
          {saving ? "Saving…" : "Set dates"}
        </button>
      </div>
    </div>
  );
}
