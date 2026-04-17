"use client";

import { useMemo, useState } from "react";
import { Calendar, Plus, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { parseLocalDate, formatDateRangeCompact } from "@/lib/dates";
import { PlanningRow, type ArcCardState } from "./PlanningRow";
import type { TripData } from "../tabs/types";

// ── Types ────────────────────────────────────────────────────────────────

interface DatesPanelProps {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onTabChange?: (tab: string) => void;
}

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

export function DatesPanel({
  trip,
  canEdit: _canEdit,
  isOwner,
  isOpen,
  onToggle: _onToggle,
  onTabChange: _onTabChange,
}: DatesPanelProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();

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

  // Manual date picker state — shared between the empty/idle state and the
  // "Change dates" modal. The poll-builder uses the same state so typing a
  // range and hitting "Add to poll" bypasses any second input row.
  const [directStart, setDirectStart] = useState("");
  const [directEnd, setDirectEnd] = useState("");

  // Modals and confirm dialogs
  const [showSelectDateModal, setShowSelectDateModal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Inline cancel-poll confirmation (no modal — renders below the cancel button)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

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

    // DatesPanel is owner-only (ActionCenter hides it from non-owners —
    // they see DatePollCard directly). Defensive null for any other path.
    if (!isOwner) return null;

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

        {/* Poll-active state — date pickers grayed out + amber cancel button */}
        {pollMode && (
          <div className="mt-3 space-y-3">
            {/* Date pickers — visible but non-interactive to show the direct
                entry path is temporarily unavailable while the poll is open */}
            <div style={{ opacity: 0.4, pointerEvents: "none" }}>
              {renderDatePickerRow("set")}
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Once set, dates can only be changed from the trip settings.
              </p>
            </div>

            {/* Amber dashed cancel button — caution, not primary action */}
            <button
              type="button"
              onClick={() => setShowCancelConfirm((v) => !v)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
              style={{
                border: "1.5px dashed var(--color-bt-warning)",
                color: "var(--color-bt-warning)",
                background: "transparent",
              }}
            >
              <X size={14} />
              Nevermind — cancel poll, set dates instead
            </button>

            {/* Inline confirmation row — no modal, renders directly below */}
            {showCancelConfirm && (
              <div className="flex items-center justify-between px-1 pt-1">
                <span
                  className="text-xs"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  This will clear all votes. Are you sure?
                </span>
                <div className="flex gap-2">
                  {/* Ghost small */}
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className="rounded-xl px-3 py-1.5 text-xs font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--color-bt-text-dim)",
                      border: "0.5px solid var(--color-bt-border)",
                    }}
                  >
                    Keep poll
                  </button>
                  {/* Danger small */}
                  <button
                    type="button"
                    onClick={() => {
                      setPollActive.mutate({ tripId, pollMode: false });
                      setShowCancelConfirm(false);
                    }}
                    disabled={setPollActive.isPending}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: "var(--color-bt-danger)",
                      color: "white",
                    }}
                  >
                    {setPollActive.isPending ? "Cancelling…" : "Yes, cancel"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Poll-active owner view — flat non-collapsible header row ────────────
  // Matches the lodging empty-state pattern: icon · title/subtitle · action
  // button inline on the right. No body, no chevron, no collapse handler.
  if (pollMode && isOwner && !datesLocked) {
    return (
      <div
        className="rounded-xl border"
        style={{
          background: "var(--color-bt-card)",
          borderColor: "var(--color-bt-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          {/* Icon */}
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-card-raised)" }}
          >
            <Calendar size={16} style={{ color: "var(--color-bt-accent)" }} />
          </div>

          {/* Title + subtitle */}
          <div className="min-w-0 flex-1">
            <div
              className="text-sm font-semibold"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Poll Open
            </div>
            <div
              className="mt-0.5 text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Poll open · {windows.length} option{windows.length !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Cancel button — hidden when confirm row is showing */}
          {!showCancelConfirm && (
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{
                border: "1.5px dashed var(--color-bt-warning)",
                color: "var(--color-bt-warning)",
                background: "transparent",
              }}
            >
              Nevermind — cancel poll
            </button>
          )}
        </div>

        {/* Inline confirmation — below header row, inside same card */}
        {showCancelConfirm && (
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-0">
            <span
              className="text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              This will clear all votes. Are you sure?
            </span>
            <div className="flex shrink-0 gap-2">
              {/* Ghost small */}
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: "transparent",
                  color: "var(--color-bt-text-dim)",
                  border: "0.5px solid var(--color-bt-border)",
                }}
              >
                Keep poll
              </button>
              {/* Danger small */}
              <button
                type="button"
                onClick={() => {
                  setPollActive.mutate({ tripId, pollMode: false });
                  setShowCancelConfirm(false);
                }}
                disabled={setPollActive.isPending}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: "var(--color-bt-danger)",
                  color: "var(--color-bt-base)",
                }}
              >
                {setPollActive.isPending ? "Cancelling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        )}
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
