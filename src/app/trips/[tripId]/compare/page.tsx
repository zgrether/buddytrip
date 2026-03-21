"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { TopNav } from "@/components/TopNav";
import { TripBreadcrumb } from "@/components/TripBreadcrumb";
import {
  ThumbsUp,
  Lock,
  MapPin,
  Star,
  Flag,
  Zap,
  X,
  DollarSign,
  MessageSquare,
  Sparkles,
  Loader2,
  Trash2,
  Check,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ideaGradient } from "@/lib/ideaGradient";
import { CatalogBrowser } from "./CatalogBrowser";
import type { CatalogIdea } from "@/app/trips/[tripId]/tabs/types";

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
  // null = not manually toggled; derive from data. true/false = user override.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();

  const { data: comments = [] } = trpc.ideaComments.list.useQuery({ tripId, ideaId });
  const addComment = trpc.ideaComments.create.useMutation({
    onSuccess() {
      setText("");
      utils.ideaComments.list.invalidate({ tripId, ideaId });
    },
  });

  // Auto-expand when comments exist unless the user has manually toggled
  const open = manualOpen !== null ? manualOpen : comments.length > 0;

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " · " +
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const visibleComments = showAll ? comments : comments.slice(0, 3);

  return (
    <div>
      {/* Toggle */}
      <button
        onClick={() => setManualOpen(!open)}
        className="flex items-center gap-1.5 text-sm"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <MessageSquare size={14} />
        {comments.length} comment{comments.length !== 1 ? "s" : ""}
        <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Comment list — first 3 auto-expanded */}
          {visibleComments.map((c) => {
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

          {comments.length > 3 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Show {comments.length - 3} more comment{comments.length - 3 !== 1 ? "s" : ""}
            </button>
          )}

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

// ── IdeaCard ─────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  tripId,
  canEdit,
  isOwner,
  isLocked,
  isLeading,
  index = 0,
  onLock,
  onDelete,
}: {
  idea: Idea;
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  isLocked?: boolean;
  isLeading?: boolean;
  index?: number;
  onLock: (idea: Idea) => void;
  onDelete: (idea: Idea) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const utils = trpc.useUtils();
  const [editingField, setEditingField] = useState<"title" | "location" | "description" | "pros" | "cons" | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const updateIdea = trpc.ideas.update.useMutation({
    onSuccess() {
      utils.ideas.list.invalidate({ tripId });
      setEditingField(null);
    },
  });

  const unlockDest = trpc.trips.unlockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const startEdit = (field: typeof editingField, value: string) => {
    setEditingField(field);
    setEditDraft(value);
  };

  const saveEdit = () => {
    if (!editingField) return;
    const trimmed = editDraft.trim();
    if ((editingField === "title" || editingField === "location") && !trimmed) return;
    if (editingField === "pros" || editingField === "cons") {
      const items = trimmed ? trimmed.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      updateIdea.mutate({ tripId, ideaId: idea.id, [editingField]: items });
    } else {
      updateIdea.mutate({ tripId, ideaId: idea.id, [editingField]: trimmed });
    }
  };

  const cancelEdit = () => setEditingField(null);

  const inlineEditControls = (
    <div className="mt-1.5 flex gap-2">
      <button
        onClick={saveEdit}
        disabled={updateIdea.isPending}
        className="rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
        style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
      >
        {updateIdea.isPending ? "Saving…" : "Save"}
      </button>
      <button
        onClick={cancelEdit}
        className="rounded-md px-2.5 py-1 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Cancel
      </button>
    </div>
  );

  return (
    <div
      data-testid={`idea-card-${idea.id}`}
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--color-bt-card)",
        border: `1px solid ${isLeading ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
        boxShadow: isLeading ? "0 0 0 1px var(--color-bt-accent)" : undefined,
      }}
    >
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div
        className="relative min-h-[160px]"
        style={{
          background: ideaGradient(index, isDark),
        }}
      >
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
        {isLeading && !isLocked && (
          <div className="absolute left-3 top-3">
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Leading
            </span>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-4">
          {(() => {
            // Theme-aware text colors for gradient hero
            const titleColor = isDark ? "#ffffff" : "rgba(0,0,0,0.85)";
            const subColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";
            const dimColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)";
            const inputBg = isDark ? "bg-black/30" : "bg-white/50";
            const inputText = isDark ? "text-white placeholder:text-white/40" : "text-black placeholder:text-black/40";
            const cancelColor = isDark ? "text-white/70" : "text-black/50";

            return (
              <>
                {editingField === "title" ? (
                  <div>
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                      className={`w-full rounded-lg ${inputBg} px-2 py-1 text-2xl font-bold ${inputText} outline-none focus:ring-1 focus:ring-current/40`}
                    />
                    <div className="mt-1.5 flex gap-2">
                      <button onClick={saveEdit} disabled={updateIdea.isPending} className="rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}>
                        {updateIdea.isPending ? "Saving…" : "Save"}
                      </button>
                      <button onClick={cancelEdit} className={`rounded-md px-2.5 py-1 text-xs ${cancelColor}`}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p
                    className={`text-2xl font-bold${canEdit ? " cursor-pointer hover:opacity-80" : ""}`}
                    style={{ color: titleColor }}
                    onClick={canEdit ? () => startEdit("title", idea.title) : undefined}
                  >
                    {idea.title}
                  </p>
                )}

                {editingField === "location" ? (
                  <div className="mt-1">
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                      placeholder="City, State"
                      className={`w-full rounded-lg ${inputBg} px-2 py-1 text-sm ${inputText} outline-none focus:ring-1 focus:ring-current/40`}
                    />
                    <div className="mt-1.5 flex gap-2">
                      <button onClick={saveEdit} disabled={updateIdea.isPending} className="rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}>
                        {updateIdea.isPending ? "Saving…" : "Save"}
                      </button>
                      <button onClick={cancelEdit} className={`rounded-md px-2.5 py-1 text-xs ${cancelColor}`}>Cancel</button>
                    </div>
                  </div>
                ) : editingField !== "title" && (
                  <p
                    className={`mt-1 flex items-center gap-1 text-sm${canEdit ? " cursor-pointer hover:opacity-80" : ""}`}
                    style={{ color: idea.location && idea.location !== idea.title ? subColor : dimColor }}
                    onClick={canEdit ? () => startEdit("location", idea.location ?? "") : undefined}
                  >
                    <MapPin size={12} />
                    {idea.location && idea.location !== idea.title
                      ? idea.location
                      : <span className="italic">{canEdit ? "Add location…" : ""}</span>}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="space-y-4 p-4">
        {/* Description */}
        {editingField === "description" ? (
          <div>
            <textarea
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
              rows={3}
              placeholder="What's the pitch for this destination?"
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-accent)", color: "var(--color-bt-text)" }}
            />
            {inlineEditControls}
          </div>
        ) : (
          <div
            onClick={canEdit ? () => startEdit("description", idea.description ?? "") : undefined}
            className={canEdit ? "cursor-pointer" : ""}
          >
            {idea.description ? (
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
                {idea.description}
              </p>
            ) : canEdit ? (
              <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                + Add a description — what&apos;s the pitch?
              </p>
            ) : null}
          </div>
        )}

        {/* Pros */}
        {((idea.pros && idea.pros.length > 0) || canEdit) && (
          <div>
            <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--color-bt-accent)" }}>+ PROS</p>
            {editingField === "pros" ? (
              <div>
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                  rows={3}
                  placeholder="One pro per line"
                  className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-accent)", color: "var(--color-bt-text)" }}
                />
                {inlineEditControls}
              </div>
            ) : (
              <div
                onClick={canEdit ? () => startEdit("pros", (idea.pros ?? []).join("\n")) : undefined}
                className={canEdit ? "cursor-pointer" : ""}
              >
                {idea.pros && idea.pros.length > 0 ? (
                  <ul className="space-y-1">
                    {idea.pros.map((p, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                        <Star size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                        {p}
                      </li>
                    ))}
                  </ul>
                ) : canEdit ? (
                  <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>+ Add pros</p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Cons */}
        {((idea.cons && idea.cons.length > 0) || canEdit) && (
          <div>
            <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--color-bt-danger)" }}>× CONS</p>
            {editingField === "cons" ? (
              <div>
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                  rows={3}
                  placeholder="One con per line"
                  className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-danger)", color: "var(--color-bt-text)" }}
                />
                {inlineEditControls}
              </div>
            ) : (
              <div
                onClick={canEdit ? () => startEdit("cons", (idea.cons ?? []).join("\n")) : undefined}
                className={canEdit ? "cursor-pointer" : ""}
              >
                {idea.cons && idea.cons.length > 0 ? (
                  <ul className="space-y-1">
                    {idea.cons.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                        <X size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-danger)" }} />
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : canEdit ? (
                  <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>+ Add cons</p>
                ) : null}
              </div>
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
      {(isOwner || canEdit) && (
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          {isOwner && (
            isLocked ? (
              <button
                onClick={() => unlockDest.mutate({ tripId })}
                disabled={unlockDest.isPending}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold transition-all hover:bg-[var(--color-bt-hover)] disabled:opacity-50"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                Return to discussion
              </button>
            ) : (
              <button
                data-testid={`lock-idea-${idea.id}`}
                onClick={() => onLock(idea)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold transition-all hover:bg-[var(--color-bt-hover)]"
                style={{ borderColor: "var(--color-bt-accent)", color: "var(--color-bt-accent)" }}
              >
                <Lock size={13} />
                Set as destination
              </button>
            )
          )}
          {canEdit && (
            <button
              data-testid={`remove-idea-${idea.id}`}
              onClick={() => onDelete(idea)}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── DeleteConfirmModal ────────────────────────────────────────────────────

function DeleteConfirmModal({
  tripId,
  idea,
  onClose,
}: {
  tripId: string;
  idea: Idea;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();
  const removeIdea = trpc.ideas.remove.useMutation({
    onSuccess() {
      utils.ideas.list.invalidate({ tripId });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-2 text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Remove {idea.title}?
        </p>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          This will permanently delete this idea along with all its votes and comments. You can&apos;t recover any of that.
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
            data-testid="confirm-remove-idea-btn"
            disabled={removeIdea.isPending}
            onClick={() => removeIdea.mutate({ tripId, ideaId: idea.id })}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--color-bt-danger)", color: "#fff" }}
          >
            {removeIdea.isPending ? "Removing…" : "Yes, remove it"}
          </button>
        </div>
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
  useModalBackButton(onClose);
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
          Set as destination?
        </p>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          This will set{" "}
          <strong style={{ color: "var(--color-bt-text)" }}>{idea.title}</strong> as the
          final destination. This can be changed later from the More tab.
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
            {lockDest.isPending ? "Setting…" : "Set destination"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── VotingPanel ───────────────────────────────────────────────────────────

function VotingPanel({ tripId, ideas, currentUserId }: { tripId: string; ideas: Idea[]; currentUserId: string | undefined }) {
  const utils = trpc.useUtils();

  const vote = trpc.ideas.vote.useMutation({
    async onMutate({ ideaId }) {
      await utils.ideas.list.cancel({ tripId });
      const prev = utils.ideas.list.getData({ tripId });
      utils.ideas.list.setData({ tripId }, (prev ?? []).map((i) => {
        const clickingCurrentPick = i.id === ideaId && i.votes.some((v: { user_id: string }) => v.user_id === currentUserId);
        if (clickingCurrentPick) {
          // Unvote
          return { ...i, votes: i.votes.filter((v: { user_id: string }) => v.user_id !== currentUserId) };
        }
        // Remove my vote from every idea (single-pick), then add to target
        const withoutMe = i.votes.filter((v: { user_id: string }) => v.user_id !== currentUserId);
        if (i.id !== ideaId) return { ...i, votes: withoutMe };
        return { ...i, votes: [...withoutMe, { idea_id: ideaId, user_id: currentUserId ?? "", created_at: new Date().toISOString() }] };
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

  return (
    <div
      className="mb-6 rounded-2xl border p-4"
      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Crew votes
      </p>
      <div className="space-y-2">
        {(() => {
          const globalMax = Math.max(...ideas.map((i) => i.votes.length), 1);
          return ideas.map((idea) => {
          const isVoted = idea.votes.some((v) => v.user_id === currentUserId);
          const barWidth = `${Math.round((idea.votes.length / globalMax) * 100)}%`;
          return (
            <div key={idea.id}>
              <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  {idea.title}
                </p>
                <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  {idea.votes.length} vote{idea.votes.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                data-testid={`vote-idea-${idea.id}`}
                disabled={vote.isPending}
                onClick={() => vote.mutate({ tripId, ideaId: idea.id })}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40"
                style={{
                  background: isVoted ? "var(--color-bt-accent)" : "var(--color-bt-base)",
                  border: `1px solid ${isVoted ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                  color: isVoted ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                }}
              >
                <ThumbsUp size={12} />
                {isVoted ? "My pick" : "Pick"}
              </button>
              </div>
              <div
                className="mt-1 h-1 overflow-hidden rounded-full"
                style={{ background: "var(--color-bt-base)", width: "100%" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: barWidth,
                    background: isVoted ? "var(--color-bt-accent)" : "var(--color-bt-border)",
                  }}
                />
              </div>
            </div>
          );
        });
        })()}
      </div>
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
  source: "manual" | "ai" | "catalog";
}

