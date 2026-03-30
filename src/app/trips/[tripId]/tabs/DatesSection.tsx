"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  Check,
  Ghost,
  Plus,
  AlertCircle,
  ChevronRight,
  Lock,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { RoleBadge } from "@/components/RoleBadge";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseLocalDate } from "@/lib/dates";

// ── Types ────────────────────────────────────────────────────────────────

type VoteAnswer = "yes" | "no" | "maybe";

interface Vote {
  window_id: string;
  user_id: string;
  answer: string;
  created_at?: string;
}

interface DateWindow {
  id: string;
  start_date: string;
  end_date: string;
  votes: Vote[];
}

interface TripMember {
  user_id: string | null;
  status: string;
  displayName: string;
  isGuest?: boolean;
  role?: string;
}

const ROLE_ORDER: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDateShort(d: string) {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtDateRange(start: string, end: string) {
  return `${fmtDateShort(start)}–${fmtDateShort(end)}`;
}

function nightCount(start: string, end: string) {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 1;
}

function getScore(w: DateWindow, members: TripMember[]) {
  const memberIds = new Set(members.map((m) => m.user_id));
  const relevantVotes = w.votes.filter((v) => memberIds.has(v.user_id));
  const yes = relevantVotes.filter((v) => v.answer === "yes").length;
  const maybe = relevantVotes.filter((v) => v.answer === "maybe").length;
  const no = relevantVotes.filter((v) => v.answer === "no").length;
  return { yes, maybe, no, score: yes * 2 + maybe };
}

/** Four-step compact chip cycle: null → yes → maybe → no → null */
function nextAnswerCompact(current: VoteAnswer | null): VoteAnswer | null {
  if (current === null) return "yes";
  if (current === "yes") return "maybe";
  if (current === "maybe") return "no";
  return null; // "no" → null (caller handles deselect)
}

function getBestWindowId(windows: DateWindow[], members: TripMember[]) {
  let bestId: string | null = null;
  let bestScore = -1;
  for (const w of windows) {
    const { score } = getScore(w, members);
    if (score > bestScore) {
      bestScore = score;
      bestId = w.id;
    }
  }
  return bestId;
}

// ── Component ────────────────────────────────────────────────────────────

export function DatesSection({
  tripId,
  canEdit,
  isOwner,
  tripMembers,
  onTabChange,
}: {
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  tripMembers: TripMember[];
  onTabChange?: (tab: string) => void;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });

  // ── vote (own-user) ───────────────────────────────────────────────────
  const vote = trpc.datePoll.vote.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          windows: old.windows.map((w) => {
            if (w.id !== vars.windowId) return w;
            const existing = w.votes.find((v) => v.user_id === currentUser?.id);
            if (existing?.answer === vars.answer) {
              return { ...w, votes: w.votes.filter((v) => v.user_id !== currentUser?.id) };
            }
            if (existing) {
              return {
                ...w,
                votes: w.votes.map((v) =>
                  v.user_id === currentUser?.id ? { ...v, answer: vars.answer } : v
                ),
              };
            }
            return {
              ...w,
              votes: [
                ...w.votes,
                {
                  window_id: vars.windowId,
                  user_id: currentUser?.id ?? "",
                  answer: vars.answer,
                  created_at: new Date().toISOString(),
                },
              ],
            };
          }),
        };
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.datePoll.get.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── addWindow ────────────────────────────────────────────────────────
  const addWindow = trpc.datePoll.addWindow.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => ({
        lockedWindowId: old?.lockedWindowId ?? null,
        windows: [
          ...(old?.windows ?? []),
          {
            id: vars.id,
            trip_id: tripId,
            start_date: vars.startDate,
            end_date: vars.endDate,
            created_at: new Date().toISOString(),
            votes: [],
          },
        ],
      }));
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.datePoll.get.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── lockWindow ───────────────────────────────────────────────────────
  const lockWindow = trpc.datePoll.lockWindow.useMutation({
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
      utils.trips.getById.invalidate({ tripId });
    },
  });

  // ── voteOnBehalf (ghost users) ────────────────────────────────────────
  const voteOnBehalf = trpc.datePoll.voteOnBehalf.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          windows: old.windows.map((w) => {
            const incoming = vars.votes.find((v) => v.windowId === w.id);
            if (incoming) {
              const existing = w.votes.find((v) => v.user_id === vars.userId);
              if (existing) {
                return {
                  ...w,
                  votes: w.votes.map((v) =>
                    v.user_id === vars.userId ? { ...v, answer: incoming.answer } : v
                  ),
                };
              }
              return {
                ...w,
                votes: [
                  ...w.votes,
                  {
                    window_id: w.id,
                    user_id: vars.userId,
                    answer: incoming.answer,
                    created_at: new Date().toISOString(),
                  },
                ],
              };
            }
            // Window not in incoming votes → optimistically remove this user's vote
            return { ...w, votes: w.votes.filter((v) => v.user_id !== vars.userId) };
          }),
        };
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.datePoll.get.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const windows = (poll?.windows ?? []) as DateWindow[];
  const confirmedMembers = tripMembers.filter(
    (m) => m.status === "in" || m.status === "likely" || m.status === "maybe" || m.status === "out"
  );
  const isLowCrew = confirmedMembers.length < 4;
  // Show all members in the date poll grid (matching the crew tab), not just RSVP'd ones
  const allMembers = tripMembers;

  // ── Unified grid vote dispatcher ──────────────────────────────────────
  function handleGridVote(userId: string, windowId: string, answer: VoteAnswer | null) {
    if (userId === currentUser?.id) {
      // Own vote: null means deselect — re-send current answer so server toggles off.
      const existingAnswer = windows
        .find((w) => w.id === windowId)
        ?.votes.find((v) => v.user_id === userId)?.answer as VoteAnswer | undefined;
      if (answer === null) {
        if (existingAnswer) vote.mutate({ tripId, windowId, answer: existingAnswer });
        return;
      }
      vote.mutate({ tripId, windowId, answer });
    } else {
      // Ghost user: build full updated vote set and submit via voteOnBehalf.
      const updatedVotes: { windowId: string; answer: VoteAnswer }[] = windows
        .map((w) => {
          const existingAnswer = w.votes.find((v) => v.user_id === userId)
            ?.answer as VoteAnswer | undefined;
          const next: VoteAnswer | null =
            w.id === windowId ? answer : (existingAnswer ?? null);
          return next !== null ? { windowId: w.id, answer: next } : null;
        })
        .filter((v): v is { windowId: string; answer: VoteAnswer } => v !== null);
      voteOnBehalf.mutate({ tripId, userId, votes: updatedVotes });
    }
  }

  if (canEdit) {
    return (
      <OwnerView
        tripId={tripId}
        windows={windows}
        members={allMembers}
        isLowCrew={isLowCrew}
        confirmedCount={confirmedMembers.length}
        currentUserId={currentUser?.id ?? ""}
        onTabChange={onTabChange}
        onAddWindow={(start, end) => {
          addWindow.mutate({ tripId, id: crypto.randomUUID(), startDate: start, endDate: end });
        }}
        onLock={(windowId) => {
          lockWindow.mutate({ tripId, windowId });
        }}
        onGridVote={handleGridVote}
      />
    );
  }

  return (
    <MemberView
      windows={windows}
      currentUserId={currentUser?.id ?? ""}
      onVote={(windowId, answer) => {
        vote.mutate({ tripId, windowId, answer });
      }}
      memberCount={confirmedMembers.length}
    />
  );
}

