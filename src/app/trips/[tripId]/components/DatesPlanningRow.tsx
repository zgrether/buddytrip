"use client";

import { useState, useMemo } from "react";
import { Calendar, Plus, X, Check, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { UserAvatar } from "@/components/UserAvatar";
import { parseLocalDate, formatDateRangeCompact } from "@/lib/dates";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import type { TripData } from "../tabs/types";

// ── Types ────────────────────────────────────────────────────────────────

interface DatesPlanningRowProps {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

type Answer = "yes" | "no" | "maybe";

interface PollWindow {
  id: string;
  start_date: string;
  end_date: string;
  votes: { user_id: string; answer: string }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nightsBetween(start: string, end: string): number {
  return Math.max(
    1,
    Math.round(
      (parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / 86400000
    )
  );
}

function formatRangeWithNights(start: string, end: string): string {
  return `${formatDateRangeCompact(start, end)} · ${nightsBetween(start, end)} night${nightsBetween(start, end) !== 1 ? "s" : ""}`;
}

// ── Component ────────────────────────────────────────────────────────────

export function DatesPlanningRow({
  trip,
  canEdit,
  isOwner,
  isOpen,
  onToggle,
}: DatesPlanningRowProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const windows = (poll?.windows ?? []) as PollWindow[];
  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollActive = !!trip.date_poll_active;
  const hasWindows = windows.length > 0;
  const setMethod = (trip.date_set_method ?? null) as "direct" | "poll" | null;

  // Local builder state — only used in poll-builder mode
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");
  const [showPollBuilder, setShowPollBuilder] = useState(false);
  const [pollStart, setPollStart] = useState("");
  const [pollEnd, setPollEnd] = useState("");
  const [showPickSheet, setShowPickSheet] = useState(false);
  const [confirmLock, setConfirmLock] = useState<PollWindow | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [editingLocked, setEditingLocked] = useState(false);

  // ── Mutations ──────────────────────────────────────────────────────────

  const lockDates = trpc.trips.lockDates.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old
          ? {
              ...old,
              start_date: vars.startDate,
              end_date: vars.endDate,
              date_set_method: vars.method,
              date_poll_active: false,
            }
          : old
      );
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSuccess() {
      setDirectStart("");
      setDirectEnd("");
      setEditingLocked(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const setPollActive = trpc.trips.setDatePollActive.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, date_poll_active: vars.active } : old
      );
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const addWindow = trpc.datePoll.addWindow.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => {
        if (!old) {
          return {
            lockedWindowId: null,
            windows: [
              {
                id: vars.id,
                trip_id: tripId,
                start_date: vars.startDate,
                end_date: vars.endDate,
                created_at: new Date().toISOString(),
                votes: [],
              },
            ],
          };
        }
        return {
          ...old,
          windows: [
            ...old.windows,
            {
              id: vars.id,
              trip_id: tripId,
              start_date: vars.startDate,
              end_date: vars.endDate,
              created_at: new Date().toISOString(),
              votes: [],
            },
          ].sort((a, b) => a.start_date.localeCompare(b.start_date)),
        };
      });
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const removeWindowM = trpc.datePoll.removeWindow.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) =>
        old
          ? { ...old, windows: old.windows.filter((w) => w.id !== vars.windowId) }
          : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const voteSelf = trpc.datePoll.vote.useMutation({
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

  const voteForMember = trpc.datePoll.castVoteForMember.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          windows: old.windows.map((w) => {
            if (w.id !== vars.windowId) return w;
            const existing = w.votes.find((v) => v.user_id === vars.userId);
            if (existing) {
              return {
                ...w,
                votes: w.votes.map((v) =>
                  v.user_id === vars.userId ? { ...v, answer: vars.answer } : v
                ),
              };
            }
            return {
              ...w,
              votes: [
                ...w.votes,
                {
                  window_id: vars.windowId,
                  user_id: vars.userId,
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

  const resetVotes = trpc.datePoll.resetVotes.useMutation({
    async onMutate() {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) =>
        old
          ? { ...old, windows: old.windows.map((w) => ({ ...w, votes: [] })) }
          : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // ── Derived header state ───────────────────────────────────────────────

  const state: ArcCardState = datesLocked
    ? "done"
    : pollActive || hasWindows
    ? "inProgress"
    : "none";

  const headerLabel = datesLocked
    ? "Dates Selected"
    : pollActive
    ? "Checking Availability"
    : hasWindows
    ? "Poll Paused"
    : "Set Dates";

  const headerNote = useMemo(() => {
    if (datesLocked) {
      return `${formatDateRangeCompact(trip.start_date, trip.end_date)} · ${nightsBetween(trip.start_date!, trip.end_date!)} night${nightsBetween(trip.start_date!, trip.end_date!) !== 1 ? "s" : ""}`;
    }
    if (pollActive) return `Poll active · ${windows.length} option${windows.length !== 1 ? "s" : ""}`;
    if (hasWindows) return `Poll paused · ${windows.length} option${windows.length !== 1 ? "s" : ""}`;
    return "Not set yet";
  }, [datesLocked, pollActive, hasWindows, windows.length, trip.start_date, trip.end_date]);

  // Member view: panel only opens for crew when an active poll exists.
  const canExpand = canEdit || (pollActive && hasWindows);
  const effectiveOpen = isOpen && canExpand;
  const handleToggle = canExpand ? onToggle : () => {};

  // ── Sub-renderers ──────────────────────────────────────────────────────

  function renderDirectInputs(opts: { primaryLabel: string; method: "direct" }) {
    const valid = directStart && directEnd && directStart < directEnd;
    return (
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
          When are you going?
        </p>
        <div className="flex items-end gap-2">
          <DateField label="From" value={directStart} onChange={setDirectStart} />
          <span className="mb-2.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            →
          </span>
          <DateField label="To" value={directEnd} onChange={setDirectEnd} />
        </div>
        <PrimaryButton
          disabled={!valid || lockDates.isPending}
          onClick={() =>
            lockDates.mutate({
              tripId,
              startDate: directStart,
              endDate: directEnd,
              method: opts.method,
            })
          }
        >
          {lockDates.isPending ? "Saving…" : opts.primaryLabel}
        </PrimaryButton>
      </div>
    );
  }

  function renderAddOptionRow() {
    const validNew = pollStart && pollEnd && pollStart < pollEnd;
    return (
      <div className="flex items-end gap-2">
        <DateField label="From" value={pollStart} onChange={setPollStart} />
        <span
          className="mb-2.5 text-sm"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          →
        </span>
        <DateField label="To" value={pollEnd} onChange={setPollEnd} />
        <button
          disabled={!validNew}
          onClick={() => {
            addWindow.mutate({
              tripId,
              id: crypto.randomUUID(),
              startDate: pollStart,
              endDate: pollEnd,
            });
            setPollStart("");
            setPollEnd("");
          }}
          className="mb-1 flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-medium"
          style={{
            background: validNew
              ? "var(--color-bt-accent)"
              : "var(--color-bt-card-raised)",
            color: validNew ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
            opacity: validNew ? 1 : 0.6,
            cursor: validNew ? "pointer" : "not-allowed",
          }}
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    );
  }

  function renderCrewGrid() {
    return (
      <div>
        <div
          className="overflow-x-auto rounded-xl"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-10 px-3 py-2 text-left text-[11px] font-medium"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    borderBottom: "1px solid var(--color-bt-border)",
                    borderRight: "1px solid var(--color-bt-border)",
                  }}
                >
                  Crew
                </th>
                {windows.map((w) => (
                  <th
                    key={w.id}
                    className="px-3 py-2 text-center text-[11px] font-medium"
                    style={{
                      borderBottom: "1px solid var(--color-bt-border)",
                      color: "var(--color-bt-text)",
                      minWidth: 140,
                    }}
                  >
                    <div>{formatDateRangeCompact(w.start_date, w.end_date)}</div>
                    <div style={{ color: "var(--color-bt-text-dim)" }}>
                      {nightsBetween(w.start_date, w.end_date)} night
                      {nightsBetween(w.start_date, w.end_date) !== 1 ? "s" : ""}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m, idx) => {
                const isMe = m.user_id === currentUser?.id;
                const canVoteRow = isOwner || isMe;
                const rowBg =
                  idx % 2 === 0 ? "transparent" : "var(--color-bt-state-fill)";
                return (
                  <tr key={m.user_id ?? idx}>
                    <td
                      className="sticky left-0 z-10 px-3 py-2"
                      style={{
                        background:
                          idx % 2 === 0
                            ? "var(--color-bt-card-raised)"
                            : "var(--color-bt-card-raised)",
                        borderRight: "1px solid var(--color-bt-border)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <UserAvatar name={m.displayName} avatarUrl={null} size="sm" />
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
                    </td>
                    {windows.map((w) => {
                      const myVote = w.votes.find((v) => v.user_id === m.user_id);
                      const answer = (myVote?.answer ?? null) as Answer | null;
                      return (
                        <td
                          key={w.id}
                          className="px-2 py-2"
                          style={{ background: rowBg }}
                        >
                          <VoteButtons
                            answer={answer}
                            disabled={!canVoteRow}
                            onChange={(next) => {
                              if (!m.user_id) return;
                              if (isMe) {
                                voteSelf.mutate({
                                  tripId,
                                  windowId: w.id,
                                  answer: next,
                                });
                              } else if (isOwner) {
                                voteForMember.mutate({
                                  tripId,
                                  windowId: w.id,
                                  userId: m.user_id,
                                  answer: next,
                                });
                              }
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    );
  }

  function renderPollWorkspace() {
    return (
      <div className="space-y-3">
        {hasWindows && (
          <>
            <p
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Poll options
            </p>
            {renderCrewGrid()}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {windows.map((w) => (
                  <button
                    key={w.id}
                    onClick={() =>
                      removeWindowM.mutate({ tripId, windowId: w.id })
                    }
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                      color: "var(--color-bt-text-dim)",
                    }}
                    aria-label={`Remove ${formatDateRangeCompact(w.start_date, w.end_date)}`}
                  >
                    {formatDateRangeCompact(w.start_date, w.end_date)}
                    <X size={11} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {canEdit && renderAddOptionRow()}
        {canEdit && isOwner && (
          <div className="space-y-2 pt-1">
            {pollActive ? (
              <>
                <PrimaryButton
                  disabled={windows.length === 0}
                  onClick={() => {
                    if (windows.length === 1) setConfirmLock(windows[0]);
                    else setShowPickSheet(true);
                  }}
                >
                  Pick a date
                </PrimaryButton>
                <GhostButton
                  onClick={() =>
                    setPollActive.mutate({ tripId, active: false })
                  }
                >
                  Pause polling
                </GhostButton>
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-xs font-medium"
                  style={{ color: "var(--color-bt-danger)" }}
                >
                  Reset poll
                </button>
              </>
            ) : (
              <>
                <PrimaryButton
                  disabled={windows.length === 0}
                  onClick={() =>
                    setPollActive.mutate({ tripId, active: true })
                  }
                >
                  {hasWindows ? "Start polling" : "Add an option to start"}
                </PrimaryButton>
                {!hasWindows && (
                  <GhostButton
                    onClick={() => {
                      setShowPollBuilder(false);
                      setPollStart("");
                      setPollEnd("");
                    }}
                  >
                    Nevermind
                  </GhostButton>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderLocked() {
    if (editingLocked) {
      // Reuse the simple From/To input flow pre-filled
      return (
        <div className="space-y-3">
          {renderDirectInputs({ primaryLabel: "Save dates", method: "direct" })}
          <GhostButton onClick={() => setEditingLocked(false)}>Cancel</GhostButton>
        </div>
      );
    }

    if (setMethod === "poll" && hasWindows) {
      const lockedWin = windows.find(
        (w) =>
          w.start_date === trip.start_date && w.end_date === trip.end_date
      );
      return (
        <div className="space-y-2">
          {windows.map((w) => {
            const isLocked = w.id === lockedWin?.id;
            return (
              <div
                key={w.id}
                className="rounded-xl px-4 py-3 text-sm font-medium"
                style={
                  isLocked
                    ? {
                        background: "var(--color-bt-accent)",
                        color: "var(--color-bt-base)",
                      }
                    : {
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text-dim)",
                        opacity: 0.5,
                      }
                }
              >
                {formatRangeWithNights(w.start_date, w.end_date)}
              </div>
            );
          })}
          {canEdit && (
            <button
              onClick={() => setShowPickSheet(true)}
              className="text-xs font-medium"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Change date →
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {formatDateRangeCompact(trip.start_date, trip.end_date)}
        </p>
        <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {nightsBetween(trip.start_date!, trip.end_date!)} night
          {nightsBetween(trip.start_date!, trip.end_date!) !== 1 ? "s" : ""}
        </p>
        {canEdit && (
          <button
            onClick={() => {
              setDirectStart(trip.start_date ?? "");
              setDirectEnd(trip.end_date ?? "");
              setEditingLocked(true);
            }}
            className="text-xs font-medium"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Change date →
          </button>
        )}
      </div>
    );
  }

  function renderBody() {
    if (datesLocked) return renderLocked();

    // Member view: crew grid only when poll is active
    if (!canEdit) {
      if (pollActive && hasWindows) return renderCrewGrid();
      return null;
    }

    // Owner/planner: unified workspace for builder + grid + paused states
    if (showPollBuilder || hasWindows || pollActive) {
      return renderPollWorkspace();
    }

    // Empty state
    return (
      <div className="space-y-4">
        {renderDirectInputs({ primaryLabel: "Set Dates", method: "direct" })}
        <div
          className="border-t pt-3"
          style={{ borderColor: "var(--color-bt-border)" }}
        >
          <p
            className="mb-2 text-[12px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Need to coordinate schedules?
          </p>
          <button
            onClick={() => setShowPollBuilder(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
            style={{
              border: "1.5px dashed var(--color-bt-accent)",
              color: "var(--color-bt-accent)",
              background: "transparent",
            }}
          >
            <Plus size={14} />
            Poll the Crew
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PlanningRow
        icon={<Calendar size={16} />}
        label={headerLabel}
        note={headerNote}
        warnState={pollActive || (hasWindows && !pollActive)}
        state={state}
        isOpen={effectiveOpen}
        onToggle={handleToggle}
      >
        {renderBody()}
      </PlanningRow>

      {/* Pick a date sheet */}
      {showPickSheet && (
        <Sheet onClose={() => setShowPickSheet(false)} title="Pick a date">
          <div className="space-y-2">
            {windows.map((w) => {
              const yes = w.votes.filter((v) => v.answer === "yes").length;
              const maybe = w.votes.filter((v) => v.answer === "maybe").length;
              const no = w.votes.filter((v) => v.answer === "no").length;
              return (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {formatRangeWithNights(w.start_date, w.end_date)}
                    </p>
                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      {yes} works · {maybe} maybe · {no} can&apos;t
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowPickSheet(false);
                      setConfirmLock(w);
                    }}
                    className="flex-shrink-0 rounded-xl px-4 py-2 text-xs font-semibold"
                    style={{
                      background: "var(--color-bt-accent)",
                      color: "var(--color-bt-base)",
                    }}
                  >
                    Select
                  </button>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {/* Confirm lock sheet */}
      {confirmLock && (
        <Sheet
          onClose={() => setConfirmLock(null)}
          title={`Lock in ${formatDateRangeCompact(confirmLock.start_date, confirmLock.end_date)}?`}
        >
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            This locks the date for everyone. The poll closes and crew members will see
            the confirmed date.
          </p>
          <div className="mt-4 flex gap-2">
            <GhostButton onClick={() => setConfirmLock(null)}>Go back</GhostButton>
            <PrimaryButton
              disabled={lockDates.isPending}
              onClick={() => {
                const w = confirmLock;
                lockDates.mutate(
                  {
                    tripId,
                    startDate: w.start_date,
                    endDate: w.end_date,
                    method: "poll",
                    windowId: w.id,
                  },
                  {
                    onSuccess() {
                      setConfirmLock(null);
                    },
                  }
                );
              }}
            >
              {lockDates.isPending ? "Locking…" : "Lock it in"}
            </PrimaryButton>
          </div>
        </Sheet>
      )}

      {/* Confirm reset sheet */}
      {confirmReset && (
        <Sheet onClose={() => setConfirmReset(false)} title="Reset poll votes?">
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Date options will be kept but all votes will be cleared. The crew will need
            to vote again.
          </p>
          <div className="mt-4 flex gap-2">
            <GhostButton onClick={() => setConfirmReset(false)}>Cancel</GhostButton>
            <button
              disabled={resetVotes.isPending}
              onClick={() => {
                resetVotes.mutate(
                  { tripId },
                  { onSuccess: () => setConfirmReset(false) }
                );
              }}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: "var(--color-bt-danger)", color: "var(--color-bt-base)" }}
            >
              {resetVotes.isPending ? "Resetting…" : "Reset votes"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ── Small primitives ─────────────────────────────────────────────────────

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex-1">
      <label
        className="mb-1 block text-xs font-medium"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-3 py-2.5 text-sm"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
      />
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold transition-opacity"
      style={{
        background: disabled ? "var(--color-bt-card-raised)" : "var(--color-bt-accent)",
        color: disabled ? "var(--color-bt-text-dim)" : "var(--color-bt-base)",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-medium"
      style={{
        background: "transparent",
        color: "var(--color-bt-text-dim)",
        border: "0.5px solid var(--color-bt-border)",
      }}
    >
      {children}
    </button>
  );
}

function VoteButtons({
  answer,
  onChange,
  disabled,
}: {
  answer: Answer | null;
  onChange: (next: Answer) => void;
  disabled?: boolean;
}) {
  const cells: { value: Answer; icon: React.ReactNode; bg: string }[] = [
    { value: "yes", icon: <Check size={12} />, bg: "var(--color-bt-vote-yes)" },
    { value: "maybe", icon: <Minus size={12} />, bg: "var(--color-bt-vote-maybe)" },
    { value: "no", icon: <X size={12} />, bg: "var(--color-bt-vote-no)" },
  ];
  return (
    <div className="flex items-center justify-center gap-1">
      {cells.map((c) => {
        const active = answer === c.value;
        return (
          <button
            key={c.value}
            disabled={disabled}
            onClick={() => onChange(c.value)}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{
              background: active ? c.bg : "var(--color-bt-card-raised)",
              color: active ? "var(--color-bt-vote-yes-text)" : "var(--color-bt-text-dim)",
              border: active ? "none" : "1px solid var(--color-bt-border)",
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "default" : "pointer",
              pointerEvents: disabled ? "none" : "auto",
            }}
          >
            {c.icon}
          </button>
        );
      })}
    </div>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-4 sm:items-center sm:pb-0"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <p
            className="text-base font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {title}
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
