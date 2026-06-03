"use client";

import { useMemo, useState } from "react";
import { ThumbsUp } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseLocalDate } from "@/lib/dates";
import type { TripData } from "../types";
import type {
  PollMember,
  PollWindow,
  VoteAnswer,
} from "./DatePollGrid";
import { DatePollStackedCards } from "./DatePollStackedCards";
import { ConfirmDatesModal } from "../../components/ConfirmDatesModal";

export interface DatePollCardProps {
  trip: TripData;
  isOwner: boolean;
  /** Owner / planner only — shown as "Manage →" in the Crew column header. */
  onManageCrew?: () => void;
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
 * date poll. Footer actions (Reset) are owner-only.
 *
 * Features:
 * - Poll note: owner-editable instructional text shown to all crew above the grid.
 * - Reset confirmation: two-step confirm before clearing all votes.
 * - All-voted banner: thumbs-up shown to any user once they've responded to every window.
 */
export function DatePollCard({ trip, isOwner, onManageCrew }: DatePollCardProps) {
  const tripId = trip.id;
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  // Pending window to lock — set when owner clicks "Lock in [range]";
  // cleared when the ConfirmDatesModal is confirmed or cancelled.
  // Add/remove confirms live inside DatePollStackedCards (inline confirm
  // pattern); reset/cancel-poll likewise (footer escape hatch).
  const [pendingLockWindowId, setPendingLockWindowId] = useState<string | null>(null);

  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const windows = useMemo(
    () => sortWindows((poll?.windows ?? []) as PollWindow[]),
    [poll?.windows]
  );

  const pollMembers: PollMember[] = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        displayName: m.displayName,
        avatarIcon: (m as { user?: { avatar_icon?: string | null } | null }).user?.avatar_icon ?? null,
      })),
    [members]
  );

  // Owner's display name — surfaced in the member view's "Dates are being
  // picked" intro header and the empty-state body ("{Owner} hasn't posted
  // any windows yet"). Falls back to a neutral noun if the owner record
  // isn't loaded yet (or somehow missing — defensive).
  const ownerName = useMemo(() => {
    const owner = (members as Array<{ role?: string | null; displayName: string }>)
      .find((m) => m.role === "Owner");
    return owner?.displayName ?? "The organizer";
  }, [members]);

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
            pollNote: null,
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
    onSuccess() {
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

  const resetPoll = trpc.datePoll.resetPoll.useMutation({
    async onMutate() {
      await utils.datePoll.get.cancel({ tripId });
      const prev = utils.datePoll.get.getData({ tripId });
      utils.datePoll.get.setData({ tripId }, (old) =>
        old
          ? {
              ...old,
              windows: old.windows.map((w) => ({ ...w, votes: [] })),
            }
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

  // ── Poll-open view ─────────────────────────────────────────────────────

  const handleVote = (windowId: string, answer: VoteAnswer, userId: string) => {
    if (userId === currentUser?.id) {
      castVote.mutate({ tripId, windowId, answer });
    } else if (isOwner) {
      voteForMember.mutate({ tripId, windowId, userId, answer });
    }
  };

  // Touch unused symbols so a future refactor can rewire them cleanly.
  // `anyVotes` was the gate for the legacy Reset row (now superseded by
  // the per-card delete / cancel-poll flow inside DatePollStackedCards);
  // `resetPoll` is still wired in case we add a "clear my votes" affordance.
  void windows.some((w) => w.votes.length > 0);
  void resetPoll;

  return (
    <>
      {/* Cap the whole poll surface at 720px so the cards stay readable
          on wide screens — beyond that the tally bar + roster chips
          spread too thin and the eye loses the per-card unit. The cap
          covers the member intro header too so it aligns with the
          panel underneath. */}
      <div className="space-y-2" style={{ maxWidth: 720 }}>
        {/* ── Member intro header ─────────────────────────────────────
            The owner sees the FreshTripGuide header upstream ("Now let's
            lock the dates" — see FreshTripGuide.tsx); members come into
            this surface cold via ItineraryPanel and need the same context
            framing. Eyebrow + headline + body matches the shared
            TabHeader cadence (11px accent eyebrow, clamp-scaled
            semibold headline, 15px body at 1.65 line-height). */}
        {!isOwner && (
          <header className="mb-3">
            <p
              className="mb-3 text-[11px] font-semibold uppercase"
              style={{ color: "var(--color-bt-accent)", letterSpacing: "0.1em" }}
            >
              Date poll
            </p>
            <h2
              className="mb-3 font-semibold"
              style={{
                color: "var(--color-bt-text)",
                fontSize: "clamp(20px, 2.8vw, 26px)",
                lineHeight: 1.15,
                letterSpacing: "-0.015em",
              }}
            >
              Dates are being picked
            </h2>
            <p
              className="max-w-prose"
              style={{
                color: "var(--color-bt-text-dim)",
                fontSize: 15,
                lineHeight: 1.65,
              }}
            >
              {ownerName}&rsquo;s lining up a few date options for the trip.
              Once they&rsquo;re posted, you&rsquo;ll vote on each one right
              here.
            </p>
          </header>
        )}

        {/* ── Stacked option cards — new presentation layer per
            HANDOFF-datepoll.md. DatePollGrid (Doodle-style table) is
            superseded; deleting it is flagged as a follow-up. The card
            component owns all per-card UX (radio select, expand to
            roster, override popover, inline remove confirm, inline add
            calendar, cancel-poll confirm). Mutations stay here. ──── */}
        <DatePollStackedCards
          windows={windows}
          members={pollMembers}
          currentUserId={currentUser?.id ?? ""}
          isOwner={isOwner}
          ownerName={ownerName}
          onVote={handleVote}
          onAddWindow={
            isOwner
              ? (startDate, endDate) =>
                  addWindow.mutate({
                    tripId,
                    id: crypto.randomUUID(),
                    startDate,
                    endDate,
                  })
              : undefined
          }
          onRemoveWindow={
            isOwner
              ? (windowId) => removeWindow.mutate({ tripId, windowId })
              : undefined
          }
          onLockWindow={
            isOwner ? (windowId) => setPendingLockWindowId(windowId) : undefined
          }
          onCancelPoll={
            isOwner
              ? () => endPoll.mutate({ tripId, pollMode: false })
              : undefined
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
      </div>

      {/* Confirm dates modal — shown when owner clicks "Lock in [range]".
          Kept as a final guard before changing the trip dates; the rest
          of the poll's confirm gates (remove option, cancel poll) live
          inline inside the card. */}
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
    </>
  );
}

