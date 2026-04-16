"use client";

import { useMemo } from "react";
import { Calendar, Bell, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateRangeCompact, parseLocalDate } from "@/lib/dates";
import type { TripData } from "../types";
import { ActionCard } from "./ActionCard";
import {
  DatePollGrid,
  type PollMember,
  type PollWindow,
  type VoteAnswer,
} from "./DatePollGrid";

export interface DatePollCardProps {
  trip: TripData;
  canEdit: boolean;
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
 * DatePollCard — the member-facing (and canEdit-viewable) surface for the
 * date poll. Wraps ActionCard + DatePollGrid. Shows resolved chip when
 * dates are locked. Footer actions (Notify crew / Reset) visible to canEdit.
 */
export function DatePollCard({ trip, canEdit, isOwner }: DatePollCardProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

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

  const notifyCrew = trpc.datePoll.notifyCrewPollOpen.useMutation({
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

  // ── Resolved view ──────────────────────────────────────────────────────

  if (datesLocked) {
    return (
      <ActionCard
        icon={<Calendar size={16} />}
        title="Dates locked"
        isResolved
        resolvedSummary={formatDateRangeCompact(trip.start_date, trip.end_date)}
      />
    );
  }

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

  return (
    <ActionCard
      icon={<Calendar size={16} />}
      title="Pick your dates"
      subtitle={isOwner ? "Tap any cell to vote on behalf of a crew member" : "Tap your row to cast a vote"}
      isResolved={false}
    >
      <div className="space-y-3">
        <DatePollGrid
          dateWindows={windows}
          members={pollMembers}
          currentUserId={currentUser?.id ?? ""}
          canEdit={canEdit}
          isOwner={isOwner}
          onVote={handleVote}
        />

        {canEdit && (
          <div className="flex items-center gap-2">
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
    </ActionCard>
  );
}
