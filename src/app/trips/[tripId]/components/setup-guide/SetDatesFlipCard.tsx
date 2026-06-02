"use client";

import { useMemo, useState, type FC, type ReactNode } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Users,
  X,
} from "lucide-react";
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
import { formatDateRangeCompact } from "@/lib/dates";
import { CalendarThumbnail } from "./thumbnails";
import type { TripData } from "../../tabs/types";

// ── SetDatesFlipCard ──────────────────────────────────────────────────────
//
// Step 1 of the FreshTripGuide. Same outer card shape as StepCard so the
// grid lines up; flips in place to a compact Pick/Poll picker (no
// navigation, no native date inputs). When trip.start_date is locked the
// whole card paints in accent-faint with an accent border (the "done"
// treatment from the mock), and the CTA flips to a ghost Edit dates
// button instead of a quiet text link.

export interface SetDatesFlipCardProps {
  tripId: string;
  trip: TripData;
  /** Opens the existing DatesSheet — used by the Poll branch (≥2 crew). */
  onOpenDatesSheet?: () => void;
  /** Navigate to the Crew tab — used by the Poll-branch <2 crew redirect. */
  onTabChange?: (tab: string) => void;
  /** Card min-height in px. FreshTripGuide passes this so all four step
   *  cards (this one and the three StepCards) share the same shape. */
  minHeight?: number;
}

type PickerTab = "pick" | "poll";

// Compact day cell so a 6-row month fits inside the flipped card.
const DAY_CELL_PX = 27;

export const SetDatesFlipCard: FC<SetDatesFlipCardProps> = ({
  tripId,
  trip,
  onOpenDatesSheet,
  onTabChange,
  minHeight,
}) => {
  const tint = DOMAIN_COLORS.home;
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<PickerTab>("pick");
  const utils = trpc.useUtils();

  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const crewCount = members.length;

  const datesSet = !!(trip.start_date && trip.end_date);
  const doneSummary = datesSet
    ? (() => {
        const range = formatDateRangeCompact(trip.start_date, trip.end_date);
        const nights = nightsBetween(
          atNoon(new Date(trip.start_date!)),
          atNoon(new Date(trip.end_date!)),
        );
        const days = nights + 1;
        return `${range}, ${days} ${days === 1 ? "day" : "days"}. These frame your whole itinerary.`;
      })()
    : null;

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

  // ── Done state — paint card with the accent-faint treatment ──────────
  const cardSurface: React.CSSProperties = datesSet
    ? {
        background: tint.faint,
        border: `1px solid ${tint.color}`,
      }
    : {
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      };
  // Preview area on the done state darkens for contrast vs the tinted
  // card surface; idle preview matches the StepCard preview surface.
  const previewSurface: React.CSSProperties = datesSet
    ? { background: "rgba(0,0,0,0.30)" }
    : { background: "var(--color-bt-base)" };

  // ── Front face (default + done) ──────────────────────────────────────
  const front: ReactNode = (
    <div className="flex h-full flex-col gap-3 p-3">
      <div
        className="flex flex-1 items-stretch justify-stretch overflow-hidden rounded-lg"
        style={{ ...previewSurface, minHeight: 120 }}
        aria-hidden="true"
      >
        <CalendarThumbnail accent={tint.color} />
      </div>

      {/* Title row — number badge / check inline */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
          style={{
            background: tint.faint,
            color: tint.color,
            border: `1px solid ${tint.color}`,
          }}
          aria-hidden="true"
        >
          {datesSet ? <Check size={12} strokeWidth={2.6} /> : 1}
        </span>
        <p
          className="text-[14px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          {datesSet ? "Dates set" : "Set your dates"}
        </p>
      </div>

      <p
        className="text-[12px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {datesSet
          ? doneSummary
          : "Pick a range or poll the crew. Sets the bookends everything else lands between."}
      </p>

      {/* CTA — primary teal for Set dates; ghost for Edit dates.
          `mt-auto` keeps it pinned to the bottom even if the preview
          area stops growing. */}
      <button
        type="button"
        onClick={() => setFlipped(true)}
        className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
        style={
          datesSet
            ? {
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }
            : {
                background: tint.color,
                color: "var(--color-bt-on-accent, #0d1f1a)",
              }
        }
        data-testid={datesSet ? "guide-step-dates-edit" : "guide-step-dates-cta"}
      >
        {datesSet ? (
          <Pencil size={14} strokeWidth={2} />
        ) : (
          <Calendar size={14} strokeWidth={2} />
        )}
        {datesSet ? "Edit dates" : "Set dates"}
      </button>
    </div>
  );

  // ── Back face (flipped — picker) ──────────────────────────────────────
  const back: ReactNode = (
    <div className="flex h-full flex-col p-3">
      {/* Title bar — keeps the "Set your dates" identity, X closes the flip */}
      <div className="mb-2 flex items-center justify-between">
        <p
          className="text-[14px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          Set your dates
        </p>
        <button
          type="button"
          onClick={() => setFlipped(false)}
          aria-label="Close picker"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
          data-testid="guide-dates-flip-back"
        >
          <X size={14} />
        </button>
      </div>

      {/* Pick / Poll tabs — full width segmented control */}
      <div
        className="mb-2 grid grid-cols-2 rounded-lg p-0.5"
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
              className="rounded-md py-1 text-center text-[11px] font-semibold transition-colors"
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
    <div className="relative" style={{ perspective: 1200, minHeight }}>
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 450ms cubic-bezier(.2,.8,.2,1)",
          minHeight,
        }}
        data-testid="guide-step-dates"
      >
        {/* Front */}
        <div
          className="rounded-xl"
          style={{
            ...cardSurface,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            overflow: "hidden",
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          className="absolute inset-0 rounded-xl"
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
