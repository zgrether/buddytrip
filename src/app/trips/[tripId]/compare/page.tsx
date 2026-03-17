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
  Sparkles,
  Loader2,
  Trash2,
  Check,
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
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  const { data: comments = [] } = trpc.ideaComments.list.useQuery({ tripId, ideaId });
  const addComment = trpc.ideaComments.create.useMutation({
    onSuccess() {
      setText("");
      utils.ideaComments.list.invalidate({ tripId, ideaId });
    },
  });

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " · " +
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div>
      {/* Toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <MessageSquare size={14} />
        {comments.length} comment{comments.length !== 1 ? "s" : ""}
        <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Comment list */}
          {comments.map((c) => {
            const isMe = c.user_id === currentUser?.id;
            const initials = isMe
              ? (currentUser?.email ?? "?").charAt(0).toUpperCase()
              : "?";
            const label = isMe
              ? (currentUser?.email ?? "You")
              : c.user_id.slice(0, 8);
            return (
              <div key={c.id} className="flex gap-2">
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
                >
                  {initials}
                </div>
                <div
                  className="flex-1 rounded-xl px-3 py-2"
                  style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
                >
                  <p className="mb-1 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                    <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                      {label}
                    </span>
                    {" · "}{fmtDate(c.created_at)}
                  </p>
                  <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>{c.text}</p>
                </div>
              </div>
            );
          })}

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              addComment.mutate({ tripId, ideaId, id: crypto.randomUUID(), text: t });
            }}
            className="flex gap-2"
          >
            <div
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
            >
              {(currentUser?.email ?? "?").charAt(0).toUpperCase()}
            </div>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write a comment..."
              className="min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-sm outline-none"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <button
              type="submit"
              disabled={addComment.isPending || !text.trim()}
              className="rounded-xl px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ── IdeaCard helpers ──────────────────────────────────────────────────────