// ── Member View ──────────────────────────────────────────────────────────

function MemberView({
  windows,
  currentUserId,
  onVote,
  memberCount,
}: {
  windows: DateWindow[];
  currentUserId: string;
  onVote: (windowId: string, answer: VoteAnswer) => void;
  memberCount: number;
}) {
  const myVoteFor = (w: DateWindow): VoteAnswer | null => {
    const v = w.votes.find((v) => v.user_id === currentUserId);
    return (v?.answer as VoteAnswer) ?? null;
  };

  const allAnswered = windows.length > 0 && windows.every((w) => myVoteFor(w) !== null);
  const respondedCount = new Set(windows.flatMap((w) => w.votes.map((v) => v.user_id))).size;

  return (
    <div className="space-y-3">
      {windows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No date options yet. Waiting for a planner to add dates.
        </p>
      ) : (
        <>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              When works for you?
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Select your availability for each option
            </p>
          </div>

          {windows.map((w) => {
            const myVote = myVoteFor(w);
            const borderColor =
              myVote === "yes"
                ? "var(--color-bt-accent)"
                : myVote === "no"
                ? "var(--color-bt-danger)"
                : myVote === "maybe"
                ? "var(--color-bt-warning)"
                : "var(--color-bt-border)";

            return (
              <div
                key={w.id}
                className="rounded-xl p-4 transition-colors"
                style={{
                  background: "var(--color-bt-card)",
                  border: `${myVote ? "2px" : "1px"} solid ${borderColor}`,
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {fmtDateRange(w.start_date, w.end_date)}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text-dim)" }}
                  >
                    {nightCount(w.start_date, w.end_date)} nights
                  </span>
                </div>
                <div className="flex gap-2">
                  <VoteButton
                    label="✓ Works"
                    type="yes"
                    active={myVote === "yes"}
                    onClick={() => onVote(w.id, "yes")}
                  />
                  <VoteButton
                    label="~ Maybe"
                    type="maybe"
                    active={myVote === "maybe"}
                    onClick={() => onVote(w.id, "maybe")}
                  />
                  <VoteButton
                    label="✗ Can't"
                    type="no"
                    active={myVote === "no"}
                    onClick={() => onVote(w.id, "no")}
                  />
                </div>
              </div>
            );
          })}

          {allAnswered && (
            <div
              className="flex items-center gap-2.5 rounded-xl px-4 py-3"
              style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}
            >
              <Check size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
              <div className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                <strong>You&apos;re all set!</strong> {respondedCount} of {memberCount} crew have
                responded so far.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Vote Button (used in MemberView and GhostVoteSheet equivalent) ────────

function VoteButton({
  label,
  type,
  active,
  onClick,
}: {
  label: string;
  type: VoteAnswer;
  active: boolean;
  onClick: () => void;
}) {
  const activeStyles = {
    yes:   { bg: "var(--color-bt-accent)",  color: "white" },
    maybe: { bg: "var(--color-bt-warning)", color: "var(--color-bt-base-alt)" },
    no:    { bg: "var(--color-bt-danger)",  color: "white" },
  };
  const a = activeStyles[type];

  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs transition-all"
      style={{
        background: active ? a.bg : "var(--color-bt-card-raised)",
        border: "none",
        color: active ? a.color : "var(--color-bt-text-dim)",
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

// ── Owner View ───────────────────────────────────────────────────────────

function OwnerView({
  tripId,
  windows,
  members,
  isLowCrew,
  confirmedCount,
  currentUserId,
  onTabChange,
  onAddWindow,
  onLock,
  onGridVote,
}: {
  tripId: string;
  windows: DateWindow[];
  members: TripMember[];
  isLowCrew: boolean;
  confirmedCount: number;
  currentUserId: string;
  onTabChange?: (tab: string) => void;
  onAddWindow: (start: string, end: string) => void;
  onLock: (windowId: string) => void;
  onGridVote: (userId: string, windowId: string, answer: VoteAnswer | null) => void;
}) {
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [lockConfirm, setLockConfirm] = useState<{ windowId: string; label: string } | null>(null);

  return (
    <div className="space-y-3">
      {/* Low crew banner */}
      {isLowCrew && (
        <div
          className="flex items-start gap-2.5 rounded-xl p-3"
          style={{ background: "var(--color-bt-warning-faint)", border: "1px solid var(--color-bt-warning-border)" }}
        >
          <AlertCircle size={18} style={{ color: "var(--color-bt-warning)", flexShrink: 0, marginTop: 1 }} />
          <div className="flex-1">
            <p className="text-[13px] leading-snug" style={{ color: "var(--color-bt-text)" }}>
              Only <strong>{confirmedCount} crew added.</strong> Add at least{" "}
              {4 - confirmedCount} more before polling so everyone&apos;s voice counts.
            </p>
            <button
              onClick={() => onTabChange?.("crew")}
              className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold"
              style={{ color: "var(--color-bt-warning)" }}
            >
              Go to Crew tab
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Add date option button */}
      <button
        onClick={() => setShowAddSheet(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-2.5 text-sm font-medium transition-colors"
        style={{ borderColor: "var(--color-bt-accent)", color: "var(--color-bt-accent)", background: "transparent" }}
      >
        <Plus size={16} />
        Add date option
      </button>

      {/* Response grid */}
      {windows.length > 0 && members.length > 0 && (
        <>
          <p
            className="text-[11px] font-bold uppercase tracking-widest"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Responses
          </p>
          <ResponseGrid
            windows={windows}
            members={members}
            currentUserId={currentUserId}
            onGridVote={onGridVote}
            onLockClick={(windowId) => {
              const w = windows.find((w) => w.id === windowId);
              if (!w) return;
              setLockConfirm({
                windowId,
                label: fmtDateRange(w.start_date, w.end_date),
              });
            }}
          />
        </>
      )}

      {/* Add date sheet */}
      {showAddSheet && (
        <AddDateSheet
          onSave={(start, end) => {
            onAddWindow(start, end);
            setShowAddSheet(false);
          }}
          onClose={() => setShowAddSheet(false)}
        />
      )}

      {/* Lock confirm dialog */}
      {lockConfirm && (
        <LockConfirmDialog
          label={lockConfirm.label}
          onConfirm={() => {
            onLock(lockConfirm.windowId);
            setLockConfirm(null);
          }}
          onCancel={() => setLockConfirm(null)}
        />
      )}
    </div>
  );
}

// ── Response Grid (transposed: rows = members, cols = windows) ────────────

function ResponseGrid({
  windows,
  members,
  currentUserId,
  onGridVote,
  onLockClick,
}: {
  windows: DateWindow[];
  members: TripMember[];
  currentUserId: string;
  onGridVote: (userId: string, windowId: string, answer: VoteAnswer | null) => void;
  onLockClick: (windowId: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const CREW_COLUMN_WIDTH = 140;
  const MIN_BUTTON_COLUMN_WIDTH = 180; // px per date column needed for 3-button wide mode
  const availableWidth = containerWidth - CREW_COLUMN_WIDTH;
  const columnWidth = windows.length > 0 ? availableWidth / windows.length : 0;
  const useWideMode = columnWidth >= MIN_BUTTON_COLUMN_WIDTH;

  const sorted = [...members].sort((a, b) => {
    const aOrder = ROLE_ORDER[a.role ?? "Member"] ?? 2;
    const bOrder = ROLE_ORDER[b.role ?? "Member"] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
  const memberIds = new Set(members.map((m) => m.user_id));

  return (
    <div ref={containerRef} className="-mx-1 overflow-x-auto">
      <table
        className="w-full"
        style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "140px" }} />
          {windows.map((w) => (
            <col key={w.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {/* Corner cell */}
            <th
              className="pb-2 text-left"
              style={{ borderRight: "1px solid var(--color-bt-border)", borderBottom: "1px solid var(--color-bt-border)" }}
            />
            {/* Date column headers */}
            {windows.map((w) => (
              <th key={w.id} className="px-1 pb-2 text-center" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
                <span className="block text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {fmtDateRange(w.start_date, w.end_date)}
                </span>
                <span className="block text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {nightCount(w.start_date, w.end_date)} nights
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* One row per crew member */}
          {sorted.map((m, i) => (
            <tr key={m.user_id} style={i % 2 === 1 ? { background: isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)" } : undefined}>
              {/* Crew cell: avatar + name */}
              <td
                className="py-1.5 pr-2"
                style={{ borderRight: "1px solid var(--color-bt-border)" }}
              >
                <div className="flex items-center gap-1.5">
                  {m.isGuest ? (
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                    >
                      <Ghost size={12} />
                    </div>
                  ) : (
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
                    >
                      {m.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] font-medium"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {m.displayName}
                  </span>
                  {!m.isGuest && (m.role === "Owner" || m.role === "Planner") && (
                    <RoleBadge role={m.role as "Owner" | "Planner"} />
                  )}
                </div>
              </td>
              {/* Vote cell per window */}
              {windows.map((w) => {
                const v = w.votes.find((v) => v.user_id === m.user_id);
                const answer = (v?.answer as VoteAnswer) ?? null;
                const isInteractive = m.user_id === currentUserId || !!m.isGuest;
                return (
                  <td key={w.id} className="px-1 py-1.5 text-center">
                    <VoteCell
                      answer={answer}
                      isWide={useWideMode}
                      interactive={isInteractive}
                      onVote={(next) => onGridVote(m.user_id!, w.id, next)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Yes count row */}
          <tr>
            <td
              className="py-1.5 pr-2 text-[11px] font-bold uppercase tracking-widest"
              style={{
                color: "var(--color-bt-text-dim)",
                borderTop: "1px solid var(--color-bt-border)",
                borderRight: "1px solid var(--color-bt-border)",
              }}
            >
              Yes count
            </td>
            {windows.map((w) => {
              const yesCount = w.votes.filter(
                (v) => v.answer === "yes" && memberIds.has(v.user_id)
              ).length;
              return (
                <td
                  key={w.id}
                  className="px-1 py-1.5 text-center"
                  style={{ borderTop: "1px solid var(--color-bt-border)" }}
                >
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: yesCount > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                  >
                    {yesCount} yes
                  </span>
                </td>
              );
            })}
          </tr>
          {/* Lock row */}
          <tr>
            <td
              className="py-1.5 pr-2 text-[11px] font-bold uppercase tracking-widest"
              style={{
                color: "var(--color-bt-text-dim)",
                borderTop: "1px solid var(--color-bt-border)",
                borderRight: "1px solid var(--color-bt-border)",
              }}
            >
              Lock
            </td>
            {windows.map((w) => (
              <td
                key={w.id}
                className="px-1 py-1.5"
                style={{ borderTop: "1px solid var(--color-bt-border)" }}
              >
                <button
                  onClick={() => onLockClick(w.id)}
                  className="flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <Lock size={11} />
                  Lock
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Vote Cell ─────────────────────────────────────────────────────────────

function VoteCell({
  answer,
  isWide,
  interactive,
  onVote,
}: {
  answer: VoteAnswer | null;
  isWide: boolean;
  interactive: boolean;
  onVote: (next: VoteAnswer | null) => void;
}) {
  if (isWide) {
    return <WideCellButtons answer={answer} interactive={interactive} onVote={onVote} />;
  }
  return <CompactChip answer={answer} interactive={interactive} onVote={onVote} />;
}

// ── Wide cell: 3 symbol buttons ───────────────────────────────────────────

function WideCellButtons({
  answer,
  interactive,
  onVote,
}: {
  answer: VoteAnswer | null;
  interactive: boolean;
  onVote: (next: VoteAnswer | null) => void;
}) {
  const chips: { type: VoteAnswer; sym: string; activeBg: string; activeColor: string }[] = [
    { type: "yes",   sym: "✓", activeBg: "rgba(0, 212, 170, 0.15)",  activeColor: "var(--color-bt-accent)" },
    { type: "maybe", sym: "~", activeBg: "rgba(245, 158, 11, 0.15)", activeColor: "#d97706" },
    { type: "no",    sym: "✗", activeBg: "rgba(239, 68, 68, 0.15)",  activeColor: "#dc2626" },
  ];

  return (
    <div className="flex items-center gap-1">
      {chips.map(({ type, sym, activeBg, activeColor }) => {
        const isActive = answer === type;
        return (
          <button
            key={type}
            disabled={!interactive}
            onClick={() => onVote(isActive ? null : type)}
            className="flex flex-1 items-center justify-center rounded px-2 transition-all"
            style={{
              height: "28px",
              fontSize: "11px",
              fontWeight: isActive ? 700 : 500,
              background: isActive ? activeBg : "transparent",
              color: isActive ? activeColor : "var(--color-bt-text-dim)",
              border: isActive ? "none" : "1px dashed var(--color-bt-border)",
              cursor: interactive ? "pointer" : "default",
            }}
          >
            {sym}
          </button>
        );
      })}
    </div>
  );
}

// ── Compact cell: single cycling chip ─────────────────────────────────────

function CompactChip({
  answer,
  interactive,
  onVote,
}: {
  answer: VoteAnswer | null;
  interactive: boolean;
  onVote: (next: VoteAnswer | null) => void;
}) {
  const styles: Record<string, { bg: string; color: string; sym: string }> = {
    yes:   { bg: "rgba(0, 212, 170, 0.15)",  color: "var(--color-bt-accent)", sym: "✓" },
    maybe: { bg: "rgba(245, 158, 11, 0.15)", color: "#d97706",                sym: "~" },
    no:    { bg: "rgba(239, 68, 68, 0.15)",  color: "#dc2626",                sym: "✗" },
  };
  const s = answer ? styles[answer] : null;

  return (
    <div
      onClick={interactive ? () => onVote(nextAnswerCompact(answer)) : undefined}
      className={`mx-auto flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-transform ${
        interactive ? "cursor-pointer active:scale-90" : ""
      }`}
      style={
        s
          ? { background: s.bg, color: s.color }
          : {
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "1px dashed var(--color-bt-border)",
            }
      }
    >
      {s ? s.sym : "·"}
    </div>
  );
}

// ── Bottom Sheets / Dialogs ──────────────────────────────────────────────

function AddDateSheet({
  onSave,
  onClose,
}: {
  onSave: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "var(--color-bt-card)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: "var(--color-bt-border)" }} />
        <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Add Date Option
        </p>
        <p className="mb-4 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          Propose a date range for the crew to vote on.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              From
            </label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              To
            </label>
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>
        </div>
        <button
          disabled={!start || !end}
          onClick={() => onSave(start, end)}
          className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          Add Option
        </button>
      </div>
    </div>
  );
}

function LockConfirmDialog({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)" }}
      >
        <p className="mb-2 text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Lock in {label}?
        </p>
        <p className="mb-5 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          The crew will be notified.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border py-2 text-sm font-medium"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Lock It In
          </button>
        </div>
      </div>
    </div>
  );
}
