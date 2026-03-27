"use client";

import { useState } from "react";
import {
  Check,
  X,
  Plus,
  AlertCircle,
  ChevronRight,
  Lock,
  Star,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
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
              // Toggle off
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
              votes: [...w.votes, { window_id: vars.windowId, user_id: currentUser?.id ?? "", answer: vars.answer, created_at: new Date().toISOString() }],
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

  const lockWindow = trpc.datePoll.lockWindow.useMutation({
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const voteOnBehalf = trpc.datePoll.voteOnBehalf.useMutation({
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const windows = (poll?.windows ?? []) as DateWindow[];
  const confirmedMembers = tripMembers.filter(
    (m) => m.status === "in" || m.status === "likely" || m.status === "maybe" || m.status === "out"
  );
  const isLowCrew = confirmedMembers.length < 4;

  if (canEdit) {
    return (
      <OwnerView
        tripId={tripId}
        windows={windows}
        members={confirmedMembers}
        allMembers={tripMembers}
        isLowCrew={isLowCrew}
        confirmedCount={confirmedMembers.length}
        onTabChange={onTabChange}
        onAddWindow={(start, end) => {
          addWindow.mutate({ tripId, id: crypto.randomUUID(), startDate: start, endDate: end });
        }}
        onLock={(windowId) => {
          lockWindow.mutate({ tripId, windowId });
        }}
        onVoteOnBehalf={(userId, votes) => {
          voteOnBehalf.mutate({ tripId, userId, votes });
        }}
        bestWindowId={getBestWindowId(windows, confirmedMembers)}
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
                ? "#00d4aa"
                : myVote === "no"
                ? "#f87171"
                : myVote === "maybe"
                ? "#fbbf24"
                : "var(--color-bt-border)";
            const bgColor =
              myVote === "yes"
                ? "#e6faf6"
                : myVote === "no"
                ? "#fef2f2"
                : myVote === "maybe"
                ? "#fffbeb"
                : "var(--color-bt-card)";

            return (
              <div
                key={w.id}
                className="rounded-xl p-4 transition-colors"
                style={{
                  background: bgColor,
                  border: `1.5px solid ${borderColor}`,
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
              style={{ background: "#e6faf6", border: "1px solid #b3f0e6" }}
            >
              <Check size={16} style={{ color: "#00d4aa", flexShrink: 0 }} />
              <div className="text-sm" style={{ color: "#065f46" }}>
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
  const colors = {
    yes: { color: "#00d4aa", bg: "#e6faf6", border: "#00d4aa" },
    maybe: { color: "#92400e", bg: "#fffbeb", border: "#fbbf24" },
    no: { color: "#dc2626", bg: "#fef2f2", border: "#f87171" },
  };
  const c = colors[type];

  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium transition-all"
      style={{
        background: active ? c.bg : "var(--color-bt-base)",
        border: `1.5px solid ${active ? c.border : "var(--color-bt-border)"}`,
        color: active ? c.color : "var(--color-bt-text-dim)",
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
  allMembers,
  isLowCrew,
  confirmedCount,
  onTabChange,
  onAddWindow,
  onLock,
  onVoteOnBehalf,
  bestWindowId,
}: {
  tripId: string;
  windows: DateWindow[];
  members: TripMember[];
  allMembers: TripMember[];
  isLowCrew: boolean;
  confirmedCount: number;
  onTabChange?: (tab: string) => void;
  onAddWindow: (start: string, end: string) => void;
  onLock: (windowId: string) => void;
  onVoteOnBehalf: (userId: string, votes: { windowId: string; answer: VoteAnswer }[]) => void;
  bestWindowId: string | null;
}) {
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [ghostSheet, setGhostSheet] = useState<{ userId: string; name: string } | null>(null);
  const [lockConfirm, setLockConfirm] = useState<{ windowId: string; label: string; isBest: boolean } | null>(null);

  return (
    <div className="space-y-3">
      {/* Low crew banner */}
      {isLowCrew && (
        <div
          className="flex items-start gap-2.5 rounded-xl p-3"
          style={{ background: "#fffbeb", border: "1.5px solid #fde68a" }}
        >
          <AlertCircle size={18} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <div className="flex-1">
            <p className="text-[13px] leading-snug" style={{ color: "#78350f" }}>
              Only <strong>{confirmedCount} crew added.</strong> Add at least{" "}
              {4 - confirmedCount} more before polling so everyone&apos;s voice counts.
            </p>
            <button
              onClick={() => onTabChange?.("crew")}
              className="mt-1.5 flex items-center gap-0.5 text-xs font-semibold"
              style={{ color: "#f59e0b" }}
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
        style={{ borderColor: "#00d4aa", color: "#00d4aa", background: "transparent" }}
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
            onGhostClick={(userId, name) => setGhostSheet({ userId, name })}
          />

          {/* Lock a Date section */}
          <div
            className="my-1"
            style={{ borderTop: "1px solid var(--color-bt-border)" }}
          />
          <p
            className="text-[11px] font-bold uppercase tracking-widest"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Lock a Date
          </p>
          {windows.map((w) => {
            const { yes, maybe, no } = getScore(w, members);
            const isBest = w.id === bestWindowId;
            const label = fmtDateRange(w.start_date, w.end_date);

            return (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{
                  background: isBest ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
                  border: `1.5px solid ${isBest ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                  ...(isBest && { borderLeft: "4px solid var(--color-bt-accent)" }),
                }}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium" style={{ color: isBest ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}>
                      {label}
                    </span>
                    {isBest && (
                      <span
                        className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}
                      >
                        <Star size={10} />
                        Best
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[11px]">
                    <span style={{ color: "var(--color-bt-accent)" }}>✓ {yes}</span>
                    <span style={{ color: "var(--color-bt-warning)" }}>~ {maybe}</span>
                    <span style={{ color: "var(--color-bt-danger)" }}>✗ {no}</span>
                  </div>
                </div>
                <button
                  onClick={() => setLockConfirm({ windowId: w.id, label, isBest })}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: isBest ? "var(--color-bt-accent)" : "transparent",
                    color: isBest ? "var(--color-bt-card)" : "var(--color-bt-text-dim)",
                    border: isBest ? "none" : "1px solid var(--color-bt-border)",
                  }}
                >
                  <Lock size={13} />
                  Lock
                </button>
              </div>
            );
          })}
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

      {/* Ghost sheet */}
      {ghostSheet && (
        <GhostVoteSheet
          name={ghostSheet.name}
          windows={windows}
          existingVotes={windows.map((w) => ({
            windowId: w.id,
            answer: (w.votes.find((v) => v.user_id === ghostSheet.userId)?.answer as VoteAnswer) ?? null,
          }))}
          onSave={(votes) => {
            onVoteOnBehalf(
              ghostSheet.userId,
              votes.filter((v): v is { windowId: string; answer: VoteAnswer } => v.answer !== null)
            );
            setGhostSheet(null);
          }}
          onClose={() => setGhostSheet(null)}
        />
      )}

      {/* Lock confirm dialog */}
      {lockConfirm && (
        <LockConfirmDialog
          label={lockConfirm.label}
          isBest={lockConfirm.isBest}
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

// ── Response Grid ────────────────────────────────────────────────────────

function ResponseGrid({
  windows,
  members,
  onGhostClick,
}: {
  windows: DateWindow[];
  members: TripMember[];
  onGhostClick: (userId: string, name: string) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-center" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 w-20"
              style={{ borderRight: "1px solid var(--color-bt-border)" }}
            />
            {members.map((m) => (
              <th key={m.user_id} className="px-1 pb-1">
                <div
                  className="mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
                  style={
                    m.isGuest
                      ? {
                          background: "#e5e7eb",
                          color: "#9ca3af",
                          border: "1.5px dashed #d1d5db",
                        }
                      : {
                          background: "#00d4aa",
                          color: "white",
                        }
                  }
                >
                  {m.displayName.charAt(0).toUpperCase()}
                </div>
                {m.status === "invited" && (
                  <div className="mt-0.5 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                    👻
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {windows.map((w) => (
            <tr key={w.id}>
              <td
                className="sticky left-0 z-10 w-20 py-1.5 pr-2 text-left"
                style={{ borderRight: "1px solid var(--color-bt-border)" }}
              >
                <span className="block text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {fmtDateRange(w.start_date, w.end_date)}
                </span>
                <span className="block text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {nightCount(w.start_date, w.end_date)} nights
                </span>
              </td>
              {members.map((m) => {
                const v = w.votes.find((v) => v.user_id === m.user_id);
                const answer = v?.answer ?? null;
                return (
                  <td key={m.user_id} className="px-1 py-1.5">
                    {/* Ghost cells are tappable: onClick opens the GhostVoteSheet bottom sheet */}
                    <ResponseCell
                      answer={answer}
                      isGhost={!!m.isGuest}
                      onClick={
                        m.isGuest
                          ? () => onGhostClick(m.user_id!, m.displayName)
                          : undefined
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Yes count summary row */}
          <tr>
            <td
              className="sticky left-0 z-10 pt-1 text-left text-[11px] font-bold uppercase tracking-widest"
              style={{ color: "var(--color-bt-text-dim)", borderRight: "1px solid var(--color-bt-border)" }}
            >
              ✓ count
            </td>
            {members.map((m) => {
              const yesCount = windows.filter((w) =>
                w.votes.some((v) => v.user_id === m.user_id && v.answer === "yes")
              ).length;
              return (
                <td key={m.user_id} className="px-1 pt-1">
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
                    style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}
                  >
                    {yesCount}
                  </span>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ResponseCell({
  answer,
  isGhost,
  onClick,
}: {
  answer: string | null;
  isGhost: boolean;
  onClick?: () => void;
}) {
  const styles: Record<string, { bg: string; color: string; border: string; sym: string }> = {
    yes: { bg: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "var(--color-bt-accent-border)", sym: "✓" },
    maybe: { bg: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)", border: "var(--color-bt-warning-border)", sym: "~" },
    no: { bg: "var(--color-bt-danger-faint)", color: "var(--color-bt-danger)", border: "var(--color-bt-danger-border)", sym: "✗" },
  };
  const s = answer ? styles[answer] : null;

  return (
    <div
      onClick={onClick}
      className={`mx-auto flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ${
        isGhost && onClick ? "cursor-pointer" : ""
      }`}
      style={
        s
          ? { background: s.bg, color: s.color, border: `1px solid ${s.border}` }
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
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "var(--color-bt-card)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: "#d1d5db" }} />
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
          style={{ background: "#00d4aa", color: "white" }}
        >
          Add Option
        </button>
      </div>
    </div>
  );
}

function GhostVoteSheet({
  name,
  windows,
  existingVotes,
  onSave,
  onClose,
}: {
  name: string;
  windows: DateWindow[];
  existingVotes: { windowId: string; answer: VoteAnswer | null }[];
  onSave: (votes: { windowId: string; answer: VoteAnswer | null }[]) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(existingVotes);

  const setAnswer = (windowId: string, answer: VoteAnswer) => {
    setPending((prev) =>
      prev.map((v) => (v.windowId === windowId ? { ...v, answer: v.answer === answer ? null : answer } : v))
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "var(--color-bt-card)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: "#d1d5db" }} />
        <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Set availability for {name}
        </p>
        <p className="mb-4 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          They haven&apos;t joined yet. Set their availability on their behalf.
        </p>
        <div className="space-y-3">
          {windows.map((w, i) => {
            const cur = pending[i]?.answer;
            return (
              <div key={w.id}>
                <p className="mb-1.5 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {fmtDateRange(w.start_date, w.end_date)}
                </p>
                <div className="flex gap-2">
                  <VoteButton label="✓ Works" type="yes" active={cur === "yes"} onClick={() => setAnswer(w.id, "yes")} />
                  <VoteButton label="~ Maybe" type="maybe" active={cur === "maybe"} onClick={() => setAnswer(w.id, "maybe")} />
                  <VoteButton label="✗ Can't" type="no" active={cur === "no"} onClick={() => setAnswer(w.id, "no")} />
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => onSave(pending)}
          className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: "#00d4aa", color: "white" }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function LockConfirmDialog({
  label,
  isBest,
  onConfirm,
  onCancel,
}: {
  label: string;
  isBest: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.4)" }}
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
          {isBest
            ? "This is the top-voted option. The crew will be notified."
            : "This isn't the top-voted option, but it's your call. The crew will be notified."}
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
            style={{ background: "#00d4aa", color: "white" }}
          >
            Lock It In
          </button>
        </div>
      </div>
    </div>
  );
}