function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// ── IdeaCard ─────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  tripId,
  isVoted,
  canEdit,
  isOwner,
  totalMembers,
  isLocked,
  onLock,
}: {
  idea: Idea;
  tripId: string;
  isVoted: boolean;
  canEdit: boolean;
  isOwner: boolean;
  totalMembers: number;
  isLocked?: boolean;
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

  const hue = hashToHue((idea.location ?? idea.title).toLowerCase());

  return (
    <div
      data-testid={`idea-card-${idea.id}`}
      className="overflow-hidden rounded-2xl"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div
        className="relative min-h-[160px]"
        style={{
          background: `linear-gradient(160deg, hsl(${hue}, 50%, 18%) 0%, hsl(${(hue + 40) % 360}, 40%, 10%) 100%)`,
        }}
      >
        {/* Picked badge */}
        {isLocked && (
          <div className="absolute right-3 top-3">
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              <Check size={11} />
              Picked
            </span>
          </div>
        )}

        {/* Title block at bottom of hero */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <p className="text-2xl font-bold text-white">{idea.title}</p>
          {idea.location && idea.location !== idea.title && (
            <p className="mt-1 flex items-center gap-1 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
              <MapPin size={12} />
              {idea.location}
            </p>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="space-y-4 p-4">
        {/* Description */}
        {idea.description ? (
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
            {idea.description}
          </p>
        ) : canEdit ? (
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            + Add a description — what&apos;s the pitch?
          </p>
        ) : null}

        {/* Pros */}
        {((idea.pros && idea.pros.length > 0) || canEdit) && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                + PROS
              </p>
            </div>
            {idea.pros && idea.pros.length > 0 ? (
              <ul className="space-y-1">
                {idea.pros.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                    <Star size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>—</p>
            )}
          </div>
        )}

        {/* Cons */}
        {((idea.cons && idea.cons.length > 0) || canEdit) && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold" style={{ color: "var(--color-bt-danger)" }}>
                × CONS
              </p>
            </div>
            {idea.cons && idea.cons.length > 0 ? (
              <ul className="space-y-1">
                {idea.cons.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                    <X size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-danger)" }} />
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>—</p>
            )}
          </div>
        )}

        {/* Golf courses */}
        {idea.golf_courses && idea.golf_courses.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Courses
            </p>
            <div className="space-y-0.5">
              {idea.golf_courses.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                  <Flag size={11} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Activities */}
        {idea.activities && idea.activities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {idea.activities.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
              >
                <Zap size={9} />
                {a}
              </span>
            ))}
          </div>
        )}

        {/* Accommodation */}
        {idea.accommodation && (
          <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            🏨 {idea.accommodation}
          </p>
        )}

        {/* Cost tier */}
        {idea.cost_tier && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
          >
            <DollarSign size={10} />
            {idea.cost_tier}
          </span>
        )}

        {/* Divider before comments */}
        <div style={{ borderTop: "1px solid var(--color-bt-border)" }} />

        {/* Comments */}
        <CommentsSection tripId={tripId} ideaId={idea.id} />
      </div>

      {/* ── Footer actions ────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        {/* Your pick — vote toggle */}
        <button
          data-testid={`vote-idea-${idea.id}`}
          disabled={vote.isPending}
          onClick={() => vote.mutate({ tripId, ideaId: idea.id })}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-40"
          style={{
            background: isVoted ? "var(--color-bt-accent)" : "var(--color-bt-base)",
            border: `1px solid ${isVoted ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
            color: isVoted ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
          }}
        >
          <Check size={14} />
          Your pick
        </button>

        {/* Lock In — owner only */}
        {isOwner && (
          <button
            data-testid={`lock-idea-${idea.id}`}
            onClick={() => onLock(idea)}
            className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-accent)", color: "var(--color-bt-accent)" }}
          >
            <Lock size={13} />
            Lock In
          </button>
        )}

        {/* Delete — canEdit */}
        {canEdit && (
          <button
            data-testid={`remove-idea-${idea.id}`}
            onClick={() => removeIdea.mutate({ tripId, ideaId: idea.id })}
            disabled={removeIdea.isPending}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Trash2 size={15} />
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

// ── CurrentDestinationCard ────────────────────────────────────────────────

function CurrentDestinationCard({ title, location }: { title: string; location?: string | null }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-accent-border)" }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Lock size={13} style={{ color: "var(--color-bt-accent)" }} />
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Current Destination
        </span>
      </div>
      <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
        {title}
      </p>
      {location && location !== title && (
        <p className="mt-0.5 flex items-center gap-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          <MapPin size={12} />
          {location}
        </p>
      )}
    </div>
  );
}

// ── LocalIdea ─────────────────────────────────────────────────────────────

interface LocalIdea {
  id: string;
  title: string;
  location: string;
  description?: string;
  costTier?: string;
  source: "manual" | "ai";
}

// ── ChangeDestinationInput ────────────────────────────────────────────────

function ChangeDestinationInput({ tripId }: { tripId: string }) {
  const utils = trpc.useUtils();

  const [localIdeas, setLocalIdeas] = useState<LocalIdea[]>([]);
  const [destInput, setDestInput] = useState("");
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [crewDescription, setCrewDescription] = useState("");
  const [isFetchingAi, setIsFetchingAi] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createIdea = trpc.ideas.create.useMutation();

  const handleAddManual = () => {
    const t = destInput.trim();
    if (!t) return;
    setLocalIdeas((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: t, location: t, source: "manual" },
    ]);
    setDestInput("");
  };

  const handleFetchAi = async () => {
    setAiError("");
    setIsFetchingAi(true);
    try {
      const res = await fetch("/api/ai/suggest-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewDescription: crewDescription.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const incoming: LocalIdea[] = (data.suggestions ?? []).map(
        (s: { title: string; location: string; description: string; costTier: string }, i: number) => ({
          id: `ai-${Date.now()}-${i}`,
          title: s.title,
          location: s.location,
          description: s.description,
          costTier: s.costTier,
          source: "ai" as const,
        })
      );
      setLocalIdeas((prev) => {
        const existingTitles = new Set(prev.map((x) => x.title.toLowerCase()));
        return [...prev, ...incoming.filter((x) => !existingTitles.has(x.title.toLowerCase()))];
      });
      setShowAiPrompt(false);
      setCrewDescription("");
    } catch {
      setAiError("Failed to get suggestions. Please try again.");
    } finally {
      setIsFetchingAi(false);
    }
  };

  const handleCompare = async () => {
    if (localIdeas.length === 0) return;
    setIsSubmitting(true);
    try {
      await Promise.all(
        localIdeas.map((idea) =>
          createIdea.mutateAsync({
            tripId,
            id: idea.id,
            title: idea.title,
            location: idea.location,
            description: idea.description,
            costTier: idea.costTier,
          })
        )
      );
      utils.ideas.list.invalidate({ tripId });
      setLocalIdeas([]);
    } catch {
      // keep local ideas so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mb-6">
      <h2 className="mb-1 text-xl font-bold" style={{ color: "var(--color-bt-text)" }}>
        Add destinations to compare
      </h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
        Build a list of options, then the crew can vote on their favorite.
      </p>

      {/* Add input */}
      <div className="flex gap-2">
        <input
          value={destInput}
          onChange={(e) => setDestInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleAddManual(); }
          }}
          placeholder="Type a destination and press Add"
          maxLength={500}
          className="flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
          style={{
            background: "var(--color-bt-card)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <button
          onClick={handleAddManual}
          disabled={!destInput.trim()}
          className="rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          Add
        </button>
      </div>

      {/* Local ideas list */}
      {localIdeas.length > 0 ? (
        <div className="mt-4 space-y-2">
          {localIdeas.map((idea) => (
            <div
              key={idea.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
              style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
            >
              {idea.source === "ai" ? (
                <Sparkles size={14} className="flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
              ) : (
                <MapPin size={14} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {idea.title}
                </p>
                {idea.description && (
                  <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    {idea.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => setLocalIdeas((prev) => prev.filter((i) => i.id !== idea.id))}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
                aria-label={`Remove ${idea.title}`}
              >
                <X size={13} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* AI suggestions */}
      <div className="mt-4">
        {!showAiPrompt ? (
          <button
            onClick={() => setShowAiPrompt(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors"
            style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
          >
            <Sparkles size={15} />
            Get AI suggestions
          </button>
        ) : (
          <div
            className="rounded-xl border p-4"
            style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
          >
            <p className="mb-1 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              We&apos;d love to help
            </p>
            <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Give us a quick blurb about your trip and crew and we&apos;ll add some fresh ideas to your list.
            </p>
            <textarea
              value={crewDescription}
              onChange={(e) => setCrewDescription(e.target.value)}
              placeholder="e.g. 6 guys, links lovers, mid-range budget, did Bandon last year…"
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
              style={{
                background: "var(--color-bt-base)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            {aiError && (
              <p className="mt-1 text-xs" style={{ color: "var(--color-bt-danger)" }}>{aiError}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => { setShowAiPrompt(false); setCrewDescription(""); setAiError(""); }}
                className="rounded-lg border px-4 py-2 text-sm"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleFetchAi}
                disabled={!crewDescription.trim() || isFetchingAi}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-opacity disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {isFetchingAi ? (
                  <><Loader2 size={15} className="animate-spin" /> Thinking…</>
                ) : (
                  <><Sparkles size={15} /> Suggest destinations</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Compare CTA — saves staged ideas to DB */}
      {localIdeas.length > 0 && (
        <button
          onClick={handleCompare}
          disabled={isSubmitting}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {isSubmitting ? (
            <><Loader2 size={16} className="animate-spin" /> Saving…</>
          ) : (
            <>Compare {localIdeas.length} idea{localIdeas.length !== 1 ? "s" : ""} →</>
          )}
        </button>
      )}
    </div>
  );
}

// ── EmptyStateOnboarding ─────────────────────────────────────────────────

function EmptyStateOnboarding({ tripId }: { tripId: string }) {
  const utils = trpc.useUtils();

  const [localIdeas, setLocalIdeas] = useState<LocalIdea[]>([]);
  const [destInput, setDestInput] = useState("");
  const [showAiPrompt, setShowAiPrompt] = useState(true);
  const [crewDescription, setCrewDescription] = useState("");
  const [isFetchingAi, setIsFetchingAi] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createIdea = trpc.ideas.create.useMutation();

  const handleAddManual = () => {
    const t = destInput.trim();
    if (!t) return;
    setLocalIdeas((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: t, location: t, source: "manual" },
    ]);
    setDestInput("");
  };

  const handleFetchAi = async () => {
    setAiError("");
    setIsFetchingAi(true);
    try {
      const res = await fetch("/api/ai/suggest-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewDescription: crewDescription.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const incoming: LocalIdea[] = (data.suggestions ?? []).map(
        (s: { title: string; location: string; description: string; costTier: string }, i: number) => ({
          id: `ai-${Date.now()}-${i}`,
          title: s.title,
          location: s.location,
          description: s.description,
          costTier: s.costTier,
          source: "ai" as const,
        })
      );
      setLocalIdeas((prev) => {
        const existingTitles = new Set(prev.map((x) => x.title.toLowerCase()));
        return [...prev, ...incoming.filter((x) => !existingTitles.has(x.title.toLowerCase()))];
      });
      setShowAiPrompt(false);
      setCrewDescription("");
    } catch {
      setAiError("Failed to get suggestions. Please try again.");
    } finally {
      setIsFetchingAi(false);
    }
  };

  const handleCompare = async () => {
    if (localIdeas.length === 0) return;
    setIsSubmitting(true);
    try {
      await Promise.all(
        localIdeas.map((idea) =>
          createIdea.mutateAsync({
            tripId,
            id: idea.id,
            title: idea.title,
            location: idea.location,
            description: idea.description,
            costTier: idea.costTier,
          })
        )
      );
      utils.ideas.list.invalidate({ tripId });
      setLocalIdeas([]);
    } catch {
      // keep local ideas so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h2 className="mb-1 text-xl font-bold" style={{ color: "var(--color-bt-text)" }}>
        Idea zone
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
        Build a list of options, then the crew can vote and discuss.
      </p>

      {/* ── AI suggestions — primary, open by default ── */}
      {showAiPrompt ? (
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles size={14} style={{ color: "var(--color-bt-accent)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Get AI suggestions
            </p>
          </div>
          <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Tell us about your crew and we&apos;ll suggest some ideas to kick things off.
          </p>
          <textarea
            autoFocus
            value={crewDescription}
            onChange={(e) => setCrewDescription(e.target.value)}
            placeholder="e.g. 6 guys, links lovers, mid-range budget, did Bandon last year…"
            rows={3}
            maxLength={2000}
            className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          {aiError && (
            <p className="mt-1 text-xs" style={{ color: "var(--color-bt-danger)" }}>{aiError}</p>
          )}
          <button
            onClick={handleFetchAi}
            disabled={!crewDescription.trim() || isFetchingAi}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {isFetchingAi ? (
              <><Loader2 size={15} className="animate-spin" /> Thinking…</>
            ) : (
              <><Sparkles size={15} /> Suggest destinations</>
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAiPrompt(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors"
          style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
        >
          <Sparkles size={15} />
          Get more AI suggestions
        </button>
      )}

      {/* ── Manual add — secondary ── */}
      <div className="mt-5">
        <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
          or add your own idea
        </p>
        <div className="flex gap-2">
          <input
            value={destInput}
            onChange={(e) => setDestInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAddManual(); }
            }}
            placeholder="Destination name"
            maxLength={500}
            className="flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
            style={{
              background: "var(--color-bt-card)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          <button
            onClick={handleAddManual}
            disabled={!destInput.trim()}
            className="rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Add
          </button>
        </div>
      </div>

      {/* ── Staged ideas list ── */}
      {localIdeas.length > 0 && (
        <div className="mt-4 space-y-2">
          {localIdeas.map((idea) => (
            <div
              key={idea.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
              style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
            >
              {idea.source === "ai" ? (
                <Sparkles size={14} className="flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
              ) : (
                <MapPin size={14} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {idea.title}
                </p>
                {idea.description && (
                  <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    {idea.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => setLocalIdeas((prev) => prev.filter((i) => i.id !== idea.id))}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
                aria-label={`Remove ${idea.title}`}
              >
                <X size={13} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Compare CTA ── */}
      {localIdeas.length > 0 && (
        <button
          onClick={handleCompare}
          disabled={isSubmitting}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {isSubmitting ? (
            <><Loader2 size={16} className="animate-spin" /> Saving…</>
          ) : (
            <>Compare {localIdeas.length} idea{localIdeas.length !== 1 ? "s" : ""} →</>
          )}
        </button>
      )}
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

  // Only show the + button when ideas already exist (empty state has its own add UI)
  const addIdeaButton = canEdit && ideasTyped.length > 0 ? (
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
      <main className="mx-auto max-w-2xl p-4">
        {trip?.locked_destination_title && canEdit ? (
          /* Change-destination mode: explore input above the ideas list */
          <div>
            <ChangeDestinationInput tripId={tripId} />

            {/* Current destination pinned at top, other ideas below */}
            {(() => {
              const lockedTitle = (trip.locked_destination_title ?? "").toLowerCase();
              const lockedIdea = ideasTyped.find(
                (i) => i.title.toLowerCase() === lockedTitle,
              );
              const otherIdeas = ideasTyped.filter((i) => i.id !== lockedIdea?.id);

              return (
                <div className="mt-4 flex flex-col gap-6">
                  {/* ── Current Destination ───────────────────────────────── */}
                  <div>
                    <div className="mb-2 flex items-center gap-1.5">
                      <Lock size={13} style={{ color: "var(--color-bt-accent)" }} />
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--color-bt-accent)" }}
                      >
                        Current Destination
                      </span>
                    </div>
                    {lockedIdea ? (
                      <IdeaCard
                        idea={lockedIdea}
                        tripId={tripId}
                        isVoted={
                          !!currentUser?.id &&
                          lockedIdea.votes.some((v) => v.user_id === currentUser.id)
                        }
                        canEdit={canEdit}
                        isOwner={isOwner}
                        totalMembers={members.length}
                        isLocked={true}
                        onLock={setLockIdea}
                      />
                    ) : (
                      <CurrentDestinationCard
                        title={trip.locked_destination_title}
                        location={trip.locked_destination_location}
                      />
                    )}
                  </div>

                  {/* ── Other Ideas ───────────────────────────────────────── */}
                  {otherIdeas.length > 0 && (
                    <div>
                      <p
                        className="mb-2 text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        Other Ideas
                      </p>
                      <div className="flex flex-col gap-4">
                        {otherIdeas.map((idea) => (
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
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : ideasTyped.length === 0 ? (
          canEdit ? (
            <EmptyStateOnboarding tripId={tripId} />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MapPin size={36} className="mb-4" style={{ color: "var(--color-bt-border)" }} />
              <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                No destination ideas yet
              </p>
              <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Waiting for a planner to add ideas.
              </p>
            </div>
          )
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
