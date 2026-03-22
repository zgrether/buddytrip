"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
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
  MessageSquare,
  Sparkles,
  Loader2,
  Trash2,
  Check,
  CheckCircle2,
  Search,
  Plus,
  Link,
  UserPlus,
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
  created_at: string;
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

function CommentsSection({ tripId, ideaId, variant = "thread" }: { tripId: string; ideaId: string; variant?: "thread" | "chat" }) {
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

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (variant === "chat" && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments.length, variant]);

  if (variant === "chat") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p
          className="mb-2 flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Crew Chat
        </p>

        {/* Scrollable message area */}
        <div className="flex-1 space-y-3 overflow-y-auto min-h-0">
          {comments.length === 0 && (
            <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
              No messages yet — be the first
            </p>
          )}
          {comments.map((c) => {
            const isMe = c.user_id === currentUser?.id;
            const initials = isMe
              ? (currentUser?.email ?? "?").charAt(0).toUpperCase()
              : "?";
            const label = isMe ? (currentUser?.email ?? "You") : c.user_id.slice(0, 8);
            return (
              <div key={c.id} className="flex items-start gap-2">
                <div
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                    <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                      {label}
                    </span>
                    {" · "}{fmtDate(c.created_at)}
                  </p>
                  <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                    {c.text}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Input — pinned to bottom */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            addComment.mutate({ tripId, ideaId, id: crypto.randomUUID(), text: t });
          }}
          className="mt-2 flex flex-shrink-0 gap-2 pt-2"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say something..."
            className="min-w-0 flex-1 rounded-full border px-3 py-1.5 text-sm outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          <button
            type="submit"
            disabled={addComment.isPending || !text.trim()}
            className="rounded-full px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Send
          </button>
        </form>
      </div>
    );
  }

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
  const [editingField, setEditingField] = useState<"title" | "location" | "description" | "pros" | "cons" | "golfCourses" | "activities" | "accommodation" | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const updateIdea = trpc.ideas.update.useMutation({
    onSuccess() {
      utils.ideas.list.invalidate({ tripId });
      setEditingField(null);
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
    } else if (editingField === "golfCourses" || editingField === "activities") {
      const items = trimmed ? trimmed.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      updateIdea.mutate({ tripId, ideaId: idea.id, [editingField]: items });
    } else if (editingField === "accommodation") {
      updateIdea.mutate({ tripId, ideaId: idea.id, accommodation: trimmed || null });
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
        className={`relative overflow-hidden ${isLocked ? "min-h-[220px]" : "min-h-[160px]"}`}
        style={{
          background: idea.image_url ? undefined : ideaGradient(index, isDark),
        }}
      >
        {idea.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={idea.image_url}
            alt={idea.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {idea.image_url && (
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)",
            }}
          />
        )}
        {isLocked && (
          <div className="absolute right-3 top-3 flex items-center gap-2">
            {idea.cost_tier && (
              <span
                className="rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}
              >
                {idea.cost_tier}
              </span>
            )}
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              <Check size={11} />
              Picked
            </span>
          </div>
        )}
        {idea.cost_tier && !isLocked && (
          <div className="absolute right-3 top-3">
            <span
              className="rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}
            >
              {idea.cost_tier}
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

      {/* ── Body — single column mobile, two column desktop ────────── */}
      <div
        className="lg:grid lg:grid-cols-[1fr_280px]"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        {/* Left column — idea details */}
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

          {/* Pros / Cons — two columns on desktop, stacked on mobile */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Pros — left column */}
            <div>
              {((idea.pros && idea.pros.length > 0) || editingField === "pros") ? (
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
                    <ul
                      className="space-y-1"
                      onClick={canEdit ? () => startEdit("pros", idea.pros!.join("\n")) : undefined}
                      style={{ cursor: canEdit ? "pointer" : "default" }}
                    >
                      {(idea.pros ?? []).map((p, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                          <Star size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
                          {p}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : canEdit && editingField !== "cons" ? (
                <button
                  onClick={() => startEdit("pros", "")}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  + Add pros
                </button>
              ) : null}
            </div>

            {/* Cons — right column */}
            <div>
              {((idea.cons && idea.cons.length > 0) || editingField === "cons") ? (
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
                    <ul
                      className="space-y-1"
                      onClick={canEdit ? () => startEdit("cons", idea.cons!.join("\n")) : undefined}
                      style={{ cursor: canEdit ? "pointer" : "default" }}
                    >
                      {(idea.cons ?? []).map((c, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                          <X size={11} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-bt-danger)" }} />
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : canEdit && editingField !== "pros" ? (
                <button
                  onClick={() => startEdit("cons", "")}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  + Add cons
                </button>
              ) : null}
            </div>
          </div>

          {/* Courses / Activities — two columns on desktop, stacked on mobile */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Courses — left column */}
            <div>
              {((idea.golf_courses && idea.golf_courses.length > 0) || editingField === "golfCourses" || canEdit) && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                    Courses
                  </p>
                  {editingField === "golfCourses" ? (
                    <div>
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                        rows={3}
                        placeholder="One course per line"
                        className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                        style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                      />
                      {inlineEditControls}
                    </div>
                  ) : idea.golf_courses && idea.golf_courses.length > 0 ? (
                    <div
                      className="space-y-0.5"
                      onClick={canEdit ? () => startEdit("golfCourses", (idea.golf_courses ?? []).join("\n")) : undefined}
                      style={{ cursor: canEdit ? "pointer" : "default" }}
                    >
                      {idea.golf_courses.map((c, i) => (
                        <span key={i} className="flex items-center gap-1.5 text-sm" style={{ color: "var(--color-bt-text)" }}>
                          <Flag size={11} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
                          {c}
                        </span>
                      ))}
                    </div>
                  ) : canEdit ? (
                    <button
                      onClick={() => startEdit("golfCourses", "")}
                      className="text-sm transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      + Add courses
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            {/* Activities — right column */}
            <div>
              {((idea.activities && idea.activities.length > 0) || editingField === "activities" || canEdit) && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                    Activities
                  </p>
                  {editingField === "activities" ? (
                    <div>
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                        rows={3}
                        placeholder="One activity per line"
                        className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                        style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                      />
                      {inlineEditControls}
                    </div>
                  ) : idea.activities && idea.activities.length > 0 ? (
                    <div
                      className="flex flex-wrap gap-1.5"
                      onClick={canEdit ? () => startEdit("activities", (idea.activities ?? []).join("\n")) : undefined}
                      style={{ cursor: canEdit ? "pointer" : "default" }}
                    >
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
                  ) : canEdit ? (
                    <button
                      onClick={() => startEdit("activities", "")}
                      className="text-sm transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      + Add activities
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* Lodging */}
          {(idea.accommodation || editingField === "accommodation" || canEdit) && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Lodging
              </p>
              {editingField === "accommodation" ? (
                <div>
                  <input
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                    placeholder="e.g. The Lodge at Pebble Beach"
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                  />
                  {inlineEditControls}
                </div>
              ) : idea.accommodation ? (
                <p
                  className="text-sm"
                  onClick={canEdit ? () => startEdit("accommodation", idea.accommodation ?? "") : undefined}
                  style={{ color: "var(--color-bt-text)", cursor: canEdit ? "pointer" : "default" }}
                >
                  {idea.accommodation}
                </p>
              ) : canEdit ? (
                <button
                  onClick={() => startEdit("accommodation", "")}
                  className="text-sm transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  + Add lodging
                </button>
              ) : null}
            </div>
          )}


          {/* Footer actions — inside left column */}
          {(isOwner || canEdit) && !isLocked && (
            <div
              className="flex items-center justify-between pt-3"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              {isOwner && (
                <button
                  data-testid={`lock-idea-${idea.id}`}
                  onClick={() => onLock(idea)}
                  className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <Lock size={11} />
                  Set as destination
                </button>
              )}
              {!isOwner && <span />}
              {canEdit && (
                <button
                  data-testid={`remove-idea-${idea.id}`}
                  onClick={() => onDelete(idea)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right column — crew chat, desktop only. Height set by left column via grid row. */}
        <div
          className="relative hidden lg:block"
          style={{ borderLeft: "1px solid var(--color-bt-border)" }}
        >
          <div className="absolute inset-0 flex flex-col p-4">
            <CommentsSection tripId={tripId} ideaId={idea.id} variant="chat" />
          </div>
        </div>
      </div>

      {/* Mobile — comments below the fold, thread variant */}
      <div className="px-4 pb-4 lg:hidden">
        <div style={{ borderTop: "1px solid var(--color-bt-border)", paddingTop: 16 }}>
          <CommentsSection tripId={tripId} ideaId={idea.id} variant="thread" />
        </div>
      </div>
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
      onClose();
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

function VotingPanel({ tripId, ideas, currentUserId, lockedIdeaId }: { tripId: string; ideas: Idea[]; currentUserId: string | undefined; lockedIdeaId?: string }) {
  const utils = trpc.useUtils();
  const [pendingIdeaId, setPendingIdeaId] = useState<string | null>(null);
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const crewSize = Math.max(members.length, 1);

  const vote = trpc.ideas.vote.useMutation({
    async onMutate({ ideaId }) {
      setPendingIdeaId(ideaId);
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
      setPendingIdeaId(null);
      utils.ideas.list.invalidate({ tripId });
    },
  });

  return (
    <div
      className="mb-6 rounded-2xl border p-4"
      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Crew votes
      </p>
      <p className="mb-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {new Set(ideas.flatMap((i) => i.votes.map((v) => v.user_id))).size} of {crewSize} voted
      </p>
      <div className="space-y-2">
        {ideas.map((idea) => {
            const isLockedRow = idea.id === lockedIdeaId;
            const isVoted = idea.votes.some((v) => v.user_id === currentUserId);
            const barWidth = `${Math.round((idea.votes.length / crewSize) * 100)}%`;
            return (
              <div key={idea.id}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className="line-clamp-2 text-sm font-medium leading-tight"
                      style={{ color: isLockedRow ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}
                    >
                      {idea.title}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      {idea.votes.length} vote{idea.votes.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {!lockedIdeaId && (
                    <button
                      data-testid={`vote-idea-${idea.id}`}
                      disabled={pendingIdeaId === idea.id}
                      onClick={() => vote.mutate({ tripId, ideaId: idea.id })}
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40"
                      style={{
                        background: isVoted ? "var(--color-bt-accent)" : "var(--color-bt-base)",
                        border: `1px solid ${isVoted ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                        color: isVoted ? "var(--color-bt-base)" : "var(--color-bt-text-dim)",
                      }}
                    >
                      <ThumbsUp size={12} />
                      {isVoted ? "My vote" : "Vote"}
                    </button>
                  )}
                </div>
                <div
                  className="mt-1 h-1 overflow-hidden rounded-full"
                  style={{ background: "var(--color-bt-base)", width: "100%" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: barWidth,
                      background: isLockedRow
                        ? "var(--color-bt-accent)"
                        : isVoted
                        ? "var(--color-bt-border)"
                        : "var(--color-bt-border)",
                    }}
                  />
                </div>
              </div>
            );
          })}
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
  // Catalog-only rich fields — undefined for manual/ai ideas
  imageUrl?: string;
  golfCourses?: string[];
  activities?: string[];
  accommodation?: string;
  tips?: string;
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
          imageUrl: catalogIdea.image_url ?? undefined,
          golfCourses: catalogIdea.golf_courses?.length ? catalogIdea.golf_courses : undefined,
          activities: catalogIdea.activities?.length ? catalogIdea.activities : undefined,
          accommodation: catalogIdea.accommodation ?? undefined,
          tips: catalogIdea.tips ?? undefined,
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
            id: crypto.randomUUID(), // always fresh — avoids PK conflicts on retry or duplicate catalog picks
            title: idea.title,
            location: idea.location,
            description: idea.description,
            costTier: idea.costTier,
            imageUrl: idea.imageUrl,
            golfCourses: idea.golfCourses,
            activities: idea.activities,
            accommodation: idea.accommodation,
            notes: idea.tips,
            source: idea.source,
          })
        )
      );
      utils.ideas.list.invalidate({ tripId });
      setLocalIdeas([]);
      onClose?.();
    } catch (err) {
      console.error("Failed to save ideas:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`mx-auto max-w-[896px] px-4 py-8 ${localIdeas.length > 0 ? "pb-24" : ""}`}>
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

      {/* ── 2. Divider ── */}
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
        <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>or</span>
        <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
      </div>

      {/* ── 3. Ask Buddy panel ── */}
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

      {/* ── 4. Manual add ── */}
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

      {/* ── 5. Sticky compare bar ──
           In modal context (onClose set): sticky so it stays in the modal's
           scroll container above the z-50 overlay.
           In page context (no modal): fixed to the viewport at z-40. */}
      {localIdeas.length > 0 && (
        <div
          className={`fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3 ${onClose ? "z-[60]" : "z-40"}`}
          style={{
            background: "linear-gradient(to top, var(--color-bt-base) 70%, transparent)",
          }}
        >
          <button
            onClick={handleCompare}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold shadow-lg transition-opacity disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              ...(onClose ? {} : { maxWidth: 896, margin: "0 auto" }),
            }}
          >
            {isSubmitting ? (
              <><Loader2 size={16} className="animate-spin" /> Saving…</>
            ) : onClose ? (
              <>
                Add {localIdeas[0]?.title}
                {localIdeas.length > 1 && (
                  <span
                    className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ background: "rgba(0,0,0,0.2)" }}
                  >
                    +{localIdeas.length - 1} more
                  </span>
                )}
                {" "}to the list →
              </>
            ) : (
              <>
                Compare {localIdeas.length} idea{localIdeas.length !== 1 ? "s" : ""} →
                <span
                  className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold"
                  style={{ background: "rgba(0,0,0,0.2)" }}
                >
                  {localIdeas[0]?.title.split(" ").slice(0, 2).join(" ")}
                  {localIdeas.length > 1 ? ` +${localIdeas.length - 1}` : ""}
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── AddIdeasModal ─────────────────────────────────────────────────────────

function AddIdeasModal({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  useModalBackButton(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pt-16"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg lg:max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl"
        style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Add ideas
          </p>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>
        <EmptyStateOnboarding tripId={tripId} onClose={onClose} />
      </div>
    </div>
  );
}

// ── InviteInput ───────────────────────────────────────────────────────────

function InviteInput({
  tripId,
  onInvited,
  frequentTripmates = [],
}: {
  tripId: string;
  onInvited: () => void;
  frequentTripmates?: Array<{ id: string; name: string | null; nickname: string | null; email: string }>;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "found" | "not-found">("idle");
  const [foundUser, setFoundUser] = useState<{ id: string; name: string | null; nickname: string | null; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [alreadyMemberName, setAlreadyMemberName] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const addMember = trpc.tripMembers.add.useMutation({
    onSuccess() {
      setEmail("");
      setStatus("idle");
      setFoundUser(null);
      utils.tripMembers.list.invalidate({ tripId });
      onInvited();
    },
  });

  const inviteByEmail = trpc.tripMembers.inviteByEmail.useMutation();

  const handleLookup = async () => {
    if (!email.includes("@")) return;
    const results = await utils.users.search.fetch({ query: email.toLowerCase() });
    if (results && results.length > 0) {
      setFoundUser(results[0] as { id: string; name: string | null; nickname: string | null; email: string });
      setStatus("found");
    } else {
      setFoundUser(null);
      setStatus("not-found");
    }
  };

  const handleCopyInvite = async () => {
    const inviteUrl = `${window.location.origin}/invite?trip=${tripId}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // Fallback for restricted contexts (iframes, http, etc.)
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try { document.execCommand("copy"); } catch { /* best effort */ }
      document.body.removeChild(textarea);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      {/* Frequent tripmates chips */}
      {frequentTripmates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {frequentTripmates.map((user) => (
            <button
              key={user.id}
              onClick={() => addMember.mutate({ tripId, userId: user.id, role: "Planner" })}
              disabled={addMember.isPending}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{
                background: "var(--color-bt-tag-bg)",
                color: "var(--color-bt-accent)",
                border: "1px solid color-mix(in srgb, var(--color-bt-accent) 30%, transparent)",
              }}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {(user.nickname ?? user.name ?? user.email).charAt(0).toUpperCase()}
              </span>
              {user.nickname ?? user.name?.split(" ")[0]}
              <Plus size={10} />
            </button>
          ))}
        </div>
      )}

      {/* Email input + Find button */}
      <div className="flex gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus("idle"); setFoundUser(null); setInviteError(null); setAlreadyMemberName(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleLookup(); }}
          placeholder="email@example.com"
          className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <button
          onClick={handleLookup}
          disabled={!email.includes("@")}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          Find
        </button>
      </div>

      {/* Found state */}
      {status === "found" && foundUser && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
            style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
          >
            {(foundUser.nickname ?? foundUser.name ?? foundUser.email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" style={{ color: "var(--color-bt-text)" }}>
              {foundUser.name ?? foundUser.email}
              {foundUser.nickname && (
                <span className="ml-1" style={{ color: "var(--color-bt-text-dim)" }}>
                  ({foundUser.nickname})
                </span>
              )}
            </p>
            <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
              BuddyTrip member
            </p>
          </div>
          <button
            onClick={() => addMember.mutate({ tripId, userId: foundUser.id, role: "Planner" })}
            disabled={addMember.isPending}
            className="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {addMember.isPending ? "Adding…" : "+ Add"}
          </button>
        </div>
      )}

      {/* Not found state */}
      {status === "not-found" && (
        <div
          className="rounded-lg px-3 py-2.5 space-y-2"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            No BuddyTrip account found for that email.
          </p>
          {alreadyMemberName && (
            <p className="text-xs font-medium" style={{ color: "var(--color-bt-warning)" }}>
              Already on this trip as &ldquo;{alreadyMemberName}&rdquo;
            </p>
          )}
          {inviteError && (
            <p className="text-xs" style={{ color: "var(--color-bt-warning)" }}>
              {inviteError}
            </p>
          )}
          <button
            onClick={async () => {
              setInviteError(null);
              setAlreadyMemberName(null);
              try {
                const result = await inviteByEmail.mutateAsync({ tripId, email });
                if (result.status === "already_member") {
                  setAlreadyMemberName(result.displayName);
                  return;
                }
                if (result.status === "real_account_exists") {
                  setInviteError("A BuddyTrip account exists for that email — try searching for it.");
                  return;
                }
                setEmail("");
                setStatus("idle");
                setAlreadyMemberName(null);
                utils.tripMembers.list.invalidate({ tripId });
                onInvited();
              } catch {
                setInviteError("Failed to create invite. Please try again.");
              }
            }}
            disabled={inviteByEmail.isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {inviteByEmail.isPending ? (
              <><Loader2 size={11} className="animate-spin" /> Sending invite…</>
            ) : (
              <><UserPlus size={11} /> Invite to BuddyTrip</>
            )}
          </button>
          <button
            onClick={handleCopyInvite}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {copied ? (
              <><Check size={11} /> Link copied!</>
            ) : (
              <><Link size={11} /> Copy invite link instead</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ReopenConfirmModal ────────────────────────────────────────────────────

function ReopenConfirmModal({
  tripId,
  destinationTitle,
  onClose,
}: {
  tripId: string;
  destinationTitle: string;
  onClose: () => void;
}) {
  useModalBackButton(onClose);
  const utils = trpc.useUtils();

  const unlockDest = trpc.trips.unlockDestination.useMutation({
    onSuccess() {
      utils.trips.getById.invalidate({ tripId });
      onClose();
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
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-2 text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Reopen destination discussion?
        </p>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          This removes{" "}
          <strong style={{ color: "var(--color-bt-text)" }}>{destinationTitle}</strong>{" "}
          as the locked destination and reopens voting for the whole crew. Any trip planning tied to
          this destination should be reviewed.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Keep it locked
          </button>
          <button
            disabled={unlockDest.isPending}
            onClick={() => unlockDest.mutate({ tripId })}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--color-bt-warning)", color: "#fff" }}
          >
            {unlockDest.isPending ? "Reopening…" : "Yes, reopen discussion"}
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

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [showAddModal, setShowAddModal] = useState(false);
  const [lockIdea, setLockIdea] = useState<Idea | null>(null);
  const [deleteIdea, setDeleteIdea] = useState<Idea | null>(null);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);

  useEffect(() => {
    if (showAddModal) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [showAddModal]);

  const { data: trip } = trpc.trips.getById.useQuery({ tripId });
  const { data: ideas = [], isLoading } = trpc.ideas.list.useQuery({ tripId });
  const { data: members = [], refetch: refetchMembers } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: isOwner }
  );

  const { data: frequentTripmates = [], refetch: refetchTripmates } = trpc.users.frequentTripmates.useQuery(
    { tripId },
    { enabled: isOwner }
  );

  const utils = trpc.useUtils();
  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() {
      refetchMembers();
      refetchTripmates();
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

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

      {/* Mobile-only back link — breadcrumb is sufficient on desktop */}
      <div className="lg:hidden px-4 pt-3 pb-0">
        <button
          onClick={() => router.back()}
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-bt-accent)" }}
        >
          ← Back to trip planning
        </button>
      </div>

      {trip?.locked_destination_title && (
        <div
          className="border-b px-4 py-3"
          style={{
            background: "var(--color-bt-tag-bg)",
            borderColor: "rgba(var(--color-bt-accent-rgb, 0,0,0), 0.3)",
          }}
        >
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--color-bt-accent)" }}
              >
                <Check size={11} color="white" />
              </div>
              <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                <span style={{ color: "var(--color-bt-accent)", fontWeight: 700 }}>
                  {trip.locked_destination_title}
                </span>
                {" "}is set as your destination
              </span>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {isOwner && (
                <button
                  onClick={() => setShowReopenConfirm(true)}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Reopen discussion
                </button>
              )}
              <a
                href={`/trips/${tripId}`}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Go to trip planning →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[1400px] p-4">
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
            const lockedAt = trip?.locked_destination_at
              ? new Date(trip.locked_destination_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : null;
            const otherIdeas = (lockedIdea
              ? ideasTyped.filter((i) => i.id !== lockedIdea.id)
              : ideasTyped
            ).sort((a, b) => b.votes.length - a.votes.length);
            const maxVotes = Math.max(...otherIdeas.map((i) => i.votes.length), 0);
            const isLeading = (idea: Idea) =>
              !lockedIdea && maxVotes > 0 && idea.votes.length === maxVotes;
            const votingPanelIdeas = lockedIdea
              ? [lockedIdea, ...otherIdeas]
              : ideasTyped.slice().sort((a, b) => b.votes.length - a.votes.length);

            return (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">

                {/* Right column — first in DOM for mobile (shows on top), pushed right on desktop */}
                <div className="lg:order-last lg:w-72 lg:flex-shrink-0 lg:sticky lg:top-4 lg:self-start">
                  <VotingPanel
                    tripId={tripId}
                    ideas={votingPanelIdeas}
                    currentUserId={currentUser?.id}
                    lockedIdeaId={lockedIdea?.id}
                  />
                  {canEdit && (
                    <button
                      data-testid="add-idea-btn"
                      onClick={() => setShowAddModal(true)}
                      className="mt-2 w-full rounded-xl border py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
                      style={{
                        borderColor: "var(--color-bt-border)",
                        color: "var(--color-bt-accent)",
                      }}
                    >
                      + Add idea
                    </button>
                  )}

                  {isOwner && members.length > 0 && (
                    <div
                      className="mt-3 rounded-2xl border p-4"
                      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
                    >
                      <div className="mb-3">
                        <p
                          className="text-xs font-semibold uppercase tracking-wider"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          Co-planners ({members.filter((m) => m.role === "Owner" || m.role === "Planner").length})
                        </p>
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                          Helping decide where you&apos;re headed
                        </p>
                      </div>

                      <div className="mb-3 space-y-2">
                        {members
                          .filter((m) => m.role === "Owner" || m.role === "Planner")
                          .map((m) => {
                            const isPending = m.status === "invited";
                            const isMe = m.user_id === currentUser?.id;
                            const display = isPending
                              ? (m.user?.email ?? m.displayName)
                              : m.displayName;
                            const initial = display.charAt(0).toUpperCase();
                            const roleColor =
                              m.role === "Owner"
                                ? "var(--color-bt-owner)"
                                : "var(--color-bt-planning)";
                            return (
                              <div key={m.user_id} className="flex items-center gap-2">
                                <div
                                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                                  style={{
                                    background: isPending ? "var(--color-bt-past-bg)" : "var(--color-bt-tag-bg)",
                                    color: isPending ? "var(--color-bt-text-dim)" : "var(--color-bt-accent)",
                                  }}
                                >
                                  {initial}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p
                                    className="truncate text-xs"
                                    style={{ color: isPending ? "var(--color-bt-text-dim)" : "var(--color-bt-text)" }}
                                  >
                                    {display}
                                  </p>
                                  {(isPending || m.user?.is_guest) && m.user?.email && (
                                    <p className="truncate text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                                      {m.user.email}
                                    </p>
                                  )}
                                </div>
                                {isPending ? (
                                  <span className="text-[10px] font-semibold" style={{ color: "var(--color-bt-warning)" }}>
                                    Invited
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-semibold" style={{ color: roleColor }}>
                                    {m.role}
                                  </span>
                                )}
                                {isOwner && !isMe && (
                                  <button
                                    onClick={() => removeMember.mutate({ tripId, userId: m.user_id })}
                                    disabled={removeMember.isPending}
                                    className="ml-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
                                    style={{ color: "var(--color-bt-text-dim)" }}
                                    title="Remove"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                      </div>

                      <InviteInput
                        tripId={tripId}
                        onInvited={() => { refetchMembers(); refetchTripmates(); }}
                        frequentTripmates={frequentTripmates}
                      />
                    </div>
                  )}
                </div>

                {/* Left column — idea cards */}
                <div className="flex flex-col gap-4 lg:flex-1 lg:min-w-0">
                  {/* Current destination pinned at top */}
                  {lockedIdea && (
                    <div>
                      <div className="mb-3">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <CheckCircle2 size={15} style={{ color: "var(--color-bt-accent)" }} fill="currentColor" />
                          <span
                            className="text-sm font-bold"
                            style={{ color: "var(--color-bt-text)" }}
                          >
                            Where We&apos;re Going
                          </span>
                        </div>
                        {lockedAt && (
                          <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                            Set {lockedAt}
                          </p>
                        )}
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
                      {/* Section label — only when a destination is locked */}
                      {lockedIdea && (
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
                          <span
                            className="text-[11px] font-semibold uppercase tracking-wider flex-shrink-0"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            Other destinations we considered
                          </span>
                          <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
                        </div>
                      )}

                      {/* Compact list when locked, full cards when not */}
                      {lockedIdea ? (
                        <div
                          className="overflow-hidden rounded-2xl"
                          style={{ border: "1px solid var(--color-bt-border)" }}
                        >
                          {otherIdeas.map((idea, i) => {
                            const isExpanded = !!lockedIdea && expandedIdeaId === idea.id;
                            return (
                              <div key={idea.id}>
                                {i > 0 && (
                                  <div style={{ borderTop: "1px solid var(--color-bt-border)" }} />
                                )}
                                {/* Compact row */}
                                <button
                                  onClick={() => setExpandedIdeaId(isExpanded ? null : idea.id)}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                                >
                                  {idea.image_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={idea.image_url}
                                      alt={idea.title}
                                      className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                                    />
                                  ) : (
                                    <div
                                      className="h-10 w-10 flex-shrink-0 rounded-lg"
                                      style={{ background: ideaGradient(i, isDark) }}
                                    />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                                      {idea.title}
                                    </p>
                                    <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                                      {idea.location}
                                      {idea.votes.length > 0 && (
                                        <span className="ml-2">
                                          · {idea.votes.length} vote{idea.votes.length !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <div className="flex flex-shrink-0 items-center gap-2">
                                    {idea.cost_tier && (
                                      <span className="text-xs font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                                        {idea.cost_tier}
                                      </span>
                                    )}
                                    <span
                                      className="text-sm transition-transform duration-200"
                                      style={{
                                        color: "var(--color-bt-text-dim)",
                                        display: "inline-block",
                                        transform: isExpanded ? "rotate(90deg)" : "none",
                                      }}
                                    >
                                      ›
                                    </span>
                                  </div>
                                </button>

                                {/* Expanded full card */}
                                {isExpanded && (
                                  <div style={{ borderTop: "1px solid var(--color-bt-border)" }}>
                                    <IdeaCard
                                      idea={idea}
                                      tripId={tripId}
                                      canEdit={canEdit}
                                      isOwner={isOwner}
                                      isLocked={false}
                                      index={i + 1}
                                      onLock={setLockIdea}
                                      onDelete={setDeleteIdea}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        /* No destination locked — full cards as before */
                        otherIdeas.map((idea, i) => (
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
                        ))
                      )}
                    </div>
                  )}
                </div>

              </div>
            );
          })()
        )}
      </main>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddIdeasModal tripId={tripId} onClose={() => setShowAddModal(false)} />
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
      {showReopenConfirm && trip?.locked_destination_title && (
        <ReopenConfirmModal
          tripId={tripId}
          destinationTitle={trip.locked_destination_title}
          onClose={() => setShowReopenConfirm(false)}
        />
      )}
    </div>
  );
}
