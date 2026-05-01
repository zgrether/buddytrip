"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, CalendarPlus, Check, CheckCircle2, Trash2 } from "lucide-react";
import { parseLocalDate } from "@/lib/dates";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";

export type VoteAnswer = "yes" | "maybe" | "no" | null;

export interface PollWindowVote {
  window_id: string;
  user_id: string;
  answer: string;
  created_at: string;
}

export interface PollWindow {
  id: string;
  trip_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  votes: PollWindowVote[];
}

export interface PollMember {
  user_id: string | null;
  displayName: string;
  avatarUrl?: string | null;
}

export interface DatePollGridProps {
  dateWindows: PollWindow[];
  members: PollMember[];
  currentUserId: string;
  /**
   * Owner only. Controls every admin affordance on the grid: column
   * popover (Select / Remove), add-date column, voting on behalf of other
   * crew members, un-dimmed rendering of other rows. Non-owners see a
   * read-only surface where only their own row is interactive.
   */
  isOwner: boolean;
  /** Fires with the target member's user_id. For non-owners this is always the current user. */
  onVote: (dateWindowId: string, answer: VoteAnswer, userId: string) => void;
  // isOwner-only — optional so caller can omit for non-owner grids
  onAddDateWindow?: () => void;
  onRemoveDateWindow?: (id: string) => void;
  onLockDateWindow?: (id: string) => void;
  /** Owner / planner only — navigates to the Crew tab when provided. */
  onManageCrew?: () => void;
}

// Cycle: null → yes → maybe → no → null
function cycleAnswer(current: VoteAnswer): VoteAnswer {
  if (current === null) return "yes";
  if (current === "yes") return "maybe";
  if (current === "maybe") return "no";
  return null;
}

