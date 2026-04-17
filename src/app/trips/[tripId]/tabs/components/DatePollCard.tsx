"use client";

import { useMemo, useState } from "react";
import { Bell, RotateCcw, X } from "lucide-react";
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

export interface DatePollCardProps {
  trip: TripData;
  isOwner: boolean;
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

/**
 * DatePollCard — the member-facing (and owner-operable) surface for the
 * date poll. Wraps ActionCard + DatePollGrid. Shows resolved chip when
 * dates are locked. Footer actions (Notify crew / Reset) are owner-only;
 * non-owners see a read-only poll with interactive cells only on their
 * own row.
 */
export function DatePollCard({ trip, isOwner }: DatePollCardProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  const [showAddDateModal, setShowAddDateModal] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const windows = useMemo(
    () => sortWindows((poll?.windows ?? []) as PollWindow[]),
    [poll?.windows]
  );

  const datesLocked = !!(trip.start_date && trip.end_date);
  const notifySent = !!poll?.notifySent;

  const pollMembers: PollMember[] = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        displayName: m.displayName,
        avatarUrl: null,
      })),
    [members]
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
            // Null answer = clear that member's vote.
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
            pollMode: true,
            windows: [newWindow],
          };
        }
        return { ...old, windows: [...old.windows, newWindow] };
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

  // When dates are locked, the date poll is not an action surface — the
  // ActionCenter renders its own "nothing needed right now" placeholder
  // (which will also cover future resolved-stage cards like RSVP / travel).
  // Returning null here keeps DatePollCard a pure poll-mode component.
  if (datesLocked) return null;

  // ── Poll-open view ─────────────────────────────────────────────────────

  const handleVote = (windowId: string, answer: VoteAnswer, userId: string) => {
    if (userId === currentUser?.id) {
      castVote.mutate({ tripId, windowId, answer });
    } else if (isOwner) {
      // Owner voting on behalf of another crew member.
      voteForMember.mutate({ tripId, windowId, userId, answer });
    }
    // Non-owner clicks on another member's cell are blocked at the grid level.
  };

  const anyVotes = windows.some((w) => w.votes.length > 0);

  const pendingRemoveWindow = confirmRemoveId
    ? windows.find((w) => w.id === confirmRemoveId) ?? null
    : null;

  return (
    <>
      {/* Panel-less container — sits directly under DatesPanel so we avoid
          the "panel inside panel" visual nesting. Matches DatesPanel's
          internal poll-grid pattern: small uppercase header + grid. */}
      <div className="space-y-2">
        <DatePollGrid
          dateWindows={windows}
          members={pollMembers}
          currentUserId={currentUser?.id ?? ""}
          isOwner={isOwner}
          onVote={handleVote}
          onAddDateWindow={isOwner ? () => setShowAddDateModal(true) : undefined}
          onLockDateWindow={
            isOwner
              ? (windowId) => lockWindow.mutate({ tripId, windowId })
              : undefined
          }
          onRemoveDateWindow={
            isOwner ? (windowId) => setConfirmRemoveId(windowId) : undefined
          }
        />

        {isOwner && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => notifyCrew.mutate({ tripId })}
              disabled={notifySent || notifyCrew.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-medium transition-opacity"
              style={{
                background: "var(--color-bt-card-raised)",
                color: notifySent
                  ? "var(--color-bt-text-dim)"
                  : "var(--color-bt-accent)",
                border: "1px solid var(--color-bt-border)",
                opacity: notifySent ? 0.6 : 1,
                cursor: notifySent ? "default" : "pointer",
              }}
            >
              <Bell size={13} />
              {notifySent ? "Crew notified" : "Notify crew"}
            </button>
            {anyVotes && (
              <button
                type="button"
                onClick={() => resetPoll.mutate({ tripId })}
                disabled={resetPoll.isPending}
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
          </div>
        )}
      </div>

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
        <p
          className="mb-4 text-xs"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Pick a start and end date for a new window the crew can vote on.
        </p>
        <div className="space-y-2">
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
