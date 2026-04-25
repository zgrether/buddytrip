"use client";

import { useMemo, useRef, useState } from "react";
import { Bell, Info, Pencil, RotateCcw, ThumbsUp, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { parseLocalDate } from "@/lib/dates";
import type { TripData } from "../types";
import {
  DatePollGrid,
  type PollMember,
  type PollWindow,
  type VoteAnswer,
} from "./DatePollGrid";
import { ConfirmDatesModal } from "../../components/ConfirmDatesModal";

export interface DatePollCardProps {
  trip: TripData;
  isOwner: boolean;
  /** Owner / planner only — shown as "Manage →" in the Crew column header. */
  onManageCrew?: () => void;
}

const DEFAULT_POLL_NOTE =
  "We're trying to get a feel for everyone's availability before locking in a date — let us know what you think about these options.";

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

/**
 * DatePollCard — the member-facing (and owner-operable) surface for the
 * date poll. Footer actions (Notify crew / Reset) are owner-only.
 *
 * Features:
 * - Poll note: owner-editable instructional text shown to all crew above the grid.
 * - Reset confirmation: two-step confirm before clearing all votes.
 * - Smart re-notify: Notify button re-enables after a new date is added,
 *   a reset is performed, or new members have joined since the last notify.
 * - All-voted banner: thumbs-up shown to any user once they've responded to every window.
 */
export function DatePollCard({ trip, isOwner, onManageCrew }: DatePollCardProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  const [showAddDateModal, setShowAddDateModal] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Pending window to lock — set when owner clicks "Select this date";
  // cleared when the ConfirmDatesModal is confirmed or cancelled.
  const [pendingLockWindowId, setPendingLockWindowId] = useState<string | null>(null);

  // Re-notify state:
  // hasFiredNotify latches true on success so refetch races can't re-enable
  // the button. Cleared only when a re-enable event fires (new date / reset).
  const [hasFiredNotify, setHasFiredNotify] = useState(false);
  // Track the member IDs present at the time of last notification so we can
  // identify newly-added members for targeted re-notification.
  const [memberIdsAtNotify, setMemberIdsAtNotify] = useState<string[] | null>(null);
  // "new-date" | "reset" | null — drives the button label copy.
  const [renotifyReason, setRenotifyReason] = useState<"new-date" | "reset" | null>(null);

  // Poll note modal + editor
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState<string>("");
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const windows = useMemo(
    () => sortWindows((poll?.windows ?? []) as PollWindow[]),
    [poll?.windows]
  );

  const datesLocked = !!(trip.start_date && trip.end_date);
  const notifySent = !!poll?.notifySent;

  // Identify members who joined after the last crew-wide notification.
  // newMemberIds is non-empty only after at least one full notify has been sent.
  const newMemberIds: string[] = memberIdsAtNotify !== null
    ? members
        .filter((m) => m.user_id && !memberIdsAtNotify.includes(m.user_id))
        .map((m) => m.user_id!)
    : [];
  const hasNewMembers = newMemberIds.length > 0;

  // Button is disabled when notifySent (server) OR hasFiredNotify (local latch).
  // Re-enabled explicitly when: addWindow fires, resetPoll fires, or new members joined.
  const canNotify = !(notifySent || hasFiredNotify) || hasNewMembers || renotifyReason !== null;

  // Derive the button label from the current re-notify context.
  // renotifyReason (new date / reset) takes priority over new members because
  // those events mean we want to notify everyone, not just the new members.
  const notifyButtonLabel = !canNotify
    ? "Crew notified"
    : renotifyReason === "new-date"
    ? "Notify crew about the new date"
    : renotifyReason === "reset"
    ? "Notify crew again"
    : hasNewMembers
    ? "Notify new crew members"
    : "Notify crew";

  const pollNote = poll?.pollNote ?? null;
  const displayNote = pollNote ?? DEFAULT_POLL_NOTE;

  const pollMembers: PollMember[] = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        displayName: m.displayName,
        avatarUrl: null,
      })),
    [members]
  );

  // Has the current user voted on every available window?
  const allWindowsVoted =
    windows.length > 0 &&
    windows.every((w) =>
      w.votes.some((v) => v.user_id === currentUser?.id && v.answer != null)
    );

  // ── Mutations ──────────────────────────────────────────────────────────

  const castVote = trpc.datePoll.castDateVote.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          windows: old.windows.map((w) => {
            if (w.id !== vars.windowId) return w;
            if (vars.answer === null) {
              return {
                ...w,
                votes: w.votes.filter((v) => v.user_id !== currentUser?.id),
              };
            }
            const existing = w.votes.find((v) => v.user_id === currentUser?.id);
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
          votes: [] as {
            window_id: string;
            user_id: string;
            answer: string;
            created_at: string;
          }[],
        };
        if (!old) {
          return {
            lockedWindowId: null,
            notifySent: false,
            pollNote: null,
            pollMode: true,
            windows: [newWindow],
          };
        }
        // Optimistically reset notifySent so the button re-enables immediately.
        return { ...old, notifySent: false, windows: [...old.windows, newWindow] };
      });
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setHasFiredNotify(false);
      if (notifySent || hasFiredNotify) {
        setRenotifyReason("new-date");
      }
      if (!trip.poll_mode) {
        activatePoll.mutate({ tripId, pollMode: true });
      }
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const removeWindow = trpc.datePoll.removeWindow.useMutation({
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

  const lockWindow = trpc.datePoll.lockDateWindow.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
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

  const notifyCrew = trpc.datePoll.notifyCrewPollOpen.useMutation({
    async onMutate() {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) =>
        old ? { ...old, notifySent: true } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setHasFiredNotify(true);
      setMemberIdsAtNotify(
        members.map((m) => m.user_id!).filter(Boolean)
      );
      setRenotifyReason(null);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const resetPoll = trpc.datePoll.resetPoll.useMutation({
    async onMutate() {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) =>
        old
          ? {
              ...old,
              notifySent: false,
              windows: old.windows.map((w) => ({ ...w, votes: [] })),
            }
          : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setShowResetConfirm(false);
      setHasFiredNotify(false);
      setRenotifyReason("reset");
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // Ends (kills) the poll — clears all windows + votes, sets poll_mode = false.
  const endPoll = trpc.datePoll.setPollMode.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, poll_mode: false } : old
      );
      return { prevTrip };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prevTrip !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prevTrip);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  // Activates the poll (poll_mode = true) the first time a date window is added.
  const activatePoll = trpc.datePoll.setPollMode.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prevTrip = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, poll_mode: true } : old
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

  const notifyNewMembersM = trpc.datePoll.notifyNewMembers.useMutation({
    onSuccess() {
      // Absorb notified members into the tracked set so they're no longer "new"
      setMemberIdsAtNotify(
        members.map((m) => m.user_id!).filter(Boolean)
      );
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  const updatePollNote = trpc.datePoll.updatePollNote.useMutation({
    async onMutate(vars) {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) =>
        old ? { ...old, pollNote: vars.note } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.datePoll.get.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setEditingNote(false);
    },
    onSettled() {
      utils.datePoll.get.invalidate({ tripId });
    },
  });

  if (datesLocked) return null;

  // ── Poll-open view ─────────────────────────────────────────────────────

  const handleVote = (windowId: string, answer: VoteAnswer, userId: string) => {
    if (userId === currentUser?.id) {
      castVote.mutate({ tripId, windowId, answer });
    } else if (isOwner) {
      voteForMember.mutate({ tripId, windowId, userId, answer });
    }
  };

  const anyVotes = windows.some((w) => w.votes.length > 0);

  const pendingRemoveWindow = confirmRemoveId
    ? windows.find((w) => w.id === confirmRemoveId) ?? null
    : null;

  const handleSaveNote = () => {
    const trimmed = noteValue.trim();
    updatePollNote.mutate({ tripId, note: trimmed || null });
  };

  const handleStartEditNote = () => {
    setNoteValue(pollNote ?? "");
    setEditingNote(true);
    setShowNoteModal(true);
    setTimeout(() => {
      noteTextareaRef.current?.focus();
      noteTextareaRef.current?.select();
    }, 0);
  };

  return (
    <>
      <div className="space-y-2">
        {/* ── Instructions button — opens note modal ── */}
        {windows.length > 0 && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setNoteValue(pollNote ?? "");
                setEditingNote(false);
                setShowNoteModal(true);
              }}
              className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-70"
              style={{ color: "var(--color-bt-text-dim)", background: "transparent", border: "none" }}
            >
              <Info size={13} />
              Crew Instructions
              {isOwner && <Pencil size={11} style={{ color: "var(--color-bt-accent)", opacity: 0.7 }} />}
            </button>
          </div>
        )}

        {/* ── Note modal ── */}
        {showNoteModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowNoteModal(false); setEditingNote(false); } }}
          >
            <div
              className="w-full max-w-md rounded-2xl p-5 shadow-xl"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                  Crew Instructions
                </h3>
                <button
                  type="button"
                  onClick={() => { setShowNoteModal(false); setEditingNote(false); }}
                  className="rounded-lg p-1 transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X size={16} />
                </button>
              </div>

              {editingNote ? (
                <div className="space-y-3">
                  <textarea
                    ref={noteTextareaRef}
                    value={noteValue}
                    onChange={(e) => setNoteValue(e.target.value)}
                    rows={4}
                    maxLength={500}
                    placeholder={DEFAULT_POLL_NOTE}
                    className="w-full resize-none rounded-xl px-3 py-2.5 text-[13px] leading-relaxed outline-none"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-accent)",
                      color: "var(--color-bt-text)",
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingNote(false)}
                      className="flex-1 rounded-xl py-2 text-[13px] font-medium"
                      style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => { handleSaveNote(); setShowNoteModal(false); }}
                      disabled={updatePollNote.isPending}
                      className="flex-1 rounded-xl py-2 text-[13px] font-semibold disabled:opacity-40"
                      style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                    >
                      {updatePollNote.isPending ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p
                    className="text-[13px] leading-relaxed"
                    style={{
                      color: pollNote ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
                      fontStyle: pollNote ? "normal" : "italic",
                    }}
                  >
                    {displayNote}
                  </p>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={handleStartEditNote}
                      className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-bt-accent)", background: "transparent", border: "none" }}
                    >
                      <Pencil size={12} /> Edit instructions
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Date poll grid ─────────────────────────────────────────────── */}
        <DatePollGrid
          dateWindows={windows}
          members={pollMembers}
          currentUserId={currentUser?.id ?? ""}
          isOwner={isOwner}
          onVote={handleVote}
          onAddDateWindow={isOwner ? () => setShowAddDateModal(true) : undefined}
          onLockDateWindow={
            isOwner
              ? (windowId) => setPendingLockWindowId(windowId)
              : undefined
          }
          onRemoveDateWindow={
            isOwner ? (windowId) => setConfirmRemoveId(windowId) : undefined
          }
          onManageCrew={onManageCrew}
        />

        {/* ── All-voted confirmation (non-owners only) ──────────────────── */}
        {allWindowsVoted && !isOwner && (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-state-fill)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            <ThumbsUp
              size={14}
              style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
            />
            <p
              className="text-[12px] leading-snug"
              style={{ color: "var(--color-bt-text)" }}
            >
              Thanks for the feedback, we&apos;ll be selecting a date soon!
            </p>
          </div>
        )}

        {/* ── Owner footer: Notify + Reset (only once dates exist) ─────── */}
        {windows.length > 0 && isOwner && (
          <div className="flex items-center gap-2 pt-1">
            {showResetConfirm ? (
              /* Notify hides; three confirm buttons fill the row */
              <>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 rounded-xl py-2 text-[13px] font-medium"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text-dim)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => resetPoll.mutate({ tripId })}
                  disabled={resetPoll.isPending}
                  className="flex-1 rounded-xl py-2 text-[13px] font-semibold"
                  style={{ background: "var(--color-bt-danger)", color: "var(--color-bt-base)" }}
                >
                  {resetPoll.isPending ? "Clearing…" : "Clear votes?"}
                </button>
                <button
                  type="button"
                  onClick={() => endPoll.mutate({ tripId, pollMode: false })}
                  disabled={endPoll.isPending}
                  className="flex-1 rounded-xl py-2 text-[13px] font-semibold"
                  style={{ background: "var(--color-bt-danger)", color: "var(--color-bt-base)" }}
                >
                  {endPoll.isPending ? "Clearing…" : "Clear poll?"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!canNotify) return;
                    if (hasNewMembers && !renotifyReason) {
                      notifyNewMembersM.mutate({ tripId, userIds: newMemberIds });
                    } else {
                      notifyCrew.mutate({ tripId });
                    }
                  }}
                  disabled={!canNotify || notifyCrew.isPending || notifyNewMembersM.isPending}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-medium transition-opacity"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: canNotify ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                    border: "1px solid var(--color-bt-border)",
                    opacity: canNotify ? 1 : 0.6,
                    cursor: canNotify ? "pointer" : "default",
                  }}
                >
                  <Bell size={13} />
                  {notifyButtonLabel}
                </button>
                {anyVotes && (
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-opacity"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text-dim)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                    aria-label="Reset votes"
                  >
                    <RotateCcw size={13} />
                    Reset
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Confirm dates modal — shown when owner clicks "Select this date" */}
      {(() => {
        const win = pendingLockWindowId
          ? windows.find((w) => w.id === pendingLockWindowId) ?? null
          : null;
        if (!win) return null;
        return (
          <ConfirmDatesModal
            startDate={win.start_date}
            endDate={win.end_date}
            fromPollWindow={true}
            hasPoll={true}
            isPending={lockWindow.isPending}
            onConfirm={() => {
              lockWindow.mutate({ tripId, windowId: win.id });
              setPendingLockWindowId(null);
            }}
            onCancel={() => setPendingLockWindowId(null)}
          />
        );
      })()}

      {/* Add date window modal */}
      {showAddDateModal && (
        <AddDateWindowModal
          pending={addWindow.isPending}
          onClose={() => setShowAddDateModal(false)}
          onSubmit={(startDate, endDate) => {
            addWindow.mutate(
              {
                tripId,
                id: crypto.randomUUID(),
                startDate,
                endDate,
              },
              {
                onSuccess() {
                  setShowAddDateModal(false);
                },
              }
            );
          }}
        />
      )}

      {/* Confirm remove dialog */}
      {pendingRemoveWindow && (
        <ConfirmDialog
          title="Remove this date option?"
          body="This will delete the option and any votes already cast for it."
          cancelLabel="Cancel"
          confirmLabel={removeWindow.isPending ? "Removing…" : "Remove"}
          confirmDanger
          onCancel={() => setConfirmRemoveId(null)}
          onConfirm={() =>
            removeWindow.mutate(
              { tripId, windowId: pendingRemoveWindow.id },
              { onSuccess: () => setConfirmRemoveId(null) }
            )
          }
        />
      )}
    </>
  );
}

// ── AddDateWindowModal ───────────────────────────────────────────────────

function AddDateWindowModal({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (startDate: string, endDate: string) => void;
}) {
  useModalBackButton(onClose);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const valid = !!startDate && !!endDate && startDate < endDate;

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
            Add a date option
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
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              End date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-medium"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
            }}
          >
            Cancel
          </button>
          <button
            disabled={!valid || pending}
            onClick={() => valid && onSubmit(startDate, endDate)}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{
              background: valid ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
              color: valid ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
              opacity: valid ? 1 : 0.6,
              cursor: valid ? "pointer" : "not-allowed",
            }}
          >
            {pending ? "Adding…" : "Add date"}
          </button>
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
        <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
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
