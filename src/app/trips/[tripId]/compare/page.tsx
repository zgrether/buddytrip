"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ThumbsUp,
  Lock,
  MapPin,
  Star,
  Flag,
  Zap,
  Plus,
  X,
  DollarSign,
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

  const vote = trpc.ideas.vote.useMutation({
    onSuccess: () => utils.ideas.list.invalidate({ tripId }),
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
      style={{ background: "#161b22", border: "1px solid #30363d" }}
    >
      {/* Header */}
      <div className="p-3" style={{ borderBottom: "1px solid #30363d" }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-semibold"
              style={{ color: "#e6edf3" }}
            >
              {idea.title}
            </p>
            <p
              className="mt-0.5 flex items-center gap-1 truncate text-xs"
              style={{ color: "#8b949e" }}
            >
              <MapPin size={10} />
              {idea.location}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {idea.cost_tier && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: "#0d2a22", color: "#00d4aa" }}
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
                style={{ color: "#8b949e" }}
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
          <p className="text-xs leading-relaxed" style={{ color: "#8b949e" }}>
            {idea.description}
          </p>
        )}

        {idea.golf_courses && idea.golf_courses.length > 0 && (
          <div>
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "#8b949e" }}
            >
              Courses
            </p>
            <div className="flex flex-col gap-0.5">
              {idea.golf_courses.map((c, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "#e6edf3" }}
                >
                  <Flag
                    size={10}
                    style={{ color: "#00d4aa", flexShrink: 0 }}
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
              style={{ color: "#8b949e" }}
            >
              Activities
            </p>
            <div className="flex flex-wrap gap-1">
              {idea.activities.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
                  style={{ background: "#0d1117", color: "#8b949e" }}
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
              style={{ color: "#00d4aa" }}
            >
              Pros
            </p>
            <ul className="space-y-0.5">
              {idea.pros.map((p, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1 text-xs"
                  style={{ color: "#e6edf3" }}
                >
                  <Star
                    size={9}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "#00d4aa" }}
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
              style={{ color: "#ef4444" }}
            >
              Cons
            </p>
            <ul className="space-y-0.5">
              {idea.cons.map((c, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1 text-xs"
                  style={{ color: "#8b949e" }}
                >
                  <X
                    size={9}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "#ef4444" }}
                  />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {idea.accommodation && (
          <p className="text-xs" style={{ color: "#8b949e" }}>
            🏨 {idea.accommodation}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="p-3" style={{ borderTop: "1px solid #30363d" }}>
        {/* Vote progress bar */}
        <div className="mb-2">
          <div
            className="mb-1 flex justify-between text-[10px]"
            style={{ color: "#8b949e" }}
          >
            <span>
              {voteCount} vote{voteCount !== 1 ? "s" : ""}
            </span>
            <span>{Math.round(votePercent)}%</span>
          </div>
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "#30363d" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${votePercent}%`, background: "#00d4aa" }}
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
            background: isVoted ? "#0d2a22" : "#0d1117",
            border: `1px solid ${isVoted ? "#00d4aa" : "#30363d"}`,
            color: isVoted ? "#00d4aa" : "#8b949e",
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
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-all hover:bg-white/5"
            style={{ borderColor: "#00d4aa", color: "#00d4aa" }}
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
    onSuccess: () => {
      utils.ideas.list.invalidate({ tripId });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "#161b22", border: "1px solid #30363d" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="mb-4 text-base font-semibold"
          style={{ color: "#e6edf3" }}
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
                background: "#0d1117",
                borderColor: "#30363d",
                color: "#e6edf3",
              }}
            />
            <input
              name="location"
              required
              placeholder="Location (e.g. Bandon, OR)"
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{
                background: "#0d1117",
                borderColor: "#30363d",
                color: "#e6edf3",
              }}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border py-2.5 text-sm"
                style={{ borderColor: "#30363d", color: "#8b949e" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createIdea.isPending}
                className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                style={{ background: "#00d4aa", color: "#0d1117" }}
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
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      router.push(`/trips/${tripId}`);
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5"
        style={{ background: "#161b22", border: "1px solid #30363d" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="mb-2 text-base font-semibold"
          style={{ color: "#e6edf3" }}
        >
          Lock Destination?
        </p>
        <p className="mb-4 text-sm" style={{ color: "#8b949e" }}>
          This will set{" "}
          <strong style={{ color: "#e6edf3" }}>{idea.title}</strong> as the
          final destination. This can be unlocked later from the More tab.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm"
            style={{ borderColor: "#30363d", color: "#8b949e" }}
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
            style={{ background: "#00d4aa", color: "#0d1117" }}
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

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "#0d1117" }}
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "#00d4aa", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const ideasTyped = ideas as Idea[];

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "#0d1117", color: "#e6edf3" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4"
        style={{ background: "#161b22", borderBottom: "1px solid #30363d" }}
      >
        <button
          onClick={() => router.push(`/trips/${tripId}`)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          style={{ color: "#e6edf3" }}
          aria-label="Back to trip"
        >
          <ArrowLeft size={20} />
        </button>

        <h1
          data-testid="compare-heading"
          className="flex-1 text-base font-semibold"
          style={{ color: "#e6edf3" }}
        >
          Compare Destinations
          {ideasTyped.length > 0 && (
            <span
              className="ml-2 text-sm font-normal"
              style={{ color: "#8b949e" }}
            >
              ({ideasTyped.length})
            </span>
          )}
        </h1>

        {canEdit && (
          <button
            data-testid="add-idea-btn"
            onClick={() => setShowAddModal(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: "#00d4aa" }}
            aria-label="Add idea"
          >
            <Plus size={20} />
          </button>
        )}
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex-1 p-4">
        {ideasTyped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MapPin size={36} className="mb-4" style={{ color: "#30363d" }} />
            <p className="mb-1 text-sm font-medium" style={{ color: "#e6edf3" }}>
              No destination ideas yet
            </p>
            <p className="text-xs" style={{ color: "#8b949e" }}>
              {canEdit
                ? "Tap + to add the first destination idea"
                : "Waiting for a planner to add ideas."}
            </p>
          </div>
        ) : (
          /* Horizontal scroll for side-by-side comparison */
          <div className="flex gap-3 overflow-x-auto pb-4">
            {ideasTyped.map((idea) => (
              <div key={idea.id} className="w-56 flex-shrink-0">
                <IdeaCard
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
              </div>
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
