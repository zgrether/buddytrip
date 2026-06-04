"use client";

import { useMemo, useState, type FC, type ReactNode } from "react";
import {
  Calendar,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  User,
  UserPlus,
  Users,
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
  /** Navigate to the Crew tab — used by the Poll-branch <2 crew redirect. */
  onTabChange?: (tab: string) => void;
}

type PickerTab = "pick" | "poll";

// Compact row + cap so a 6-row month fits the flipped card without losing
// the round-cap / fill-bar styling shared with the lodging DatePicker.
//   ROW_H — height of the day row (the fill bar inset by 2px lives here)
//   CAP_PX — the round cap circle inside the row. Slightly narrower than
//   the row so the fill bar peeks out on either side of the cap, matching
//   the visual rhythm of <DatePicker> (which uses 36 / 32 at full size).
const ROW_H = 30;
const CAP_PX = 26;
// Dark ink on the accent fill — same token DatePicker uses; keeps cap
// text readable across every domain hue.
const CAP_TEXT = "var(--color-bt-on-accent, #0d1f1a)";

export const SetDatesFlipCard: FC<SetDatesFlipCardProps> = ({
  tripId,
  trip,
  onTabChange,
}) => {
  const tint = DOMAIN_COLORS.home;
  // Local flip state — the card sits on its front face until the owner
  // opens the picker, then flips to the back face. The poll surface
  // lives entirely upstream now (FreshTripGuide swaps to <DatePollCard>
  // at the section level when trip.poll_mode is true), so there's no
  // server-state-driven flip override here anymore.
  const [flipped, setFlipped] = useState(false);
  const showBack = flipped;
  const [tab, setTab] = useState<PickerTab>("pick");
  // Two-step confirm before launching a poll when dates are already
  // locked. Tapping "Set up date poll" while datesSet swaps the centered
  // Poll-tab content for a warning ("you already picked dates — this
  // will clear them"). Confirming clears the dates AND launches the
  // poll; cancel just dismisses the warning back to the pitch.
  const [confirmReplaceWithPoll, setConfirmReplaceWithPoll] = useState(false);
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

  // Clearing locked dates routes through datePoll.unlock — same procedure
  // DatesSheet uses for its Clear flow. It wipes start_date / end_date
  // back to null and deletes the underlying window if it had no votes
  // (so we don't leave orphan windows behind when an owner sets a range
  // directly and then changes their mind). Used by the calendar's Clear
  // button when the trip has dates saved: clears the working selection
  // AND the DB row in one action.
  const clearLockedDates = trpc.datePoll.unlock.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, start_date: null, end_date: null } : old,
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      // Clearing dates resets the guide: flip back to the front face and
      // reset the picker tab. Without this the card stays stranded on the
      // (now empty) date-setter calendar instead of returning to the
      // resting "Set dates" pitch.
      setFlipped(false);
      setTab("pick");
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // Flips trip.poll_mode = true the instant the owner taps "Set up date
  // poll". Doing this server-side here — instead of waiting for the first
  // window to land — means:
  //   1. The home tab's pollMode derivation (trip.poll_mode || local) is
  //      true everywhere, not just on this owner's screen, so members
  //      who open the trip see the empty-state poll surface immediately.
  //   2. The card stays expanded across navigation / reload, even with
  //      zero windows yet — local state alone wouldn't survive that.
  // Optimistic so the UI doesn't bounce between the resting Set Dates
  // pitch and the poll surface while the round-trip lands.
  const activatePoll = trpc.datePoll.setPollMode.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, poll_mode: true } : old,
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
          dates" CTA. Post-completion it becomes "Edit dates" in the
          same ghost outline used by the other steps' done CTAs (the
          actual date range is reinforced on the back face via the
          confirmation chip in the picker footer, so we don't need to
          double-print it here). */}
      <button
        type="button"
        onClick={() => setFlipped(true)}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold transition-colors hover:bg-[rgba(255,255,255,0.04)]"
        style={
          datesSet
            ? {
                background: "transparent",
                color: tint.color,
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

      {/* Pick / Poll tabs — mirrors the ModeButton segmented control in
          DatesSheet (the trip dates modal). Same wrapper (rounded-xl +
          border + overflow-hidden), same active treatment (card-float
          surface), same vertical 1px divider between the two halves.
          Labels are shortened to "Pick" / "Poll" because the full
          "Pick dates" / "Poll the crew" don't fit the card-column width
          alongside the leading icons. */}
      <div
        className="mb-3 flex overflow-hidden rounded-xl"
        style={{ border: "1px solid var(--color-bt-border)" }}
      >
        <FlipModeButton
          active={tab === "pick"}
          onClick={() => setTab("pick")}
          icon={<CalendarCheck size={13} />}
          label="Pick"
          testId="guide-dates-tab-pick"
        />
        <div
          className="w-px self-stretch"
          style={{ background: "var(--color-bt-border)" }}
        />
        <FlipModeButton
          active={tab === "poll"}
          onClick={() => setTab("poll")}
          icon={<Users size={13} />}
          label="Poll"
          testId="guide-dates-tab-poll"
        />
      </div>

      {tab === "pick" ? (
        <InlineRangeCalendar
          initialStart={trip.start_date ?? null}
          initialEnd={trip.end_date ?? null}
          saving={lockDates.isPending}
          clearing={clearLockedDates.isPending}
          accent={tint.color}
          accentFaint={tint.faint}
          onSave={(start, end) =>
            lockDates.mutate({
              tripId,
              startDate: start.toISOString().slice(0, 10),
              endDate: end.toISOString().slice(0, 10),
            })
          }
          // When dates were already saved, Clear wipes them in the DB too —
          // not just the working selection. Without this the calendar
          // would visually empty but the trip would still show the same
          // bookends elsewhere in the app.
          onClearSaved={
            datesSet ? () => clearLockedDates.mutate({ tripId }) : undefined
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
            It&rsquo;s just you so far — invite at least one more person
            and you can poll everyone for the dates that work.
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
      ) : confirmReplaceWithPoll ? (
        // ≥2 crew + dates already locked + owner tapped "Set up date
        // poll": red-tinted warning that committing the poll will clear
        // the existing dates. Both the lock and the (now blank) date
        // need to be wiped so the poll surface renders cleanly — the
        // server's datePoll.unlock handles both (start_date/end_date
        // null + drops the locked window). Then activatePoll launches.
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 px-3 text-center"
          data-testid="guide-dates-poll-confirm"
        >
          <span
            className="inline-flex h-12 w-12 items-center justify-center rounded-full"
            style={{
              background: "var(--color-bt-danger-faint)",
              color: "var(--color-bt-danger)",
            }}
            aria-hidden="true"
          >
            <Vote size={22} strokeWidth={1.9} />
          </span>
          <p
            className="text-[15px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            Start a poll instead?
          </p>
          <p
            className="text-[12px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            You&rsquo;ve already picked dates for this trip. Starting a
            poll will clear them and ask the crew which window works
            best.
          </p>
          <div className="mt-1 flex w-full max-w-xs items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmReplaceWithPoll(false)}
              className="flex-1 rounded-lg py-2 text-[12px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
              data-testid="guide-dates-poll-confirm-cancel"
            >
              Keep dates
            </button>
            <button
              type="button"
              onClick={() => {
                // Clear the locked dates (also drops the unvoted
                // backing window) then launch the poll. Sequential to
                // avoid the same race the DatesSheet save flow had
                // (concurrent endPoll + lockDates could leave dangling
                // state). Optimistic updates inside each mutation
                // keep the UI snappy.
                clearLockedDates.mutate(
                  { tripId },
                  {
                    onSettled: () => {
                      if (!trip.poll_mode) {
                        activatePoll.mutate({ tripId, pollMode: true });
                      }
                      setConfirmReplaceWithPoll(false);
                    },
                  },
                );
              }}
              disabled={clearLockedDates.isPending || activatePoll.isPending}
              className="flex-1 rounded-lg py-2 text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                background: "var(--color-bt-danger)",
                color: "#ffffff",
              }}
              data-testid="guide-dates-poll-confirm-proceed"
            >
              {clearLockedDates.isPending || activatePoll.isPending
                ? "Starting…"
                : "Start poll"}
            </button>
          </div>
        </div>
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
            onClick={() => {
              // When dates are already locked, route through the
              // confirm tray first — clearing the existing pick is a
              // destructive side-effect the owner needs to opt into,
              // not a silent consequence of starting a poll.
              if (datesSet) {
                setConfirmReplaceWithPoll(true);
                return;
              }
              // activatePoll flips trip.poll_mode server-side; the
              // optimistic cache write inside the mutation makes the
              // takeover feel instant for everyone watching the trip
              // (FreshTripGuide swaps to <DatePollCard> on its next
              // render).
              if (!trip.poll_mode) {
                activatePoll.mutate({ tripId, pollMode: true });
              }
            }}
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

  // Calendar + presets + Save row need ≈420px of vertical room. We only
  // pin that height while the back face is up; the front face sizes
  // to its own content so we don't push the resting card taller than
  // it needs to be.
  const FLIPPED_MIN_H = 420;

  return (
    <div className="relative" style={{ perspective: 1200 }}>
      <div
        className="relative w-full"
        style={{
          transformStyle: "preserve-3d",
          transform: showBack ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 450ms cubic-bezier(.2,.8,.2,1)",
          minHeight: showBack ? FLIPPED_MIN_H : undefined,
        }}
        data-testid="guide-step-dates"
      >
        {/* Front — sizes to its own content. Not absolute so it
            collapses cleanly when the back face's minHeight isn't
            applied. */}
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
        {/* Back — absolute inset-0; relies on the wrapper's minHeight
            (set above only when showBack) to give it vertical room. */}
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

// ── FlipModeButton ───────────────────────────────────────────────────────
//
// Half of the Pick / Poll segmented control on the flip card's back face.
// Mirrors DatesSheet's ModeButton (icon + label, card-float surface when
// active, transparent + dim when not) but sized down a touch — smaller
// gap, font-size, py — so the row fits the card column without wrapping.

function FlipModeButton({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex flex-1 items-center justify-center gap-1.5 py-2 text-[12px] font-semibold transition-colors"
      style={
        active
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
      {icon}
      {label}
    </button>
  );
}

// ── InlineRangeCalendar ──────────────────────────────────────────────────

function InlineRangeCalendar({
  initialStart,
  initialEnd,
  saving,
  clearing = false,
  accent,
  accentFaint,
  onSave,
  onClearSaved,
}: {
  initialStart: string | null;
  initialEnd: string | null;
  saving: boolean;
  /** True while the parent's clear mutation is in flight — disables the
   *  Clear button so a double-tap can't fire twice. */
  clearing?: boolean;
  accent: string;
  accentFaint: string;
  onSave: (start: Date, end: Date) => void;
  /** Called when the user taps Clear AND the trip already had dates
   *  locked. The picker wipes the working selection locally; this
   *  callback wipes the persisted dates in the DB so the rest of the
   *  app reflects the cleared state too. Undefined when the trip has
   *  no locked dates (then Clear just resets the local selection). */
  onClearSaved?: () => void;
}) {
  const today = atNoon(new Date());
  const [range, setRange] = useState<DateRange>(() => ({
    start: initialStart ? atNoon(new Date(initialStart)) : null,
    end: initialEnd ? atNoon(new Date(initialEnd)) : null,
  }));
  const [view, setView] = useState<Date>(() =>
    range.start ? startOfMonth(range.start) : startOfMonth(today),
  );
  // Hover state for the day cells. Mirrors the lodging DatePicker (and
  // DatesSheet's FullRangeCalendar) — non-cap in-bounds days draw a 1px
  // inset accent ring on hover so the pointer always reads as a primed
  // target. Kept at this compact picker too for consistency.
  const [hovered, setHovered] = useState<Date | null>(null);

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
      {/* Presets — round-pill quick selections. Same shape as the lodging
          DatePicker (src/components/DatePicker.tsx) but with slightly
          smaller padding to keep the wrap to one row in the narrow card
          column. */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setRange(p.range);
              if (p.range.start) setView(startOfMonth(p.range.start));
            }}
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
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

      {/* Weekday header — same SMTWTFS row used by DatePicker, just sized
          smaller to match the row height below. */}
      <div className="grid grid-cols-7">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <div
            key={`${w}-${i}`}
            className="flex h-5 items-center justify-center text-[9px] font-semibold uppercase"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid — same round-cap + fill-bar pattern as the lodging
          DatePicker (src/components/DatePicker.tsx). Each cell is a
          positioned row; the in-range fill is an inset bar that sits
          BEHIND the round cap, with the bar clipped to half the cell on
          either side of a cap so the cap appears to float on a continuous
          range strip. Sized down to ROW_H/CAP_PX for the flip card. */}
      <div className="grid grid-cols-7">
        {matrix.flat().map((day, idx) => {
          const inMonth = day.getMonth() === view.getMonth();
          const isStart = isSameDay(day, range.start);
          const isEnd = isSameDay(day, range.end);
          const isCap = isStart || isEnd;
          const between = isWithinRange(day, range);
          const hasEnd = !!range.end;
          const isToday = isSameDay(day, today);
          // Continuous range fill: a bar behind the caps. Bar appears
          // when we're between the caps OR on a cap that has a partner
          // (start with an end set, or end itself).
          const showFill = between || (isStart && hasEnd) || isEnd;
          return (
            <div key={idx} className="relative" style={{ height: ROW_H }}>
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
                className="relative mx-auto flex items-center justify-center rounded-full text-[11px] transition-colors"
                style={{
                  width: CAP_PX,
                  height: CAP_PX,
                  background: isCap ? accent : "transparent",
                  color: isCap
                    ? CAP_TEXT
                    : inMonth
                      ? "var(--color-bt-text)"
                      : "var(--color-bt-text-dim)",
                  fontWeight: isCap ? 700 : 400,
                  opacity: inMonth ? 1 : 0.45,
                  // 1px teal inset ring on hover for non-cap days, same
                  // treatment as DatePicker / DatesSheet's full picker.
                  boxShadow:
                    isSameDay(day, hovered) && !isCap
                      ? `inset 0 0 0 1px ${accent}`
                      : "none",
                }}
                data-testid={`day-${day.toISOString().slice(0, 10)}`}
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

      {sameAsInitial ? (
        // Confirmation chip — selection matches what's already saved,
        // so there's nothing to commit. Same shape as the row's other
        // CTAs (full-width pill); reads as a positive indicator and
        // not as an action. Pairs with a quiet Clear link on the right
        // so the user still has an escape hatch — without it, dates
        // pre-populated from `initialStart/End` would be uncleanable
        // from this view (the local Clear branch below only renders
        // when the working range differs from the saved one).
        <div className="mt-2 flex items-center justify-between gap-2">
          <div
            className="flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-[11px] font-semibold"
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
          {onClearSaved && (
            <button
              type="button"
              disabled={clearing}
              onClick={() => {
                onClearSaved();
                setRange({ start: null, end: null });
              }}
              className="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
              style={{ color: "var(--color-bt-text-dim)" }}
              data-testid="guide-dates-clear-saved"
            >
              {clearing ? "Clearing…" : "Clear"}
            </button>
          )}
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
            {/* Quiet Clear — renders when something is selected OR when
                the trip already had saved dates. Wipes the working
                range; if onClearSaved was supplied (i.e. there are
                persisted dates) it also clears them in the DB so the
                rest of the app reflects the same empty state. */}
            {(range.start || range.end || !!onClearSaved) && (
              <button
                type="button"
                disabled={clearing}
                onClick={() => {
                  setRange({ start: null, end: null });
                  onClearSaved?.();
                }}
                className="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
                style={{ color: "var(--color-bt-text-dim)" }}
                data-testid="guide-dates-clear"
              >
                {clearing ? "Clearing…" : "Clear"}
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

