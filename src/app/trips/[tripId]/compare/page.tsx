"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { TripBreadcrumb } from "@/components/TripBreadcrumb";
import {
  ThumbsUp,
  Lock,
  MapPin,
  Star,
  Flag,
  Zap,
  Plus,
  X,
  DollarSign,
  MessageSquare,
  Send,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ── Types ─────────────────────────────────────────────────────────────────

interface IdeaVote {
  idea_id: string;
  user_id: string;
}

interface Idea {
  id: string;
  trip_id: string;
  title: string;
  location: string;
  description?: string | null;
  golf_courses?: string[] | null;
  activities?: string[] | null;
  cost_tier?: string | null;
  pros?: string[] | null;
  cons?: string[] | null;
  accommodation?: string | null;
  notes?: string | null;
  image_url?: string | null;
  votes: IdeaVote[];
}

// ── CommentsSection ───────────────────────────────────────────────────────

function CommentsSection({ tripId, ideaId }: { tripId: string; ideaId: string }) {
  const [text, setText] = useState("");
  const utils = trpc.useUtils();

  const { data: comments = [] } = trpc.ideaComments.list.useQuery({ tripId, ideaId });
  const addComment = trpc.ideaComments.create.useMutation({
    onSuccess() {
      setText("");
      utils.ideaComments.list.invalidate({ tripId, ideaId });
    },
  });

  return (
    <div>
      <p
        className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <MessageSquare size={10} />
        Comments
      </p>

      {comments.length > 0 && (
        <div className="mb-3 space-y-2">
          {comments.map((c) => (
            <p
              key={c.id}
              className="rounded-lg px-3 py-2 text-xs leading-relaxed"
              style={{
                background: "var(--color-bt-base)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              {c.text}
            </p>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          addComment.mutate({ tripId, ideaId, id: crypto.randomUUID(), text: t });
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <button
          type="submit"
          disabled={addComment.isPending || !text.trim()}
          className="flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          aria-label="Post comment"
        >
          <Send size={12} />
        </button>
      </form>
    </div>
  );
}

// ── IdeaCard ─────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  tripId,
  isVoted,
  canEdit,
  isOwner,
  totalMembers,
  onLock,
}: {
  idea: Idea;
  tripId: string;
  isVoted: boolean;
  canEdit: boolean;
  isOwner: boolean;
  totalMembers: number;
  onLock: (idea: Idea) => void;
}) {
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  const vote = trpc.ideas.vote.useMutation({
    async onMutate({ ideaId }) {
      await utils.ideas.list.cancel({ tripId });
      const prev = utils.ideas.list.getData({ tripId });
      utils.ideas.list.setData({ tripId }, (prev ?? []).map((idea) => {
        if (idea.id !== ideaId) return idea;
        const alreadyVoted = idea.votes.some((v: { user_id: string }) => v.user_id === currentUser?.id);
        return {
          ...idea,
          votes: alreadyVoted
            ? idea.votes.filter((v: { user_id: string }) => v.user_id !== currentUser?.id)
            : [...idea.votes, { idea_id: ideaId, user_id: currentUser?.id ?? "", created_at: new Date().toISOString() }],
        };
      }));
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.ideas.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.ideas.list.invalidate({ tripId });
    },
  });
  const removeIdea = trpc.ideas.remove.useMutation({
    onSuccess: () => utils.ideas.list.invalidate({ tripId }),
  });

  const voteCount = idea.votes.length;
  const votePercent = totalMembers > 0 ? (voteCount / totalMembers) * 100 : 0;

  return (
    <div
      data-testid={`idea-card-${idea.id}`}
      className="flex flex-col rounded-xl overflow-hidden"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      {/* Header */}
      <div className="p-3" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {idea.title}
            </p>
            <p
              className="mt-0.5 flex items-center gap-1 truncate text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <MapPin size={10} />
              {idea.location}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {idea.cost_tier && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
              >
                <DollarSign size={9} />
                {idea.cost_tier}
              </span>
            )}
            {canEdit && (
              <button
                data-testid={`remove-idea-${idea.id}`}
                onClick={() =>
                  removeIdea.mutate({ tripId, ideaId: idea.id })
                }
                className="flex h-5 w-5 items-center justify-center rounded-full opacity-50 transition-opacity hover:opacity-100"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        {idea.description && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            {idea.description}
          </p>
        )}

        {idea.golf_courses && idea.golf_courses.length > 0 && (
          <div>
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Courses
            </p>
            <div className="flex flex-col gap-0.5">
              {idea.golf_courses.map((c, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  <Flag
                    size={10}
                    style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
                  />
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {idea.activities && idea.activities.length > 0 && (
          <div>
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Activities
            </p>
            <div className="flex flex-wrap gap-1">
              {idea.activities.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
                  style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text-dim)" }}
                >
                  <Zap size={8} />
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {idea.pros && idea.pros.length > 0 && (
          <div>
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Pros
            </p>
            <ul className="space-y-0.5">
              {idea.pros.map((p, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1 text-xs"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  <Star
                    size={9}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "var(--color-bt-accent)" }}
                  />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {idea.cons && idea.cons.length > 0 && (
          <div>
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-danger)" }}
            >
              Cons
            </p>
            <ul className="space-y-0.5">
              {idea.cons.map((c, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1 text-xs"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X
                    size={9}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "var(--color-bt-danger)" }}
                  />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {idea.accommodation && (
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            🏨 {idea.accommodation}
          </p>
        )}

        {/* Comments */}
        <div
          className="rounded-lg p-3"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <CommentsSection tripId={tripId} ideaId={idea.id} />
        </div>
      </div>

      {/* Footer */}
      <div className="p-3" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
        {/* Vote progress bar */}
        <div className="mb-2">
          <div
            className="mb-1 flex justify-between text-[10px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <span>
              {voteCount} vote{voteCount !== 1 ? "s" : ""}
            </span>
            <span>{Math.round(votePercent)}%</span>
          </div>
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--color-bt-border)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${votePercent}%`, background: "var(--color-bt-accent)" }}
            />
          </div>
        </div>

        {/* Vote toggle */}
        <button
          data-testid={`vote-idea-${idea.id}`}
          disabled={vote.isPending}
          onClick={() => vote.mutate({ tripId, ideaId: idea.id })}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all disabled:opacity-40"
          style={{
            background: isVoted ? "var(--color-bt-tag-bg)" : "var(--color-bt-base)",
            border: `1px solid ${isVoted ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
            color: isVoted ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          }}
        >
          <ThumbsUp size={12} />
          {isVoted ? "Voted" : "Vote"}
        </button>

        {/* Lock destination (Owner only) */}
        {isOwner && (
          <button
            data-testid={`lock-idea-${idea.id}`}
            onClick={() => onLock(idea)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-all hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-accent)", color: "var(--color-bt-accent)" }}
          >
            <Lock size={12} />
            Lock as Destination
          </button>
        )}
      </div>
    </div>
  );
}

// ── AddIdeaModal ──────────────────────────────────────────────────────────

function AddIdeaModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const createIdea = trpc.ideas.create.useMutation({
    async onMutate(vars) {
      await utils.ideas.list.cancel({ tripId });
      const prev = utils.ideas.list.getData({ tripId });
      utils.ideas.list.setData({ tripId }, [
        ...(prev ?? []),
        {
          id: vars.id,
          trip_id: tripId,
          title: vars.title,
          location: vars.location,
          description: vars.description ?? null,
          golf_courses: vars.golfCourses ?? null,
          activities: vars.activities ?? null,
          cost_tier: vars.costTier ?? null,
          pros: vars.pros ?? null,
          cons: vars.cons ?? null,
          accommodation: vars.accommodation ?? null,
          notes: vars.notes ?? null,
          image_url: vars.imageUrl ?? null,
          votes: [],
        },
      ]);
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.ideas.list.setData({ tripId }, context.prev);
    },
    onSuccess() {
      onClose();
    },
    onSettled() {
      utils.ideas.list.invalidate({ tripId });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="mb-4 text-base font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Add Destination Idea
        </p>
        <form
          data-testid="add-idea-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const t = (fd.get("title") as string).trim();
            const l = (fd.get("location") as string).trim();
            if (!t || !l) return;
            createIdea.mutate({
              tripId,
              id: crypto.randomUUID(),
              title: t,
              location: l,
            });
          }}
        >
          <div className="space-y-3">
            <input
              name="title"
              required
              placeholder="Destination name"
              autoFocus
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <input
              name="location"
              required
              placeholder="Location (e.g. Bandon, OR)"
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border py-2.5 text-sm"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createIdea.isPending}
                className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {createIdea.isPending ? "Adding…" : "Add Idea"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── LockConfirmModal ──────────────────────────────────────────────────────

function LockConfirmModal({
  tripId,
  idea,
  onClose,
}: {
  tripId: string;
  idea: Idea;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const lockDest = trpc.trips.lockDestination.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      if (prev) {
        utils.trips.getById.setData({ tripId }, { ...prev, locked_destination_title: vars.title, locked_destination_location: vars.location });
      }
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.trips.getById.setData({ tripId }, context.prev);
    },
    onSuccess() {
      router.push(`/trips/${tripId}`);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="mb-2 text-base font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Lock Destination?
        </p>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          This will set{" "}
          <strong style={{ color: "var(--color-bt-text)" }}>{idea.title}</strong> as the
          final destination. This can be unlocked later from the More tab.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            data-testid="confirm-lock-dest-btn"
            disabled={lockDest.isPending}
            onClick={() =>
              lockDest.mutate({
                tripId,
                title: idea.title,
                location: idea.location,
              })
            }
            className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {lockDest.isPending ? "Locking…" : "Lock It"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── IdeaComparisonPage ────────────────────────────────────────────────────

export default function IdeaComparisonPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const currentUser = useCurrentUser();
  const { isOwner, canEdit } = useTripRole(tripId);

  const [showAddModal, setShowAddModal] = useState(false);
  const [lockIdea, setLockIdea] = useState<Idea | null>(null);

  const { data: ideas = [], isLoading } = trpc.ideas.list.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: trip } = trpc.trips.getById.useQuery({ tripId });

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--color-bt-base)" }}
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const ideasTyped = ideas as Idea[];

  const addIdeaButton = canEdit ? (
    <button
      data-testid="add-idea-btn"
      onClick={() => setShowAddModal(true)}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{ color: "var(--color-bt-accent)" }}
      aria-label="Add idea"
    >
      <Plus size={18} />
    </button>
  ) : undefined;

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav />
      <TripBreadcrumb
        tripId={tripId}
        tripTitle={trip?.title ?? "Trip"}
        pageName="Compare Destinations"
        rightSlot={addIdeaButton}
      />

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="p-4">
        {ideasTyped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MapPin size={36} className="mb-4" style={{ color: "var(--color-bt-border)" }} />
            <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              No destination ideas yet
            </p>
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {canEdit
                ? "Tap + to add the first destination idea"
                : "Waiting for a planner to add ideas."}
            </p>
          </div>
        ) : (
          /* Vertical stacked expanded cards */
          <div className="flex flex-col gap-4">
            {ideasTyped.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                tripId={tripId}
                isVoted={
                  !!currentUser?.id &&
                  idea.votes.some((v) => v.user_id === currentUser.id)
                }
                canEdit={canEdit}
                isOwner={isOwner}
                totalMembers={members.length}
                onLock={setLockIdea}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddIdeaModal
          tripId={tripId}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {lockIdea && (
        <LockConfirmModal
          tripId={tripId}
          idea={lockIdea}
          onClose={() => setLockIdea(null)}
        />
      )}
    </div>
  );
}
