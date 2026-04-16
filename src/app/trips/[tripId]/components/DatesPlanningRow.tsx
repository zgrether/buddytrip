"use client";

import { Fragment, useMemo, useState } from "react";
import { Calendar, Plus, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useModalBackButton } from "@/hooks/useModalBackButton";
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
  onTabChange?: (tab: string) => void;
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

function formatLongDate(d: string): string {
  return parseLocalDate(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatGridLabel(start: string, end: string): string {
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

function sortWindows(ws: PollWindow[]): PollWindow[] {
  return ws.slice().sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1;
    const aDur =
      parseLocalDate(a.end_date).getTime() - parseLocalDate(a.start_date).getTime();
    const bDur =
      parseLocalDate(b.end_date).getTime() - parseLocalDate(b.start_date).getTime();
    return aDur - bDur;
  });
}

// ── Component ────────────────────────────────────────────────────────────

export function DatesPlanningRow({
  trip,
  canEdit,
  isOwner,
  isOpen,
  onToggle: _onToggle,
  onTabChange,
}: DatesPlanningRowProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  // Refresh votes every 30 s while the owner has the panel open and the poll
  // is active — lets them watch responses come in without a manual reload.
  const liveVotePolling =
    isOwner && isOpen && !!trip.poll_mode && !trip.start_date;

  const { data: poll } = trpc.datePoll.get.useQuery(
    { tripId },
    { refetchInterval: liveVotePolling ? 30_000 : false }
  );
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const windows = useMemo(
    () => sortWindows((poll?.windows ?? []) as PollWindow[]),
    [poll?.windows]
  );

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;
  const hasWindows = windows.length > 0;

  // Manual date picker state — shared between the empty/idle state and the
  // "Change dates" modal. The poll-builder uses the same state so typing a
  // range and hitting "Add to poll" bypasses any second input row.
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");

  // Modals and confirm dialogs
  const [showSelectDateModal, setShowSelectDateModal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // ── Mutations (optimistic updates from main's rewrite) ────────────────

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
              poll_mode: false,
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
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const setPollActive = trpc.datePoll.setPollMode.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old
          ? {
              ...old,
              poll_mode: vars.pollMode,
            }
          : old
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
        const newWindow = {
          id: vars.id,
          trip_id: tripId,
          start_date: vars.startDate,
          end_date: vars.endDate,
          created_at: new Date().toISOString(),
          votes: [] as { window_id: string; user_id: string; answer: string; created_at: string }[],
        };
        if (!old) {
          return {
            lockedWindowId: null,
            notifySent: false,
            pollMode: true,
            windows: [newWindow],
          };
        }
        const merged = [...old.windows, newWindow];
        merged.sort((a, b) => {
          if (a.start_date !== b.start_date)
            return a.start_date < b.start_date ? -1 : 1;
          const aDur =
            parseLocalDate(a.end_date).getTime() -
            parseLocalDate(a.start_date).getTime();
          const bDur =
            parseLocalDate(b.end_date).getTime() -
            parseLocalDate(b.start_date).getTime();
          return aDur - bDur;
        });
        return { ...old, windows: merged };
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

  const voteSelf = trpc.datePoll.castDateVote.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          windows: old.windows.map((w) => {
            if (w.id !== vars.windowId) return w;
            // Null answer = delete the vote
            if (vars.answer === null) {
              return {
                ...w,
                votes: w.votes.filter((v) => v.user_id !== currentUser?.id),
              };
            }
            const existing = w.votes.find((v) => v.user_id === currentUser?.id);
            if (existing?.answer === vars.answer) {
              return {
                ...w,
                votes: w.votes.filter((v) => v.user_id !== currentUser?.id),
              };
            }
            if (existing) {
              return {
                ...w,
                votes: w.votes.map((v) =>
                  v.user_id === currentUser?.id
                    ? { ...v, answer: vars.answer as string }
                    : v
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
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
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
            // Null answer = clear this member's vote.
            if (vars.answer === null) {
              return {
                ...w,
                votes: w.votes.filter((v) => v.user_id !== vars.userId),
              };
            }
            const existing = w.votes.find((v) => v.user_id === vars.userId);
            if (existing) {
              return {
                ...w,
                votes: w.votes.map((v) =>
                  v.user_id === vars.userId
                    ? { ...v, answer: vars.answer as string }
                    : v
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
                  answer: vars.answer as string,
                  created_at: new Date().toISOString(),
                },
              ],
            };
          }),
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

  const lockWindow = trpc.datePoll.lockDateWindow.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      // Find the window dates from the local poll cache
      const pollData = utils.datePoll.get.getData({ tripId });
      const win = pollData?.windows.find((w) => w.id === vars.windowId);
      if (win) {
        utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
          old
            ? {
                ...old,
                start_date: win.start_date,
                end_date: win.end_date,
                poll_mode: false,
              }
            : old
        );
      }
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const resetVotes = trpc.datePoll.resetPoll.useMutation({
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
    : pollMode
    ? "inProgress"
    : "none";

  const ownerDisplayName = useMemo(() => {
    const owner = members.find((m) => m.role === "Owner");
    return owner?.displayName ?? "Your organizer";
  }, [members]);

  const headerLabel = datesLocked
    ? "Dates Selected"
    : pollMode
    ? isOwner
      ? "Poll Open"
      : `Dates TBD: ${ownerDisplayName} is working on it`
    : isOwner
    ? "Set Dates"
    : `Dates TBD: ${ownerDisplayName} is working on it`;

  const headerNote = useMemo(() => {
    if (datesLocked) {
      return formatDateRangeCompact(trip.start_date, trip.end_date);
    }
    if (!isOwner) {
      return pollMode
        ? `Poll open · ${windows.length} option${windows.length !== 1 ? "s" : ""}`
        : "";
    }
    if (pollMode)
      return `Poll open · ${windows.length} option${windows.length !== 1 ? "s" : ""}`;
    return "";
  }, [datesLocked, isOwner, pollMode, windows.length, trip.start_date, trip.end_date]);

  const anyVotes = useMemo(
    () => windows.some((w) => w.votes.length > 0),
    [windows]
  );

  // ── Actions ────────────────────────────────────────────────────────────

  const handleSetDates = () => {
    if (!directStart || !directEnd || directStart >= directEnd) return;
    lockDates.mutate({
      tripId,
      startDate: directStart,
      endDate: directEnd,
    });
  };

  const handleAddToPoll = () => {
    if (!directStart || !directEnd || directStart >= directEnd) return;
    addWindow.mutate(
      {
        tripId,
        id: crypto.randomUUID(),
        startDate: directStart,
        endDate: directEnd,
      },
      {
        onSuccess() {
          setDirectStart("");
          setDirectEnd("");
        },
      }
    );
  };

  const handlePollTheCrew = () => {
    setPollActive.mutate({ tripId, pollMode: true });
  };

  const handleNevermind = () => {
    setPollActive.mutate({ tripId, pollMode: false });
  };

  // ── Body renderers ─────────────────────────────────────────────────────

  function renderDatePickerRow(buttonMode: "set" | "poll") {
    const valid = !!directStart && !!directEnd && directStart < directEnd;
    const busy =
      buttonMode === "set" ? lockDates.isPending : addWindow.isPending;
    const label =
      buttonMode === "set"
        ? lockDates.isPending
          ? "Setting…"
          : "Set dates"
        : addWindow.isPending
        ? "Adding…"
        : "Add to poll";
    return (
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={directStart}
          onChange={(e) => setDirectStart(e.target.value)}
          className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <input
          type="date"
          value={directEnd}
          onChange={(e) => setDirectEnd(e.target.value)}
          className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <button
          disabled={!valid || busy}
          onClick={buttonMode === "set" ? handleSetDates : handleAddToPoll}
          className="flex-shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity"
          style={{
            background: valid ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
            color: valid ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
            opacity: valid ? 1 : 0.6,
            cursor: valid ? "pointer" : "not-allowed",
          }}
        >
          {label}
        </button>
      </div>
    );
  }

  function renderWindowTextRows() {
    if (!hasWindows) return null;
    return (
      <div className="mb-2 space-y-1.5">
        {windows.map((w) => {
          const nights = nightsBetween(w.start_date, w.end_date);
          return (
            <div key={w.id} className="flex items-center gap-2">
              <div
                className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              >
                {formatLongDate(w.start_date)} – {formatLongDate(w.end_date)}
                <span style={{ color: "var(--color-bt-text-dim)" }}>
                  {" "}
                  · {nights} night{nights !== 1 ? "s" : ""}
                </span>
              </div>
              {canEdit && !pollMode && (
                <button
                  onClick={() =>
                    removeWindowM.mutate({ tripId, windowId: w.id })
                  }
                  disabled={removeWindowM.isPending}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                  }}
                  aria-label="Remove date from poll"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function handleGridVote(userId: string, windowId: string, next: Answer) {
    if (!userId) return;
    if (userId === currentUser?.id) {
      voteSelf.mutate({ tripId, windowId, answer: next });
    } else if (isOwner) {
      voteForMember.mutate({ tripId, windowId, userId, answer: next });
    }
  }

  function renderPollGrid() {
    return (
      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <p
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Polling
          </p>
          <div className="flex items-center gap-3">
            {isOwner && anyVotes && (
              <button
                onClick={() => setConfirmReset(true)}
                className="text-xs font-medium"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Reset votes ↻
              </button>
            )}
            <button
              onClick={() => onTabChange?.("crew")}
              className="text-xs font-medium"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Manage crew →
            </button>
          </div>
        </div>

        <div
          className="overflow-hidden overflow-x-auto rounded-xl"
          style={{ background: "var(--color-bt-card-raised)" }}
        >
          <div
            className="grid"
            style={{
              minWidth: `${100 + windows.length * 96}px`,
              gridTemplateColumns: hasWindows
                ? `auto repeat(${windows.length}, 1fr)`
                : "1fr",
            }}
          >
            {/* Header row — Select date button (or empty message) + per-window date label */}
            <div
              className="sticky top-0 z-10 flex items-center justify-center px-2 py-2"
              style={{ background: "var(--color-bt-card-raised)" }}
            >
              {hasWindows ? (
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Crew
                </span>
              ) : (
                <span
                  className="text-xs italic"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  No dates added yet
                </span>
              )}
            </div>
            {windows.map((w) => (
              <div
                key={w.id}
                className="sticky top-0 z-10 flex items-center justify-center px-2 py-2 text-center"
                style={{ background: "var(--color-bt-card-raised)" }}
              >
                <p
                  className="text-[12px] font-semibold leading-none"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {formatGridLabel(w.start_date, w.end_date)}
                </p>
              </div>
            ))}

            {/* Member rows — always visible so the crew list appears immediately */}
            {members.map((m, rowIdx) => {
                const rowBg =
                  rowIdx % 2 === 0
                    ? "var(--color-bt-state-fill)"
                    : "transparent";
                const isMe = m.user_id === currentUser?.id;
                const isInteractive =
                  !!m.user_id && (isMe || isOwner);
                return (
                  <Fragment key={m.user_id ?? rowIdx}>
                    <div
                      className="flex min-w-0 items-center gap-2 px-3 py-2"
                      style={{ background: rowBg }}
                    >
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
                    {windows.map((w) => {
                      const vote = w.votes.find((v) => v.user_id === m.user_id);
                      const answer = (vote?.answer ?? null) as Answer | null;
                      return (
                        <div
                          key={w.id}
                          className="flex items-center justify-center gap-0.5 px-1 py-2"
                          style={{ background: rowBg }}
                        >
                          {(["yes", "maybe", "no"] as const).map((type) => {
                            const active = answer === type;
                            const bg =
                              type === "yes"
                                ? "var(--color-bt-vote-yes)"
                                : type === "maybe"
                                ? "var(--color-bt-vote-maybe)"
                                : "var(--color-bt-vote-no)";
                            const labels = { yes: "✓", maybe: "~", no: "✗" };
                            return (
                              <button
                                key={type}
                                disabled={!isInteractive}
                                onClick={() =>
                                  handleGridVote(m.user_id!, w.id, type)
                                }
                                className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-all"
                                style={
                                  active
                                    ? {
                                        background: bg,
                                        color: "var(--color-bt-vote-yes-text)",
                                      }
                                    : {
                                        background: "transparent",
                                        color: "var(--color-bt-text-dim)",
                                        border:
                                          "1px dashed var(--color-bt-border)",
                                        cursor: isInteractive
                                          ? "pointer"
                                          : "default",
                                      }
                                }
                              >
                                {labels[type]}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
          </div>
        </div>

        {canEdit && (
          <>
            {/* Lifecycle buttons — open/close poll + reset */}
            <div className="flex gap-2">
              {(
                [
                  {
                    label: "Open Poll",
                    enabled: !pollMode && hasWindows,
                    onClick: () => setPollActive.mutate({ tripId, pollMode: true }),
                  },
                  {
                    label: "Close Poll",
                    enabled: pollMode,
                    onClick: () => setPollActive.mutate({ tripId, pollMode: false }),
                  },
                ] as const
              ).map(({ label, enabled, onClick }) => (
                <button
                  key={label}
                  onClick={enabled ? onClick : undefined}
                  className="flex-1 rounded-xl py-2.5 text-sm font-medium transition-opacity"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text)",
                    border: "1px solid var(--color-bt-border)",
                    opacity: enabled ? 1 : 0.35,
                    cursor: enabled ? "pointer" : "not-allowed",
                    pointerEvents: enabled ? undefined : "none",
                  }}
                >
                  {label}
                </button>
              ))}

              {/* Select date — always-on escape valve, far right */}
              {hasWindows && (
                <button
                  onClick={() => setShowSelectDateModal(true)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-medium transition-opacity"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-accent)",
                    border: "1px solid var(--color-bt-accent-border)",
                  }}
                >
                  Select date
                </button>
              )}
            </div>

            <button
              onClick={handleNevermind}
              className="w-full rounded-xl py-3 text-sm font-medium transition-colors"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              Nevermind, Set Dates Manually
            </button>
          </>
        )}
      </div>
    );
  }

  function renderMemberPollView() {
    return (
      <div className="space-y-4">
        <p
          className="text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {ownerDisplayName} is asking for everyone&apos;s input — please
          mark your availability for the dates below.
        </p>

        <div
          className="overflow-hidden overflow-x-auto rounded-xl"
          style={{ background: "var(--color-bt-card-raised)" }}
        >
          <div
            className="grid"
            style={{
              minWidth: `${100 + windows.length * 96}px`,
              gridTemplateColumns: `auto repeat(${windows.length}, 1fr)`,
            }}
          >
            {/* Header row */}
            <div
              className="sticky top-0 z-10 flex items-center justify-center px-2 py-2"
              style={{ background: "var(--color-bt-card-raised)" }}
            />
            {windows.map((w) => (
              <div
                key={w.id}
                className="sticky top-0 z-10 flex items-center justify-center px-2 py-2 text-center"
                style={{ background: "var(--color-bt-card-raised)" }}
              >
                <p
                  className="text-[12px] font-semibold leading-none"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {formatGridLabel(w.start_date, w.end_date)}
                </p>
              </div>
            ))}

            {/* Member rows — only the current user's votes are interactive */}
            {members.map((m, rowIdx) => {
              const rowBg =
                rowIdx % 2 === 0
                  ? "var(--color-bt-state-fill)"
                  : "transparent";
              const isMe = m.user_id === currentUser?.id;
              const rowOpacity = isMe ? 1 : 0.25;
              return (
                <Fragment key={m.user_id ?? rowIdx}>
                  <div
                    className="flex min-w-0 items-center gap-2 px-3 py-2"
                    style={{ background: rowBg, opacity: isMe ? 1 : rowOpacity }}
                  >
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
                  {windows.map((w) => {
                    const vote = w.votes.find((v) => v.user_id === m.user_id);
                    const answer = (vote?.answer ?? null) as Answer | null;
                    return (
                      <div
                        key={w.id}
                        className="flex items-center justify-center gap-0.5 px-1 py-2"
                        style={{ background: rowBg, opacity: isMe ? 1 : rowOpacity }}
                      >
                        {(["yes", "maybe", "no"] as const).map((type) => {
                          const active = answer === type;
                          const bg =
                            type === "yes"
                              ? "var(--color-bt-vote-yes)"
                              : type === "maybe"
                              ? "var(--color-bt-vote-maybe)"
                              : "var(--color-bt-vote-no)";
                          const labels = { yes: "✓", maybe: "~", no: "✗" };
                          return (
                            <button
                              key={type}
                              disabled={!isMe}
                              onClick={() => {
                                if (isMe && m.user_id) {
                                  voteSelf.mutate({
                                    tripId,
                                    windowId: w.id,
                                    answer: type,
                                  });
                                }
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-all"
                              style={
                                active
                                  ? {
                                      background: bg,
                                      color: "var(--color-bt-vote-yes-text)",
                                    }
                                  : {
                                      background: "transparent",
                                      color: "var(--color-bt-text-dim)",
                                      border: "1px dashed var(--color-bt-border)",
                                      cursor: isMe ? "pointer" : "default",
                                    }
                              }
                            >
                              {labels[type]}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function renderBody() {
    // Locked view: show the range and a Change dates → button.
    // For poll-set dates: go straight back to poll draft state (no modal needed).
    // For direct-set dates: open the change-dates modal.
    if (datesLocked) {
      return (
        <div className="space-y-2">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {formatLongDate(trip.start_date!)} – {formatLongDate(trip.end_date!)}
          </p>
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {nightsBetween(trip.start_date!, trip.end_date!)} night
            {nightsBetween(trip.start_date!, trip.end_date!) !== 1 ? "s" : ""}
          </p>
        </div>
      );
    }

    // Non-owner view: simplified poll-only panel (Planners and Members alike)
    if (!isOwner) {
      if (pollMode && hasWindows) return renderMemberPollView();
      return null;
    }

    // Owner view — input row visible whenever poll is not yet open
    const showInputRow = !pollMode;

    return (
      <div className="space-y-0">
        {showInputRow && (
          <>
            <p
              className="mb-3 text-[13px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              When are you going?
            </p>

            {/* Date pickers + action button */}
            {renderDatePickerRow("set")}

            <p
              className="mt-2 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Once set, dates can only be changed from the trip settings.
            </p>

            {/* Poll the crew — direct mode escape to poll flow */}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handlePollTheCrew}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
                style={{
                  border: "1.5px dashed var(--color-bt-accent)",
                  color: "var(--color-bt-accent)",
                  background: "transparent",
                }}
              >
                <Plus size={14} />
                Poll the crew
              </button>
            </div>
          </>
        )}

        {/* Polling grid — visible whenever poll mode is on */}
        {pollMode && renderPollGrid()}
      </div>
    );
  }

  return (
    <>
      <PlanningRow
        icon={<Calendar size={16} />}
        label={headerLabel}
        note={headerNote}
        warnState={pollMode}
        state={state}
        isOpen={true}
        onToggle={() => {}}
        noExpand={true}
      >
        {renderBody()}
      </PlanningRow>

      {/* Select date modal — pick a winning window from the poll */}
      {showSelectDateModal && (
        <SelectDateModal
          windows={windows}
          pending={lockWindow.isPending}
          onClose={() => setShowSelectDateModal(false)}
          onSelect={(w) =>
            lockWindow.mutate(
              { tripId, windowId: w.id },
              {
                onSuccess() {
                  setShowSelectDateModal(false);
                },
              }
            )
          }
        />
      )}

      {/* Confirm reset votes dialog */}
      {confirmReset && (
        <ConfirmDialog
          title="Reset poll votes?"
          body="Date options will be kept but all votes will be cleared. The crew will need to vote again."
          cancelLabel="Cancel"
          confirmLabel={resetVotes.isPending ? "Resetting…" : "Reset votes"}
          confirmDanger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() =>
            resetVotes.mutate(
              { tripId },
              { onSuccess: () => setConfirmReset(false) }
            )
          }
        />
      )}
    </>
  );
}

// ── SelectDateModal ──────────────────────────────────────────────────────

function SelectDateModal({
  windows,
  pending,
  onClose,
  onSelect,
}: {
  windows: PollWindow[];
  pending: boolean;
  onClose: () => void;
  onSelect: (w: PollWindow) => void;
}) {
  useModalBackButton(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl p-5 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
      >
        <div className="mb-2 flex items-center justify-between">
          <p
            className="text-base font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Pick a date
          </p>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p
          className="mb-4 text-xs"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Once selected, dates can only be changed from the trip settings.
        </p>
        <div className="space-y-2">
          {windows.map((w) => {
            const nights = nightsBetween(w.start_date, w.end_date);
            const yesCount = w.votes.filter((v) => v.answer === "yes").length;
            const maybeCount = w.votes.filter((v) => v.answer === "maybe").length;
            const noCount = w.votes.filter((v) => v.answer === "no").length;
            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--color-bt-card-raised)" }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-semibold leading-tight"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {formatLongDate(w.start_date)} – {formatLongDate(w.end_date)}
                  </p>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    {nights} night{nights !== 1 ? "s" : ""}
                  </p>
                  {yesCount + maybeCount + noCount > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      {yesCount > 0 && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: "var(--color-bt-vote-yes)",
                            color: "var(--color-bt-vote-yes-text)",
                          }}
                        >
                          ✓ {yesCount}
                        </span>
                      )}
                      {maybeCount > 0 && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: "var(--color-bt-vote-maybe)",
                            color: "var(--color-bt-vote-yes-text)",
                          }}
                        >
                          ~ {maybeCount}
                        </span>
                      )}
                      {noCount > 0 && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: "var(--color-bt-vote-no)",
                            color: "var(--color-bt-vote-yes-text)",
                          }}
                        >
                          ✗ {noCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  disabled={pending}
                  onClick={() => onSelect(w)}
                  className="flex-shrink-0 rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                  }}
                >
                  {pending ? "…" : "Select"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── ConfirmDialog ────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  body,
  cancelLabel,
  confirmLabel,
  confirmDanger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmDanger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useModalBackButton(onCancel);
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
        <p
          className="text-base font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {title}
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          {body}
        </p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl py-2.5 text-sm font-medium"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{
              background: confirmDanger
                ? "var(--color-bt-danger)"
                : "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
