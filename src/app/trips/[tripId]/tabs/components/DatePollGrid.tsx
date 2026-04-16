"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarPlus, Check, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { parseLocalDate } from "@/lib/dates";
import { UserAvatar } from "@/components/UserAvatar";

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
  /** Owner + Planner — controls column-header popover (lock/edit/remove). */
  canEdit: boolean;
  /** Owner only — controls vote-for-other-members. Non-owners can only vote in their own row. */
  isOwner: boolean;
  /** Fires with the target member's user_id. For non-owners this is always the current user. */
  onVote: (dateWindowId: string, answer: VoteAnswer, userId: string) => void;
  // canEdit-only — optional so caller can omit for member-rendered grids
  onAddDateWindow?: () => void;
  onEditDateWindow?: (id: string) => void;
  onRemoveDateWindow?: (id: string) => void;
  onLockDateWindow?: (id: string) => void;
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
const NAME_COL_WIDTH = 96; // px, sticky name column
const ADD_COL_WIDTH = 46; // px, always-visible add column

/**
 * Grid UI for the date poll. Pure rendering — emits callbacks for vote
 * changes and column header actions. Caller wires mutations.
 */
export function DatePollGrid({
  dateWindows,
  members,
  currentUserId,
  canEdit,
  isOwner,
  onVote,
  onAddDateWindow,
  onEditDateWindow,
  onRemoveDateWindow,
  onLockDateWindow,
}: DatePollGridProps) {
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!openPopoverId) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopoverId(null);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [openPopoverId]);

  const gridMinWidth = NAME_COL_WIDTH + dateWindows.length * COLUMN_WIDTH;

  return (
    <div className="flex">
      {/* ── scrollable grid ────────────────────────────────────────────── */}
      <div
        className="min-w-0 flex-1 overflow-x-auto rounded-l-xl"
        style={{ background: "var(--color-bt-card)" }}
      >
        <div
          className="grid"
          style={{
            minWidth: `${gridMinWidth}px`,
            gridTemplateColumns: `${NAME_COL_WIDTH}px repeat(${Math.max(dateWindows.length, 1)}, minmax(${COLUMN_WIDTH}px, 1fr))`,
          }}
        >
          {/* Header: name column */}
          <div
            className="sticky left-0 z-[3] flex items-center px-3 py-2.5"
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
          </div>

          {/* Header: per-window label + popover trigger */}
          {dateWindows.length === 0 ? (
            <div
              className="flex items-center justify-center px-3 py-2.5"
              style={{ borderBottom: "1px solid var(--color-bt-border)" }}
            >
              <span
                className="text-[12px] italic"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                No dates added yet
              </span>
            </div>
          ) : (
            dateWindows.map((w) => {
              const isActive = openPopoverId === w.id;
              return (
                <ColumnHeader
                  key={w.id}
                  label={formatColumnLabel(w.start_date, w.end_date)}
                  isActive={isActive}
                  canEdit={canEdit}
                  onToggle={() =>
                    setOpenPopoverId((prev) => (prev === w.id ? null : w.id))
                  }
                />
              );
            })
          )}

          {/* Member rows */}
          {members.map((m, rowIdx) => {
            const rowBg =
              rowIdx % 2 === 0
                ? "var(--color-bt-card)"
                : "var(--color-bt-state-fill)";
            const isMe = m.user_id === currentUserId;
            // Only the owner can see / interact with other members' rows.
            // Planners and Members see their own row clearly and others dimmed
            // (and non-operational).
            const rowDimmed = !isMe && !isOwner;
            return (
              <div key={m.user_id ?? rowIdx} className="contents">
                <div
                  className="sticky left-0 z-[2] flex min-w-0 items-center gap-2 px-3 py-2"
                  style={{ background: rowBg }}
                >
                  <UserAvatar name={m.displayName} avatarUrl={m.avatarUrl ?? null} size="sm" />
                  <span
                    className="truncate text-[13px]"
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
                  const isColumnHighlighted = openPopoverId === w.id;
                  const cellBg = isColumnHighlighted
                    ? "rgba(45, 212, 191, 0.07)"
                    : rowBg;
                  return (
                    <div
                      key={w.id}
                      className="flex items-center justify-center px-1 py-2"
                      style={{ background: cellBg }}
                    >
                      <VoteButton
                        answer={answer}
                        interactive={isMe || isOwner}
                        dimmed={rowDimmed}
                        onClick={() => {
                          if (!m.user_id) return;
                          if (isMe || isOwner) {
                            onVote(w.id, cycleAnswer(answer), m.user_id);
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── add-column sibling (outside scroll) ───────────────────────── */}
      {canEdit && onAddDateWindow && (
        <button
          type="button"
          onClick={onAddDateWindow}
          className="flex flex-shrink-0 items-center justify-center rounded-r-xl transition-colors"
          style={{
            width: `${ADD_COL_WIDTH}px`,
            background: "var(--color-bt-card)",
            borderLeft: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-accent)",
          }}
          aria-label="Add date option"
        >
          <span className="relative flex items-center justify-center">
            <CalendarPlus size={20} />
          </span>
        </button>
      )}

      {/* ── column header popover ─────────────────────────────────────── */}
      {openPopoverId && canEdit && (
        <div
          ref={popoverRef}
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl p-1.5 shadow-lg"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            minWidth: "180px",
          }}
        >
          <PopoverItem
            icon={<Lock size={14} />}
            label="Lock this date"
            onClick={() => {
              onLockDateWindow?.(openPopoverId);
              setOpenPopoverId(null);
            }}
          />
          <PopoverItem
            icon={<Pencil size={14} />}
            label="Edit dates"
            onClick={() => {
              onEditDateWindow?.(openPopoverId);
              setOpenPopoverId(null);
            }}
          />
          <PopoverItem
            icon={<Trash2 size={14} />}
            label="Remove"
            onClick={() => {
              onRemoveDateWindow?.(openPopoverId);
              setOpenPopoverId(null);
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
  onToggle: () => void;
}) {
  const bg = isActive ? "rgba(45, 212, 191, 0.07)" : "var(--color-bt-card)";
  if (!canEdit) {
    return (
      <div
        className="flex items-center justify-center px-2 py-2.5 text-center"
        style={{
          background: bg,
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
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
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-center gap-1 px-2 py-2.5 text-center transition-colors"
      style={{
        background: bg,
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      <span
        className="text-[12px] font-semibold leading-none"
        style={{ color: "var(--color-bt-text)" }}
      >
        {label}
      </span>
      <MoreHorizontal
        size={14}
        style={{
          color: isActive ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          opacity: isActive ? 1 : 0.4,
        }}
      />
    </button>
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
  if (answer === "yes") {
    return {
      background: "rgba(0, 212, 170, 0.18)",
      color: "var(--color-bt-vote-yes)",
      border: "1px solid rgba(0, 212, 170, 0.3)",
      text: "✓",
    };
  }
  if (answer === "maybe") {
    return {
      background: "rgba(245, 158, 11, 0.18)",
      color: "var(--color-bt-warning)",
      border: "1px solid var(--color-bt-warning-border)",
      text: "~",
    };
  }
  if (answer === "no") {
    return {
      background: "rgba(239, 68, 68, 0.18)",
      color: "var(--color-bt-danger)",
      border: "1px solid var(--color-bt-danger-border)",
      text: "✕",
    };
  }
  return {
    background: "var(--color-bt-card-raised)",
    color: "var(--color-bt-text-dim)",
    border: "1px dashed var(--color-bt-border)",
    text: "?",
  };
}
// satisfy unused import cleanup
void Check;
