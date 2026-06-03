"use client";

import { useMemo, useState, type FC, type ReactNode } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  User,
  UserPlus,
  Vote,
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
  /** Opens the existing DatesSheet — only used as a deep fallback if the
   *  parent decides not to handle pollMode itself. With the inline poll
   *  builder we now expand the card in place via onPollExpand. */
  onOpenDatesSheet?: () => void;
  /** Navigate to the Crew tab — used by the Poll-branch <2 crew redirect. */
  onTabChange?: (tab: string) => void;
  /** Card min-height in px. FreshTripGuide passes this so all four step
   *  cards (this one and the three StepCards) share the same shape. */
  minHeight?: number;
  /** True when the parent has expanded this card to span the whole grid
   *  so the poll builder has room to grow horizontally. The card stays
   *  flipped to its back face while this is on. */
  pollMode?: boolean;
  /** Called when the user taps "Set up date poll →" with ≥2 crew. The
   *  parent flips pollMode on and re-renders the grid full-width. */
  onPollExpand?: () => void;
  /** Cancels poll mode and returns the parent to the regular 4-up grid. */
  onPollCancel?: () => void;
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
  pollMode = false,
  onPollExpand,
  onPollCancel,
}) => {
  const tint = DOMAIN_COLORS.home;
  // While pollMode is on, the card stays on its back face — the parent
  // has already widened the column, so flipping back to the front face
  // mid-poll would just show a stretched-out Set Dates card.
  const [flipped, setFlipped] = useState(false);
  const showBack = flipped || pollMode;
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

  // ── Done state — accent-faint vertical fade + accent-border outline.
  // Mirrors the .hiw-face.front.done treatment from the design spec:
  //   background: linear-gradient(180deg, accent-faint, transparent 60%);
  //   border-color: accent-border;
  const cardSurface: React.CSSProperties = datesSet
    ? {
        background:
          "linear-gradient(180deg, var(--color-bt-accent-faint), transparent 60%)",
        border: "1px solid var(--color-bt-accent-border)",
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
        className="flex items-stretch justify-stretch overflow-hidden rounded-lg"
        style={{ ...previewSurface, height: 130 }}
        aria-hidden="true"
      >
        <CalendarThumbnail accent={tint.color} />
      </div>

      {/* Title row — number badge / check inline. Done state inverts the
          badge: solid accent fill with dark checkmark ink (the rest of
          the cards' idle badges stay accent-faint with teal numerals). */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
          style={
            datesSet
              ? {
                  background: tint.color,
                  color: "var(--color-bt-on-accent, #0d1f1a)",
                }
              : {
                  background: tint.faint,
                  color: tint.color,
                  border: `1px solid ${tint.color}`,
                }
          }
          aria-hidden="true"
        >
          {datesSet ? <Check size={12} strokeWidth={2.8} /> : 1}
        </span>
        <p
          className="text-[15px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          {datesSet ? "Dates set" : "Set your dates"}
        </p>
      </div>

      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {datesSet
          ? doneSummary
          : "Pick a range or poll the crew. Sets the bookends everything else lands between."}
      </p>

      {/* Bottom slot — pre-completion this is the filled-accent "Set
          dates" CTA. Post-completion it becomes a teal confirmation
          chip ("✓ Set May 22-26") in the same shape as the other
          cards' CTAs so the row stays visually aligned. The chip is
          still clickable so editing remains one tap away — the
          user just gets a positive indicator instead of a hammer. */}
      <button
        type="button"
        onClick={() => setFlipped(true)}
        className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold transition-colors hover:bg-[rgba(255,255,255,0.04)]"
        style={
          datesSet
            ? {
                background: tint.faint,
                color: tint.color,
                border: `1px solid ${tint.color}`,
              }
            : {
                background: tint.color,
                color: "var(--color-bt-on-accent, #0d1f1a)",
              }
        }
        data-testid={datesSet ? "guide-step-dates-edit" : "guide-step-dates-cta"}
      >
        {datesSet ? (
          <Check size={14} strokeWidth={2.6} />
        ) : (
          <Calendar size={14} strokeWidth={2} />
        )}
        {datesSet
          ? `Set ${formatDateRangeCompact(trip.start_date, trip.end_date)}`
          : "Set dates"}
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
          onClick={() => {
            // Always cancel pollMode if active, so the parent collapses
            // the card back to its column; then flip back to the front.
            if (pollMode) onPollCancel?.();
            setFlipped(false);
          }}
          aria-label="Close picker"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
          data-testid="guide-dates-flip-back"
        >
          <X size={14} />
        </button>
      </div>

      {/* Pick / Poll tabs — full width segmented control. Hidden once
          the parent has committed to pollMode; the builder is a
          single-purpose surface and tab-switching mid-build is noise. */}
      {!pollMode && (
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
      )}

      {tab === "pick" && !pollMode ? (
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
        // Centered redirect — matches the no-crew Poll-tab mock.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
          <span
            className="inline-flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: tint.faint, color: tint.color }}
            aria-hidden="true"
          >
            <User size={22} strokeWidth={1.9} />
          </span>
          <p
            className="text-[15px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Add the crew first
          </p>
          <p
            className="text-[12px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            It's just you so far — invite at least one more person and
            you can poll everyone for the dates that work.
          </p>
          <button
            type="button"
            onClick={() => onTabChange?.("crew")}
            className="mt-1 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="guide-dates-poll-invite-crew"
          >
            <UserPlus size={14} strokeWidth={2.2} />
            Invite crew
          </button>
          <button
            type="button"
            onClick={() => setTab("pick")}
            className="text-[12px] transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="guide-dates-poll-fallback-pick"
          >
            or just pick the dates yourself
          </button>
        </div>
      ) : pollMode ? (
        <PollBuilderPlaceholder
          accent={tint.color}
          accentFaint={tint.faint}
          onCancel={() => {
            onPollCancel?.();
            // When the parent collapses the card back to its column,
            // we also flip back to the front face so the next open
            // starts clean.
            setFlipped(false);
          }}
          onOpenSheet={() => {
            onPollCancel?.();
            setFlipped(false);
            onOpenDatesSheet?.();
          }}
        />
      ) : (
        // ≥2 crew — same centered cadence as the no-crew state so the
        // Poll tab feels like one consistent surface across both modes.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
          <span
            className="inline-flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: tint.faint, color: tint.color }}
            aria-hidden="true"
          >
            <Vote size={22} strokeWidth={1.9} />
          </span>
          <p
            className="text-[15px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Poll the crew
          </p>
          <p
            className="text-[12px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Propose a few date ranges and the crew votes — pick a
            window, add a few more, then launch.
          </p>
          <button
            type="button"
            onClick={() => onPollExpand?.()}
            className="mt-1 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: tint.color,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="guide-dates-poll-launch"
          >
            <Vote size={14} strokeWidth={2.2} />
            Set up date poll
          </button>
          <button
            type="button"
            onClick={() => setTab("pick")}
            className="text-[12px] transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="guide-dates-poll-fallback-pick-withcrew"
          >
            or just pick the dates yourself
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="relative h-full w-full"
      style={{ perspective: 1200, minHeight }}
    >
      <div
        className="absolute inset-0 h-full w-full"
        style={{
          transformStyle: "preserve-3d",
          transform: showBack ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 450ms cubic-bezier(.2,.8,.2,1)",
        }}
        data-testid="guide-step-dates"
        data-pollmode={pollMode ? "true" : "false"}
      >
        {/* Front — absolutely positioned so it stretches to the wrapper's
            minHeight. Same treatment as the back face; without this, the
            front face sized to its content (~230px) while the wrapper
            held the 420px minHeight, so the card looked shorter than its
            siblings. */}
        <div
          className="absolute inset-0 rounded-xl"
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

  // Has the user's current selection matched the trip's already-saved
  // dates? If so we replace the Save row with a confirmation chip —
  // there's nothing to save until they change something. Compare
  // against the local YYYY-MM-DD parts so timezone offset (e.g. EDT,
  // -4h) doesn't shift the Date's .toISOString() back a day on the
  // trip's saved string.
  const localYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const sameAsInitial =
    !!initialStart &&
    !!initialEnd &&
    !!range.start &&
    !!range.end &&
    localYMD(range.start) === initialStart &&
    localYMD(range.end) === initialEnd;

  const initialRangeLabel =
    initialStart && initialEnd
      ? formatDateRangeCompact(initialStart, initialEnd)
      : "";

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

      {sameAsInitial ? (
        // Confirmation chip — selection matches what's already saved,
        // so there's nothing to commit. Same shape as the row's other
        // CTAs (full-width pill); reads as a positive indicator and
        // not as an action.
        <div
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-[11px] font-semibold"
          style={{
            background: accentFaint,
            color: accent,
            border: `1px solid ${accent}`,
          }}
          data-testid="guide-dates-confirm-chip"
        >
          <Check size={12} strokeWidth={2.6} />
          Set {initialRangeLabel}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span
            className="text-[10px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {nights != null
              ? `${nights} night${nights === 1 ? "" : "s"}`
              : "Pick a range"}
          </span>
          <div className="flex items-center gap-1.5">
            {/* Quiet Clear — only renders when something is selected.
                Wipes the working range so the user can start over
                without hunting through months to deselect. */}
            {(range.start || range.end) && (
              <button
                type="button"
                onClick={() => setRange({ start: null, end: null })}
                className="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
                data-testid="guide-dates-clear"
              >
                Clear
              </button>
            )}
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
      )}
    </div>
  );
}

// ── PollBuilderPlaceholder ───────────────────────────────────────────────
//
// First-cut inline poll builder rendered when the parent grid has
// expanded the Set Dates card to full width. Lays out a two-column row:
// the same InlineRangeCalendar on the left for picking a date range +
// a proposed-ranges rail on the right that grows horizontally as the
// user adds windows. Launch + Cancel sit in the footer. The polished
// design lands once the reference screenshot is back in play — this
// placeholder proves the layout (card expansion + horizontal growth)
// works and offers a working hand-off to the existing DatesSheet so
// the underlying feature stays usable while the inline build matures.

function PollBuilderPlaceholder({
  accent,
  accentFaint,
  onCancel,
  onOpenSheet,
}: {
  accent: string;
  accentFaint: string;
  onCancel: () => void;
  onOpenSheet: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="poll-builder">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-[14px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Set up the date poll
          </p>
          <p
            className="mt-1 text-[12px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Propose a few windows the crew can vote on. Add another date
            range to the right — the rail grows as you go.
          </p>
        </div>
      </div>

      {/* Inline builder canvas — left calendar / right proposed-ranges
          rail. Right side scrolls horizontally as proposals exceed the
          available width. */}
      <div
        className="flex flex-1 gap-3 overflow-hidden rounded-lg"
        style={{
          background: "var(--color-bt-base)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <div
          className="flex w-[280px] flex-shrink-0 items-center justify-center p-4 text-center"
          style={{ borderRight: "1px solid var(--color-bt-border)" }}
        >
          <p
            className="text-[12px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            The inline calendar lives here.
            <br />
            Pick a range and add it as a proposal.
          </p>
        </div>
        <div className="flex flex-1 items-center gap-3 overflow-x-auto p-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex h-full w-[170px] flex-shrink-0 flex-col items-center justify-center rounded-md text-center"
              style={{
                background: "var(--color-bt-card)",
                border: `1px dashed ${accent}`,
              }}
            >
              <p
                className="text-[11px] uppercase tracking-[0.08em]"
                style={{ color: accent }}
              >
                Proposal {n}
              </p>
              <p
                className="mt-1 text-[12px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                — pending —
              </p>
            </div>
          ))}
          <button
            type="button"
            className="flex h-full w-[120px] flex-shrink-0 flex-col items-center justify-center rounded-md text-[12px] font-medium transition-colors hover:bg-[var(--color-bt-card-raised)]"
            style={{
              border: `1px dashed var(--color-bt-border)`,
              color: "var(--color-bt-text-dim)",
            }}
          >
            + Add another
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
          data-testid="poll-builder-cancel"
        >
          Cancel
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSheet}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }}
            data-testid="poll-builder-handoff"
          >
            Open in dates sheet
          </button>
          <button
            type="button"
            disabled
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
            style={{
              background: accent,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="poll-builder-launch"
          >
            Launch poll
          </button>
          {/* accentFaint reserved for the highlighted-range fill that
              will sit on the inline calendar once it's wired up. */}
          <span className="sr-only" style={{ background: accentFaint }} />
        </div>
      </div>
    </div>
  );
}
