"use client";

// ── DatePollStackedCards ──────────────────────────────────────────────────
//
// New presentation layer for the date poll. Replaces the Doodle-style
// DatePollGrid with stacked option cards that scale from 4 to 20+ people
// without a wall-sized grid.
//
// Source of truth: HANDOFF-datepoll.md.
//
// What lives here:
//   • Owner view:
//       - One OptionCard per date_window. Collapsed shows: select radio,
//         date range, Most popular badge (trophy on the highest-yes
//         option, informational only), stacked tally bar + legend, expand
//         chevron.
//       - Expanded shows: roster grouped Yes / Maybe / No / Waiting as
//         avatar+name chips. Tapping any chip opens VotePopover (3-way
//         Yes/Maybe/No + Clear) so the owner can log answers for anyone,
//         including placeholders. Below the roster: quiet "Remove this
//         date option" with inline confirm when votes exist.
//       - "+ Add a date option" reveals an inline compact range calendar
//         (no modal) so the owner can add several back-to-back.
//       - Footer: primary "Lock in [range]" on the selected option +
//         quiet "Cancel this poll" link (escape hatch — confirm-gated
//         since it discards every vote).
//   • Member view:
//       - Per-window card with a Yes/Maybe/No segmented control. Their
//         pick highlights in its vote color (teal/amber/red). Faint
//         consensus line shows the group's leaning. No add/delete/lock/
//         cancel — members only set their own answer.
//
// The mutations themselves live in DatePollCard (the parent). This file
// is pure presentation + per-card local state. Callbacks fire upward
// when the user takes an action; DatePollCard runs the optimistic
// update + tRPC mutation.

import { useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  Calendar as CalendarIcon,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
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
import { parseLocalDate } from "@/lib/dates";
import type { PollMember, PollWindow, VoteAnswer } from "./DatePollGrid";

// ── Public types (re-export the bits callers already use) ────────────────

export type { PollMember, PollWindow, VoteAnswer } from "./DatePollGrid";

export interface DatePollStackedCardsProps {
  windows: PollWindow[];
  members: PollMember[];
  currentUserId: string;
  isOwner: boolean;
  /** Owner's display name — surfaced in the member empty state body
   *  ("{Owner} hasn't posted any windows…"). Falls back to a neutral
   *  noun upstream when the owner record isn't loaded yet. */
  ownerName?: string;
  /** Owner can vote for any member; non-owners can only vote for themselves.
   *  Caller enforces this; we just emit the chosen target. */
  onVote: (windowId: string, answer: VoteAnswer, userId: string) => void;
  /** Owner-only — caller passes the start/end strings; we own the inline
   *  calendar UI. */
  onAddWindow?: (startDate: string, endDate: string) => void;
  onRemoveWindow?: (windowId: string) => void;
  onLockWindow?: (windowId: string) => void;
  /** Owner-only — cancels the whole poll (windows + votes wiped). */
  onCancelPoll?: () => void;
  /** Owner / planner only — opens the Crew tab from the empty / managed-by
   *  affordances. */
  onManageCrew?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const ANSWERS: VoteAnswer[] = ["yes", "maybe", "no"];

const VOTE_BG: Record<NonNullable<VoteAnswer>, string> = {
  yes: "var(--color-bt-vote-yes)",
  maybe: "var(--color-bt-vote-maybe)",
  no: "var(--color-bt-vote-no)",
};
const VOTE_TEXT: Record<NonNullable<VoteAnswer>, string> = {
  // The vote-yes-text token exists for the yes pill specifically; for the
  // other two, dark + white reads cleanly across the brand palette.
  yes: "var(--color-bt-vote-yes-text, #0d1f1a)",
  maybe: "#0d1f1a",
  no: "#ffffff",
};
const VOTE_LABEL: Record<NonNullable<VoteAnswer>, string> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

function answerOf(window: PollWindow, userId: string | null): VoteAnswer {
  if (!userId) return null;
  const v = window.votes.find((x) => x.user_id === userId);
  if (!v || v.answer == null) return null;
  const a = v.answer as string;
  if (a === "yes" || a === "maybe" || a === "no") return a;
  return null;
}

function tallyOf(window: PollWindow, members: PollMember[]): {
  yes: number;
  maybe: number;
  no: number;
  waiting: number;
} {
  let yes = 0;
  let maybe = 0;
  let no = 0;
  let waiting = 0;
  for (const m of members) {
    const a = answerOf(window, m.user_id);
    if (a === "yes") yes++;
    else if (a === "maybe") maybe++;
    else if (a === "no") no++;
    else waiting++;
  }
  return { yes, maybe, no, waiting };
}

function fmtRangeShort(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

// Days-of-week + nights — e.g. "Fri – Tue · 4 nights". Used as the
// sub-label under the date range on each option card.
function fmtDaysAndNights(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const day = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short" });
  const nights = Math.round((e.getTime() - s.getTime()) / 86400000);
  return `${day(s)} – ${day(e)} · ${nights} night${nights === 1 ? "" : "s"}`;
}

// ── Component ────────────────────────────────────────────────────────────

export function DatePollStackedCards({
  windows,
  members,
  currentUserId,
  isOwner,
  ownerName = "The organizer",
  onVote,
  onAddWindow,
  onRemoveWindow,
  onLockWindow,
  onCancelPoll,
  onManageCrew,
}: DatePollStackedCardsProps) {
  // Which option the owner has selected to lock. Defaults to whichever is
  // currently the most popular so the primary CTA is meaningful from the
  // jump. Updated on radio click.
  const tallies = useMemo(
    () => Object.fromEntries(windows.map((w) => [w.id, tallyOf(w, members)])),
    [windows, members],
  );

  // The "Most popular" trophy lands on whichever option has the most yes
  // votes. Tie → no trophy (no false leader). Independent of selection.
  const mostPopularId = useMemo(() => {
    if (windows.length === 0) return null;
    const maxYes = Math.max(...windows.map((w) => tallies[w.id]?.yes ?? 0));
    if (maxYes === 0) return null;
    const top = windows.filter((w) => (tallies[w.id]?.yes ?? 0) === maxYes);
    if (top.length !== 1) return null;
    return top[0]!.id;
  }, [windows, tallies]);

  // No auto-selection: the owner explicitly taps a window's radio to pick
  // which one to lock (and can tap again to unselect). Lock only surfaces
  // once something is selected. The most-popular window still gets a badge,
  // but is never auto-selected.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Inline add-option calendar. Hidden by default; "+ Add a date option"
  // reveals it. Stays inline so the owner can fire several proposals
  // back-to-back without bouncing through a modal.
  const [addingOpen, setAddingOpen] = useState(false);

  // Cancel-poll confirm. Owner-only, red-bordered surface per HANDOFF.
  const [confirmCancelPoll, setConfirmCancelPoll] = useState(false);

  // Voted progress — used in the header strip. Counts members who've
  // weighed in on EVERY available window (matches "N of N voted" in spec).
  const votedCount = useMemo(() => {
    if (windows.length === 0) return 0;
    return members.filter((m) =>
      windows.every((w) => answerOf(w, m.user_id) != null),
    ).length;
  }, [windows, members]);

  // Cancel-poll affordance — owner only, available the moment the poll
  // exists (even with zero windows) so the owner can always back out to
  // direct date entry. Shared between the empty state and the footer.
  const cancelPollButton =
    isOwner && onCancelPoll ? (
      confirmCancelPoll ? (
        <CancelPollConfirm
          voteCount={windows.reduce((sum, w) => sum + w.votes.length, 0)}
          onKeep={() => setConfirmCancelPoll(false)}
          onConfirm={() => {
            onCancelPoll();
            setConfirmCancelPoll(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setConfirmCancelPoll(true)}
          className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{
            background: "transparent",
            color: "var(--color-bt-text-dim)",
            border: "1px solid var(--color-bt-border)",
          }}
          data-testid="poll-cancel-link"
        >
          Cancel this poll
        </button>
      )
    ) : null;

  // ── Empty state — no windows yet ─────────────────────────────────────
  if (windows.length === 0) {
    // When the owner has tapped "Add the first date option," the inline
    // picker takes over the empty-state slot entirely — no glyph, no
    // headline, no dashed frame. The dashed pitch is the affordance to
    // open the picker; once it's open, the picker IS the surface.
    if (isOwner && onAddWindow && addingOpen) {
      return (
        <InlineAddOption
          onCancel={() => setAddingOpen(false)}
          onAdd={(s, e) => {
            onAddWindow(s, e);
            setAddingOpen(false);
          }}
        />
      );
    }
    // Member empty state — clock glyph + "No date options yet" headline +
    // owner-attributed body. Members can't act here so we make the
    // surface read as "stand by," not as a target zone — same dashed
    // frame as the owner empty (visual consistency across roles).
    if (!isOwner) {
      return (
        <div
          className="rounded-xl px-6 py-10 text-center"
          style={{
            background: "transparent",
            border: "1px dashed var(--color-bt-border)",
          }}
          data-testid="poll-empty-state-member"
        >
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-border)",
            }}
            aria-hidden="true"
          >
            <Clock size={24} strokeWidth={1.9} />
          </div>
          <p className="text-[16px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
            No date options yet
          </p>
          <p
            className="mx-auto mt-2 max-w-md text-[13px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {ownerName} hasn&rsquo;t posted any windows to vote on. We&rsquo;ll
            let you know the moment they&rsquo;re up &mdash; nothing for you
            to do yet.
          </p>
        </div>
      );
    }
    // Owner empty state — calendar glyph + "Add the windows" pitch +
    // primary CTA that opens the inline picker (handled above). The
    // Cancel-poll escape hatch sits below so the owner can bail back to
    // direct date entry before adding any option.
    return (
      <div className="space-y-3" data-testid="poll-empty-owner">
      <div
        className="rounded-xl p-6 text-center"
        style={{
          // Transparent — the empty state sits flush against the
          // FreshTripGuide background. Keeps the dashed border so the
          // "Add the windows" affordance still reads as a target zone.
          background: "transparent",
          border: "1px dashed var(--color-bt-border)",
        }}
        data-testid="poll-empty-state"
      >
        <div
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
          aria-hidden="true"
        >
          <CalendarIcon size={22} strokeWidth={1.9} />
        </div>
        <p className="text-[15px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add the windows you&apos;re considering
        </p>
        <p
          className="mx-auto mt-1 max-w-md text-[13px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Drop in a few date ranges and the crew votes yes / maybe / no on
          each. You lock the one that works once it&apos;s clear.
        </p>
        {onAddWindow && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setAddingOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent, #0d1f1a)" }}
              data-testid="poll-empty-add"
            >
              <CalendarPlus size={14} strokeWidth={2} />
              Add the first date option
            </button>
          </div>
        )}
      </div>
      {cancelPollButton}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="poll-stacked-cards">
      {/* Voted progress strip — quietly shows momentum without competing
          with the cards. Hidden when there are no members to vote (e.g.
          solo trip mid-setup) since the math is uninteresting. */}
      {members.length > 0 && (
        <div className="flex items-center gap-3">
          <span
            className="text-[11px] font-semibold uppercase"
            style={{ color: "var(--color-bt-text-dim)", letterSpacing: "0.08em" }}
          >
            {votedCount} of {members.length} voted
          </span>
          <div
            className="h-1 flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--color-bt-card-raised)" }}
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${members.length === 0 ? 0 : Math.round((votedCount / members.length) * 100)}%`,
                background: "var(--color-bt-accent)",
              }}
            />
          </div>
        </div>
      )}

      {/* Stacked option cards. Each owns its own expanded/confirm state. */}
      <div className="space-y-2.5">
        {windows.map((w, i) => (
          <OptionCard
            key={w.id}
            window={w}
            members={members}
            currentUserId={currentUserId}
            isOwner={isOwner}
            isSelected={selectedId === w.id}
            isMostPopular={mostPopularId === w.id}
            // First option opens expanded so a freshly-added window shows
            // its voting controls without a tap. Selection stays explicit.
            defaultExpanded={i === 0}
            tally={tallies[w.id]!}
            onSelect={() =>
              setSelectedId((cur) => (cur === w.id ? null : w.id))
            }
            onVote={onVote}
            onRemove={onRemoveWindow ? () => onRemoveWindow(w.id) : undefined}
            onManageCrew={onManageCrew}
          />
        ))}
      </div>

      {/* "+ Add a date option" — owner only. Inline calendar takes over
          this row when revealed (matches HANDOFF "back to the list so the
          owner can add several back-to-back"). */}
      {isOwner && onAddWindow && (
        addingOpen ? (
          <InlineAddOption
            onCancel={() => setAddingOpen(false)}
            onAdd={(s, e) => {
              onAddWindow(s, e);
              setAddingOpen(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "transparent",
              color: "var(--color-bt-accent)",
              border: "none",
            }}
            data-testid="poll-add-option"
          >
            <Plus size={14} />
            Add a date option
          </button>
        )
      )}

      {/* Footer — owner only. Primary Lock action (shown once there's a
          window to lock) plus the quiet Cancel-poll escape hatch, which
          stays present regardless of selection. Members get a separate
          "Save my answers" CTA on the per-card segmented control (votes
          save on click), so no dedicated footer is needed. */}
      {isOwner && (
        <div className="space-y-2 pt-1">
          {onLockWindow && selectedId && (
            <button
              type="button"
              onClick={() => onLockWindow(selectedId)}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold transition-opacity hover:opacity-90"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-on-accent, #0d1f1a)",
              }}
              data-testid="poll-lock"
            >
              <Check size={16} strokeWidth={2.6} />
              Lock in {(() => {
                const w = windows.find((x) => x.id === selectedId);
                return w ? fmtRangeShort(w.start_date, w.end_date) : "selected dates";
              })()}
            </button>
          )}
          {cancelPollButton}
        </div>
      )}
    </div>
  );
}

// ── OptionCard ───────────────────────────────────────────────────────────

function OptionCard({
  window: w,
  members,
  currentUserId,
  isOwner,
  isSelected,
  isMostPopular,
  defaultExpanded = false,
  tally,
  onSelect,
  onVote,
  onRemove,
  onManageCrew,
}: {
  window: PollWindow;
  members: PollMember[];
  currentUserId: string;
  isOwner: boolean;
  isSelected: boolean;
  isMostPopular: boolean;
  defaultExpanded?: boolean;
  tally: { yes: number; maybe: number; no: number; waiting: number };
  onSelect: () => void;
  onVote: (windowId: string, answer: VoteAnswer, userId: string) => void;
  onRemove?: () => void;
  onManageCrew?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Two-step delete for cards with existing votes — matches HANDOFF
  // "Remove this option? N votes discarded." inline confirm.
  const [confirmRemove, setConfirmRemove] = useState(false);

  const myAnswer = answerOf(w, currentUserId);
  const memberView = !isOwner;

  // ── Member card layout — no select radio, no roster expand. Just the
  // date + Yes/Maybe/No segmented control + faint consensus line. The
  // expanded roster is owner-only by spec. ──────────────────────────
  if (memberView) {
    return (
      <div
        className="rounded-xl p-3.5"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
        data-testid={`poll-option-${w.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {fmtRangeShort(w.start_date, w.end_date)}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {fmtDaysAndNights(w.start_date, w.end_date)}
            </p>
            {isMostPopular && (
              <div className="mt-2">
                <MostPopularBadge />
              </div>
            )}
          </div>
        </div>

        {/* Faint consensus line — shows the group's leaning without
            making the page about everyone else's votes. */}
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {tally.yes} yes · {tally.maybe} maybe · {tally.no} no
          {tally.waiting > 0 ? ` · ${tally.waiting} waiting` : ""}
        </p>

        {/* Yes / Maybe / No segmented control — sets the member's own
            answer directly. Highlighted in the vote color when picked.
            Tapping the active one again clears it (toggle off). */}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {ANSWERS.map((ans) => {
            const active = myAnswer === ans;
            return (
              <button
                key={ans}
                type="button"
                onClick={() => onVote(w.id, active ? null : ans, currentUserId)}
                className="rounded-lg py-2 text-[13px] font-semibold transition-colors"
                style={
                  active
                    ? { background: VOTE_BG[ans!], color: VOTE_TEXT[ans!] }
                    : {
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text-dim)",
                        border: "1px solid var(--color-bt-border)",
                      }
                }
                data-testid={`poll-vote-${w.id}-${ans}`}
              >
                {VOTE_LABEL[ans!]}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Owner card layout ─────────────────────────────────────────────
  // Selection signals only through the border: a 1px accent stroke
  // around the card + the filled accent radio. The card background
  // stays neutral (no accent-faint fill) so the row reads against the
  // rest of the panel without a competing surface.
  const tintBorder = isSelected
    ? "var(--color-bt-accent)"
    : "var(--color-bt-border)";

  return (
    <div
      className="rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: `1px solid ${tintBorder}`,
        transition: "border-color 150ms",
      }}
      data-testid={`poll-option-${w.id}`}
    >
      {/* Collapsed header — radio | left column (range + days/nights +
          Most popular badge) | right column (tally bar + vote count) |
          chevron. The whole row is the expand target; the radio
          handles its own click (stopPropagation) so selecting doesn't
          also expand. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 p-3.5 text-left"
      >
        {/* Radio — owner picks which option to lock. */}
        <span
          role="radio"
          aria-checked={isSelected}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              onSelect();
            }
          }}
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors"
          style={{
            background: isSelected ? "var(--color-bt-accent)" : "transparent",
            border: `1.5px solid ${isSelected ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
            color: "var(--color-bt-on-accent, #0d1f1a)",
            cursor: "pointer",
          }}
          data-testid={`poll-radio-${w.id}`}
        >
          {isSelected && <Check size={12} strokeWidth={3} />}
        </span>

        {/* Body column — fills the row between the radio and the
            chevron. Date range / days+nights / Most popular badge
            stacked at top; full-width tally bar + per-bucket count
            run beneath them so the bar stretches across the entire
            content area (including the date area) rather than living
            in a constrained right rail. */}
        <div className="min-w-0 flex-1">
          <p
            className="text-[14px] font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            {fmtRangeShort(w.start_date, w.end_date)}
          </p>
          <p
            className="mt-0.5 text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {fmtDaysAndNights(w.start_date, w.end_date)}
          </p>
          {isMostPopular && (
            <div className="mt-2">
              <MostPopularBadge />
            </div>
          )}
          <TallyBar tally={tally} className="mt-3" />
          <p
            className="mt-1.5 text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <VoteCount n={tally.yes} kind="yes" /> ·{" "}
            <VoteCount n={tally.maybe} kind="maybe" /> ·{" "}
            <VoteCount n={tally.no} kind="no" />
            {tally.waiting > 0 && <> · <span>{tally.waiting} waiting</span></>}
          </p>
        </div>

        {/* Chevron — rotated when expanded. Pure indicator; the whole
            header is the click target. */}
        <ChevronDown
          size={18}
          className="mt-1 flex-shrink-0 transition-transform"
          style={{
            color: "var(--color-bt-text-dim)",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
          aria-hidden="true"
        />
      </button>

      {/* Expanded — roster grouped by answer + remove affordance. */}
      {expanded && (
        <div
          className="space-y-3 px-3.5 pb-3.5"
          style={{ borderTop: "1px solid var(--color-bt-border)", paddingTop: 12 }}
        >
          <RosterGroup
            label="Yes"
            answer="yes"
            members={members}
            currentUserId={currentUserId}
            window={w}
            onVote={onVote}
          />
          <RosterGroup
            label="Maybe"
            answer="maybe"
            members={members}
            currentUserId={currentUserId}
            window={w}
            onVote={onVote}
          />
          <RosterGroup
            label="No"
            answer="no"
            members={members}
            currentUserId={currentUserId}
            window={w}
            onVote={onVote}
          />
          <RosterGroup
            label="Waiting"
            answer={null}
            members={members}
            currentUserId={currentUserId}
            window={w}
            onVote={onVote}
          />

          <p className="text-[11px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
            Tap anyone to set their answer — including placeholders.
            {onManageCrew && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onManageCrew}
                  className="not-italic transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  Manage crew →
                </button>
              </>
            )}
          </p>

          {/* Remove affordance — quiet by default, inline confirm when
              the option has votes (HANDOFF: "Remove this option? N
              votes discarded."). No-vote options skip the confirm. */}
          {onRemove && (
            <div
              className="pt-2"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              {confirmRemove ? (
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{
                    background: "var(--color-bt-danger-faint)",
                    border: "1px solid var(--color-bt-danger-border)",
                  }}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] font-medium"
                    style={{ color: "var(--color-bt-danger)" }}
                  >
                    Remove this option?
                    {w.votes.length > 0
                      ? ` ${w.votes.length} vote${w.votes.length === 1 ? "" : "s"} discarded.`
                      : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    className="rounded-md px-2 py-1 text-[12px] font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--color-bt-text-dim)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRemove();
                      setConfirmRemove(false);
                    }}
                    className="rounded-md px-2 py-1 text-[12px] font-semibold"
                    style={{ background: "var(--color-bt-danger)", color: "#ffffff" }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (w.votes.length === 0) onRemove();
                    else setConfirmRemove(true);
                  }}
                  className="flex items-center gap-1.5 text-[12px] font-medium transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-bt-text-dim)" }}
                  data-testid={`poll-remove-${w.id}`}
                >
                  <Trash2 size={12} />
                  Remove this date option
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TallyBar ─────────────────────────────────────────────────────────────

function TallyBar({
  tally,
  className,
}: {
  tally: { yes: number; maybe: number; no: number; waiting: number };
  className?: string;
}) {
  const total = tally.yes + tally.maybe + tally.no + tally.waiting;
  if (total === 0) {
    return (
      <div
        className={`h-2 w-full overflow-hidden rounded-full ${className ?? ""}`}
        style={{ background: "var(--color-bt-card-raised)" }}
        aria-hidden="true"
      />
    );
  }
  const pct = (n: number) => (n / total) * 100;
  return (
    <div
      className={`flex h-2 w-full overflow-hidden rounded-full ${className ?? ""}`}
      style={{ background: "var(--color-bt-card-raised)" }}
      aria-hidden="true"
    >
      <div style={{ width: `${pct(tally.yes)}%`, background: VOTE_BG.yes }} />
      <div style={{ width: `${pct(tally.maybe)}%`, background: VOTE_BG.maybe }} />
      <div style={{ width: `${pct(tally.no)}%`, background: VOTE_BG.no }} />
      {/* waiting is the visible trough — no inline div, the bar background
          shows through. */}
    </div>
  );
}

function VoteCount({ n, kind }: { n: number; kind: NonNullable<VoteAnswer> }) {
  return (
    <span style={{ color: VOTE_BG[kind], fontWeight: 600 }}>
      {n} {kind}
    </span>
  );
}

function MostPopularBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
      style={{
        background: "var(--color-bt-vote-yes)",
        color: "var(--color-bt-vote-yes-text, #0d1f1a)",
        letterSpacing: "0.06em",
      }}
      title="The option with the most yes votes"
      aria-label="Most popular"
    >
      <Trophy size={10} strokeWidth={2.4} />
      Most popular
    </span>
  );
}

// ── RosterGroup ──────────────────────────────────────────────────────────
//
// A single answer-bucket row in the expanded option card. Renders the
// label + a wrapping row of member chips. Tapping a chip opens
// VotePopover (owner can re-bucket anyone, including placeholders).

function RosterGroup({
  label,
  answer,
  members,
  currentUserId,
  window: w,
  onVote,
}: {
  label: string;
  answer: VoteAnswer;
  members: PollMember[];
  currentUserId: string;
  window: PollWindow;
  onVote: (windowId: string, answer: VoteAnswer, userId: string) => void;
}) {
  const inBucket = members.filter((m) => answerOf(w, m.user_id) === answer);
  if (inBucket.length === 0) return null;

  return (
    <div>
      <p
        className="mb-1.5 text-[10px] font-semibold uppercase"
        style={{
          color: answer ? VOTE_BG[answer] : "var(--color-bt-text-dim)",
          letterSpacing: "0.08em",
        }}
      >
        {label} · {inBucket.length}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {inBucket.map((m) => (
          <MemberChip
            key={`${m.user_id ?? m.displayName}-${w.id}`}
            member={m}
            isYou={!!m.user_id && m.user_id === currentUserId}
            currentAnswer={answer}
            onSetAnswer={(ans) => onVote(w.id, ans, m.user_id ?? "")}
          />
        ))}
      </div>
    </div>
  );
}

// ── MemberChip + VotePopover ─────────────────────────────────────────────

function MemberChip({
  member,
  isYou,
  currentAnswer,
  onSetAnswer,
}: {
  member: PollMember;
  isYou: boolean;
  currentAnswer: VoteAnswer;
  onSetAnswer: (a: VoteAnswer) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isPlaceholder = !member.user_id;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[11px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {/* Standard app Avatar — sm=30/34px is too large for an inline
            chip, so we hand it an explicit 22px sizePx. Placeholders
            stay muted (gray) so the teal foreground reads as "real
            actionable identity"; the placeholder PH tag below carries
            the explicit labelling. */}
        <Avatar
          name={member.displayName}
          avatarIcon={member.avatarIcon ?? null}
          sizePx={22}
          muted={isPlaceholder}
        />
        <span className="truncate" style={{ maxWidth: 120 }}>
          {member.displayName}
          {isYou && (
            <span style={{ color: "var(--color-bt-text-dim)" }}> (you)</span>
          )}
        </span>
        {isPlaceholder && (
          <span
            className="rounded px-1 text-[8px] font-bold uppercase"
            style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)" }}
            title="Placeholder — owner-managed"
          >
            PH
          </span>
        )}
      </button>

      {open && (
        <VotePopover
          currentAnswer={currentAnswer}
          onPick={(ans) => {
            onSetAnswer(ans);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function VotePopover({
  currentAnswer,
  onPick,
  onClose,
}: {
  currentAnswer: VoteAnswer;
  onPick: (a: VoteAnswer) => void;
  onClose: () => void;
}) {
  // Tiny click-outside via global mousedown listener. The popover is
  // absolute-positioned beneath the chip so the rect is anchored
  // naturally; no portal needed for the small surface.
  const ref = useRef<HTMLDivElement | null>(null);
  useMemo(() => {
    if (typeof document === "undefined") return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-20 mt-1.5 flex items-center gap-1 rounded-lg p-1"
      style={{
        background: "var(--color-bt-card-float)",
        border: "1px solid var(--color-bt-border)",
        boxShadow: "var(--shadow-floating)",
      }}
      role="menu"
    >
      {ANSWERS.map((ans) => {
        const active = currentAnswer === ans;
        return (
          <button
            key={ans}
            type="button"
            onClick={() => onPick(ans)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              color: VOTE_BG[ans!],
              background: active ? "var(--color-bt-hover)" : "transparent",
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: VOTE_BG[ans!] }}
              aria-hidden="true"
            />
            {VOTE_LABEL[ans!]}
            {active && <Check size={12} strokeWidth={2.6} />}
          </button>
        );
      })}
      <div
        className="mx-1 h-4 w-px"
        style={{ background: "var(--color-bt-border)" }}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => onPick(null)}
        className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Clear
      </button>
    </div>
  );
}

// ── InlineAddOption — compact range calendar to add a date window ────────

function InlineAddOption({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (startDate: string, endDate: string) => void;
}) {
  const today = useMemo(() => atNoon(new Date()), []);
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [view, setView] = useState<Date>(startOfMonth(today));
  const [hovered, setHovered] = useState<Date | null>(null);

  const matrix = useMemo(() => monthMatrix(view), [view]);
  const presets = useMemo(() => rangePresets(today), [today]);
  const nights = range.start && range.end ? nightsBetween(range.start, range.end) : null;
  const monthLabel = view.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const accent = "var(--color-bt-accent)";
  const accentFaint = "var(--color-bt-accent-faint)";

  const localYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const handleDayClick = (day: Date) => {
    if (isOutOfBounds(day, null, null)) return;
    setRange((cur) => applyRangeClick(cur, day));
  };

  const canAdd = !!(range.start && range.end);

  return (
    <div
      className="rounded-xl p-3"
      style={{
        // Constrained width so the inline picker reads as a popover
        // anchored to the row, not as a full-bleed banner. ~320px matches
        // the lodging DatePicker popover footprint per HANDOFF spec.
        maxWidth: 320,
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
      data-testid="poll-add-inline"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add a date option
        </p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Presets */}
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

      {/* Month nav */}
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setView((v) => addMonths(v, -1))}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[11px] font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {monthLabel}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView((v) => addMonths(v, 1))}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="flex h-5 items-center justify-center text-[9px] font-semibold uppercase"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — round caps + fill bar, same vocab as the lodging
          DatePicker. Sized for the compact inline use. */}
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
            <div key={idx} className="relative" style={{ height: 30 }}>
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
                  width: 26,
                  height: 26,
                  background: isCap ? accent : "transparent",
                  color: isCap
                    ? "var(--color-bt-on-accent, #0d1f1a)"
                    : inMonth
                      ? "var(--color-bt-text)"
                      : "var(--color-bt-text-dim)",
                  fontWeight: isCap ? 700 : 400,
                  opacity: inMonth ? 1 : 0.45,
                  boxShadow:
                    isSameDay(day, hovered) && !isCap
                      ? `inset 0 0 0 1px ${accent}`
                      : "none",
                }}
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

      {/* Footer — live summary + Cancel/Add */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {nights != null
            ? `${nights} night${nights === 1 ? "" : "s"}`
            : range.start
              ? "Pick an end date"
              : "Pick a range"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              if (range.start && range.end) {
                onAdd(localYMD(range.start), localYMD(range.end));
              }
            }}
            className="rounded-md px-3 py-1 text-[11px] font-semibold transition-opacity disabled:opacity-40"
            style={{
              background: accent,
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="poll-add-confirm"
          >
            Add option
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CancelPollConfirm ────────────────────────────────────────────────────
//
// Inline confirm for "Cancel this poll". Renders as a red-bordered tray
// in place of the quiet text link. Matches HANDOFF's red-bordered
// confirm shape.

function CancelPollConfirm({
  voteCount,
  onKeep,
  onConfirm,
}: {
  voteCount: number;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-left"
      style={{
        background: "var(--color-bt-danger-faint)",
        border: "1px solid var(--color-bt-danger-border)",
      }}
    >
      <span
        className="min-w-0 flex-1 text-[12px] leading-snug"
        style={{ color: "var(--color-bt-danger)" }}
      >
        Cancel the date poll? All proposed dates
        {voteCount > 0 ? ` and ${voteCount} vote${voteCount === 1 ? "" : "s"}` : ""}{" "}
        will be discarded.
      </span>
      <button
        type="button"
        onClick={onKeep}
        className="rounded-md px-2 py-1 text-[12px] font-medium"
        style={{
          background: "transparent",
          color: "var(--color-bt-text-dim)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        Keep polling
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-md px-2 py-1 text-[12px] font-semibold"
        style={{ background: "var(--color-bt-danger)", color: "#ffffff" }}
        data-testid="poll-cancel-confirm"
      >
        Cancel poll
      </button>
    </div>
  );
}