function formatColumnLabel(start: string, end: string): string {
  const s = parseLocalDate(start).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const e = parseLocalDate(end).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${s}–${e}`;
}

const COLUMN_WIDTH = 88; // px, per-window column
const NAME_COL_MIN_WIDTH = 120; // px, sticky name column minimum — grows to fit names
const ADD_COL_WIDTH = 54; // px, always-visible add column

/**
 * Grid UI for the date poll. Pure rendering — emits callbacks for vote
 * changes and column header actions. Caller wires mutations.
 */
// Media query hook — tiny inline helper so we can branch the vote cell
// layout on viewport width without pulling a dependency.
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function DatePollGrid({
  dateWindows,
  members,
  currentUserId,
  isOwner,
  onVote,
  onAddDateWindow,
  onRemoveDateWindow,
  onLockDateWindow,
  onManageCrew,
}: DatePollGridProps) {
  // On desktop with three or fewer date options the cell is wide enough to
  // render the three answer buttons side-by-side (yes / maybe / no) instead
  // of the cycle single-button. Mobile always uses cycle mode.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const useTripletLayout = isDesktop && dateWindows.length > 0 && dateWindows.length <= 3;
  // Popover state keeps the anchor rect so the menu can be positioned
  // directly beneath the column header button that opened it.
  const [openPopover, setOpenPopover] = useState<
    | { id: string; anchorLeft: number; anchorBottom: number; anchorCenter: number }
    | null
  >(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!openPopover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [openPopover]);

  // Close popover if the page / grid scrolls so it doesn't desync from the
  // column it's anchored to.
  useEffect(() => {
    if (!openPopover) return;
    const close = () => setOpenPopover(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openPopover]);

  const openPopoverId = openPopover?.id ?? null;

  const hasWindows = dateWindows.length > 0;
  const showAddColumn = isOwner && !!onAddDateWindow;
  const gridMinWidth =
    NAME_COL_MIN_WIDTH +
    dateWindows.length * COLUMN_WIDTH +
    (showAddColumn ? ADD_COL_WIDTH : 0);

  // Empty-state short-circuit: no date windows yet.
  if (!hasWindows) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-10 w-10" />}
        headline="No date options yet"
        subtext={
          showAddColumn
            ? "Add date windows below so the crew can vote on what works."
            : "The organizer hasn't added any date options yet."
        }
        action={
          showAddColumn ? (
            <button
              type="button"
              onClick={onAddDateWindow}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              <CalendarPlus size={14} />
              Add date option
            </button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-xl"
      style={{ background: "var(--color-bt-card-raised)" }}
    >
      <div
        className="grid"
        style={{
          minWidth: `${gridMinWidth}px`,
          // Name column auto-fits content (no truncate) with a minimum width.
          // Date columns flex. Trailing narrow column hosts the + button.
          gridTemplateColumns: `minmax(${NAME_COL_MIN_WIDTH}px, max-content) repeat(${dateWindows.length}, minmax(${COLUMN_WIDTH}px, 1fr))${showAddColumn ? ` ${ADD_COL_WIDTH}px` : ""}`,
        }}
      >
        {/* Header: name column */}
        <div
          className="sticky left-0 z-[3] flex items-center gap-2 px-3 py-2.5"
          style={{
            background: "var(--color-bt-card)",
            borderBottom: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Crew
          </span>
          {onManageCrew && (
            <button
              type="button"
              onClick={onManageCrew}
              className="text-[10px] font-semibold transition-opacity hover:opacity-70"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Manage →
            </button>
          )}
        </div>

        {/* Header: per-window label + popover trigger */}
        {dateWindows.map((w) => {
          const isActive = openPopoverId === w.id;
          return (
            <ColumnHeader
              key={w.id}
              label={formatColumnLabel(w.start_date, w.end_date)}
              isActive={isActive}
              canEdit={isOwner}
              onToggle={(btnRect) => {
                if (openPopoverId === w.id) {
                  setOpenPopover(null);
                  return;
                }
                setOpenPopover({
                  id: w.id,
                  anchorLeft: btnRect.left,
                  anchorBottom: btnRect.bottom,
                  anchorCenter: btnRect.left + btnRect.width / 2,
                });
              }}
            />
          );
        })}

        {/* Header: add-date column (trailing narrow + button) */}
        {showAddColumn && (
          <button
            type="button"
            onClick={onAddDateWindow}
            className="flex items-center justify-center transition-colors hover:bg-[var(--color-bt-card)]"
            style={{
              background: "var(--color-bt-card)",
              borderLeft: "1px solid var(--color-bt-border)",
              borderBottom: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-accent)",
            }}
            aria-label="Add date option"
          >
            <CalendarPlus size={20} />
          </button>
        )}

        {/* Member rows */}
        {members.map((m, rowIdx) => {
          // Row striping: state-fill on even rows, card-raised on odd rows.
          // Explicit background on both so dark-mode contrast is preserved —
          // transparent would make the cell invisible against the container.
          const rowBg =
            rowIdx % 2 === 0 ? "var(--color-bt-state-fill)" : "var(--color-bt-card-raised)";
          const isMe = m.user_id === currentUserId;
          // Only the owner can see / interact with other members' rows.
          // Planners and Members see their own row clearly and others dimmed
          // (and non-operational).
          const rowDimmed = !isMe && !isOwner;
          return (
            <div key={m.user_id ?? rowIdx} className="contents">
              <div
                className="sticky left-0 z-[2] flex items-center gap-2 whitespace-nowrap px-3 py-2"
                style={{ background: rowBg }}
              >
                <UserAvatar name={m.displayName} avatarUrl={m.avatarUrl ?? null} size="sm" />
                <span
                  className="text-[13px]"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {m.displayName}
                  {isMe && (
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      {" "}
                      (you)
                    </span>
                  )}
                </span>
              </div>
              {dateWindows.map((w) => {
                const vote = w.votes.find((v) => v.user_id === m.user_id);
                const answer = (vote?.answer ?? null) as VoteAnswer;
                const isColumnActive = openPopoverId === w.id;
                const interactive = isMe || isOwner;
                const handleSet = (next: VoteAnswer) => {
                  if (!m.user_id || !interactive) return;
                  onVote(w.id, next, m.user_id);
                };
                return (
                  <div
                    key={w.id}
                    className="relative flex items-center justify-center px-1 py-2"
                    style={{ background: rowBg }}
                  >
                    {isColumnActive && (
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{ background: "var(--color-bt-state-stroke)" }}
                      />
                    )}
                    {useTripletLayout ? (
                      <VoteTriplet
                        answer={answer}
                        interactive={interactive}
                        dimmed={rowDimmed}
                        onSet={handleSet}
                      />
                    ) : (
                      <VoteButton
                        answer={answer}
                        interactive={interactive}
                        dimmed={rowDimmed}
                        onClick={() => handleSet(cycleAnswer(answer))}
                      />
                    )}
                  </div>
                );
              })}
              {/* Empty cell under the add-date column — keeps grid aligned */}
              {showAddColumn && (
                <div
                  style={{
                    background: rowBg,
                    borderLeft: "1px solid var(--color-bt-border)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── column header popover ─────────────────────────────────────── */}
      {openPopover && isOwner && (
        <div
          ref={popoverRef}
          className="fixed z-50 -translate-x-1/2 rounded-xl p-1.5 shadow-lg"
          style={{
            top: `${openPopover.anchorBottom + 6}px`,
            left: `${openPopover.anchorCenter}px`,
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            minWidth: "180px",
          }}
        >
          <PopoverItem
            icon={<CheckCircle2 size={14} />}
            label="Select this date"
            onClick={() => {
              onLockDateWindow?.(openPopover.id);
              setOpenPopover(null);
            }}
          />
          <PopoverItem
            icon={<Trash2 size={14} />}
            label="Remove"
            onClick={() => {
              onRemoveDateWindow?.(openPopover.id);
              setOpenPopover(null);
            }}
            danger
          />
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function ColumnHeader({
  label,
  isActive,
  canEdit,
  onToggle,
}: {
  label: string;
  isActive: boolean;
  canEdit: boolean;
  onToggle: (anchorRect: DOMRect) => void;
}) {
  if (!canEdit) {
    return (
      <div
        className="relative flex flex-col items-center justify-center gap-1 px-2 py-2 text-center"
        style={{
          background: "var(--color-bt-card)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        {isActive && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "var(--color-bt-state-stroke)" }}
          />
        )}
        <span
          className="text-[12px] font-semibold leading-none"
          style={{ color: "var(--color-bt-text)" }}
        >
          {label}
        </span>
      </div>
    );
  }
  return (
    <div
      className="relative flex flex-col items-center justify-center gap-1 px-2 py-2 text-center"
      style={{
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      {isActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--color-bt-state-stroke)" }}
        />
      )}
      <span
        className="text-[12px] font-semibold leading-none"
        style={{ color: "var(--color-bt-text)" }}
      >
        {label}
      </span>
      {/* onMouseDown stops the outside-click handler from firing before
          this click, which would cause the popover to close then immediately
          re-open (stale closure race). With propagation stopped, the click
          alone drives the toggle: same column closes, different column switches. */}
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => onToggle(e.currentTarget.getBoundingClientRect())}
        className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider leading-none transition-colors"
        style={{
          background: isActive
            ? "var(--color-bt-accent)"
            : "var(--color-bt-card-raised)",
          color: isActive
            ? "var(--color-bt-base)"
            : "var(--color-bt-accent)",
          border: isActive
            ? "1px solid var(--color-bt-accent)"
            : "1px solid var(--color-bt-accent-border)",
        }}
        aria-label={isActive ? "Deselect this date" : "Select this date"}
      >
        Select
      </button>
    </div>
  );
}

function VoteButton({
  answer,
  interactive,
  dimmed,
  onClick,
}: {
  answer: VoteAnswer;
  interactive: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const { background, color, border, text } = voteVisual(answer);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[13px] font-bold transition-all"
      style={{
        background,
        color,
        border,
        opacity: dimmed ? 0.4 : 1,
        pointerEvents: dimmed ? "none" : undefined,
        cursor: interactive ? "pointer" : "default",
      }}
      aria-label={`Vote: ${answer ?? "none"}`}
    >
      {text}
    </button>
  );
}

function VoteTriplet({
  answer,
  interactive,
  dimmed,
  onSet,
}: {
  answer: VoteAnswer;
  interactive: boolean;
  dimmed: boolean;
  onSet: (next: VoteAnswer) => void;
}) {
  // Three side-by-side buttons. Clicking the active one clears the vote.
  const options: { key: Exclude<VoteAnswer, null>; label: string }[] = [
    { key: "yes", label: "✓" },
    { key: "maybe", label: "~" },
    { key: "no", label: "✕" },
  ];
  return (
    <div
      className="flex items-center gap-1"
      style={{
        opacity: dimmed ? 0.4 : 1,
        pointerEvents: dimmed ? "none" : undefined,
      }}
    >
      {options.map((opt) => {
        const isActive = answer === opt.key;
        const { background, color, border } = voteVisual(opt.key);
        // Inactive pill uses the empty-state styling so it reads as "not picked"
        // but still telegraphs what choice it represents via the glyph.
        const inactive = voteVisual(null);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSet(isActive ? null : opt.key)}
            disabled={!interactive}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-[12px] font-bold transition-all"
            style={{
              background: isActive ? background : inactive.background,
              color: isActive ? color : "var(--color-bt-text-dim)",
              border: isActive ? border : inactive.border,
              cursor: interactive ? "pointer" : "default",
            }}
            aria-label={`Vote: ${opt.key}`}
            aria-pressed={isActive}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PopoverItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:opacity-80"
      style={{
        color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text)",
        background: "transparent",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function voteVisual(answer: VoteAnswer): {
  background: string;
  color: string;
  border: string;
  text: string;
} {
  // Solid-fill palette matching the DatesPanel pattern — easier to read
  // at a glance than the translucent tint version.
  if (answer === "yes") {
    return {
      background: "var(--color-bt-vote-yes)",
      color: "var(--color-bt-vote-yes-text)",
      border: "none",
      text: "✓",
    };
  }
  if (answer === "maybe") {
    return {
      background: "var(--color-bt-vote-maybe)",
      color: "var(--color-bt-vote-yes-text)",
      border: "none",
      text: "~",
    };
  }
  if (answer === "no") {
    return {
      background: "var(--color-bt-vote-no)",
      color: "var(--color-bt-vote-yes-text)",
      border: "none",
      text: "✕",
    };
  }
  return {
    background: "transparent",
    color: "var(--color-bt-text-dim)",
    border: "1px dashed var(--color-bt-border)",
    text: "?",
  };
}
// satisfy unused import cleanup
void Check;