// ── EmptyStateOnboarding ─────────────────────────────────────────────────

function EmptyStateOnboarding({ tripId, onClose }: { tripId: string; onClose?: () => void }) {
  const utils = trpc.useUtils();

  const [localIdeas, setLocalIdeas] = useState<LocalIdea[]>([]);
  const [destInput, setDestInput] = useState("");
  const [showAiPrompt, setShowAiPrompt] = useState(true);
  const [crewDescription, setCrewDescription] = useState("");
  const [isFetchingAi, setIsFetchingAi] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCatalog, setShowCatalog] = useState(true);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());

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

  const handleCatalogSelect = (catalogIdea: CatalogIdea) => {
    const stagedId = `cat-${catalogIdea.id}`;
    const alreadyStaged = localIdeas.some((i) => i.id === stagedId);
    if (alreadyStaged) {
      setLocalIdeas((prev) => prev.filter((i) => i.id !== stagedId));
      setSelectedCatalogIds((prev) => {
        const s = new Set(prev);
        s.delete(catalogIdea.id);
        return s;
      });
    } else {
      setLocalIdeas((prev) => [
        ...prev,
        {
          id: stagedId,
          title: catalogIdea.title,
          location: catalogIdea.location,
          description: catalogIdea.description,
          costTier: catalogIdea.cost_tier ?? undefined,
          source: "catalog" as const,
        },
      ]);
      setSelectedCatalogIds((prev) => new Set([...prev, catalogIdea.id]));
    }
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
            source: idea.source,
          })
        )
      );
      utils.ideas.list.invalidate({ tripId });
      setLocalIdeas([]);
      onClose?.();
    } catch {
      // keep local ideas so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[896px] px-4 py-8">
      {!onClose && (
        <>
          <h2 className="mb-1 text-xl font-bold" style={{ color: "var(--color-bt-text)" }}>
            Idea zone
          </h2>
          <p className="mb-6 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Build a list of options, then the crew can discuss and vote.
          </p>
        </>
      )}

      {/* ── 1. Catalog browser — hero, shown by default ── */}
      {showCatalog ? (
        <div className="mb-4">
          <CatalogBrowser
            onSelect={handleCatalogSelect}
            selectedIds={selectedCatalogIds}
          />
          <button
            onClick={() => setShowCatalog(false)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Hide catalog
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCatalog(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors"
          style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
        >
          Browse destination ideas
        </button>
      )}

      {/* ── 2. Staged ideas list ── */}
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
                onClick={() => {
                  // Also remove from selectedCatalogIds if it was a catalog idea
                  if (idea.source === "catalog") {
                    const catId = idea.id.replace("cat-", "");
                    setSelectedCatalogIds((prev) => {
                      const s = new Set(prev);
                      s.delete(catId);
                      return s;
                    });
                  }
                  setLocalIdeas((prev) => prev.filter((i) => i.id !== idea.id));
                }}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
                aria-label={`Remove ${idea.title}`}
              >
                <X size={13} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── 3. Compare CTA ── */}
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

      {/* ── 4. Divider ── */}
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
        <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>or</span>
        <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
      </div>

      {/* ── 5. Ask Buddy panel ── */}
      {showAiPrompt ? (
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles size={14} style={{ color: "var(--color-bt-accent)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Ask Buddy
            </p>
          </div>
          <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Tell us about your crew and we&apos;ll suggest some ideas to kick things off.
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
          <button
            onClick={handleFetchAi}
            disabled={!crewDescription.trim() || isFetchingAi}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {isFetchingAi ? (
              <><Loader2 size={15} className="animate-spin" /> Thinking…</>
            ) : (
              <><Sparkles size={15} /> Ask Buddy</>
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
          Ask Buddy for more
        </button>
      )}

      {/* ── 6. Manual add ── */}
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
    </div>
  );
}

// ── IdeaComparisonPage ────────────────────────────────────────────────────

export default function IdeaComparisonPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const currentUser = useCurrentUser();
  const { isOwner, canEdit } = useTripRole(tripId);

  const [showAddModal, setShowAddModal] = useState(false);
  const [lockIdea, setLockIdea] = useState<Idea | null>(null);
  const [deleteIdea, setDeleteIdea] = useState<Idea | null>(null);

  useEffect(() => {
    if (showAddModal) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [showAddModal]);

  const { data: ideas = [], isLoading } = trpc.ideas.list.useQuery({ tripId });
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

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav />
      <TripBreadcrumb
        tripId={tripId}
        tripTitle={trip?.title ?? "Trip"}
        pageName="Idea Zone"
      />

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[896px] p-4">
        {ideasTyped.length === 0 ? (
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
          /* Unified layout — locked idea pinned at top when destination is set */
          (() => {
            const lockedTitle = (trip?.locked_destination_title ?? "").toLowerCase();
            const lockedIdea = lockedTitle
              ? ideasTyped.find((i) => i.title.toLowerCase() === lockedTitle)
              : undefined;
            const otherIdeas = (lockedIdea
              ? ideasTyped.filter((i) => i.id !== lockedIdea.id)
              : ideasTyped
            ).sort((a, b) => b.votes.length - a.votes.length);
            const maxVotes = Math.max(...otherIdeas.map((i) => i.votes.length), 0);
            const isLeading = (idea: Idea) =>
              !lockedIdea && maxVotes > 0 && idea.votes.length === maxVotes;

            return (
              <div className="flex flex-col gap-4">
                <VotingPanel tripId={tripId} ideas={ideasTyped} currentUserId={currentUser?.id} />
                {canEdit && (
                  <div className="flex justify-end">
                    <button
                      data-testid="add-idea-btn"
                      onClick={() => setShowAddModal(true)}
                      className="text-sm font-medium transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-bt-accent)" }}
                    >
                      + Add idea
                    </button>
                  </div>
                )}

                {/* Current destination pinned at top */}
                {lockedIdea && (
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
                    <IdeaCard
                      idea={lockedIdea}
                      tripId={tripId}
                      canEdit={canEdit}
                      isOwner={isOwner}
                      isLocked={true}
                      index={0}
                      onLock={setLockIdea}
                      onDelete={setDeleteIdea}
                    />
                  </div>
                )}

                {/* Other ideas */}
                {otherIdeas.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {lockedIdea && (
                      <p
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        Other Ideas
                      </p>
                    )}
                    {otherIdeas.map((idea, i) => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        tripId={tripId}
                        canEdit={canEdit}
                        isOwner={isOwner}
                        isLeading={isLeading(idea)}
                        index={(lockedIdea ? 1 : 0) + i}
                        onLock={setLockIdea}
                        onDelete={setDeleteIdea}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </main>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "var(--color-bt-overlay)" }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl"
            style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-0">
              <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Add ideas
              </p>
              <button
                onClick={() => setShowAddModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={16} />
              </button>
            </div>
            <EmptyStateOnboarding tripId={tripId} onClose={() => setShowAddModal(false)} />
          </div>
        </div>
      )}
      {lockIdea && (
        <LockConfirmModal
          tripId={tripId}
          idea={lockIdea}
          onClose={() => setLockIdea(null)}
        />
      )}
      {deleteIdea && (
        <DeleteConfirmModal
          tripId={tripId}
          idea={deleteIdea}
          onClose={() => setDeleteIdea(null)}
        />
      )}
    </div>
  );
}
