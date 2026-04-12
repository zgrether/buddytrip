"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { UserAvatar } from "@/components/UserAvatar";
import {
  ThumbsUp,
  MapPin,
  Star,
  Flag,
  Zap,
  X,
  Sparkles,
  Loader2,
  Trash2,
  Check,
  Plus,
  MessageCircle,
  Users,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { temporalGradient } from "@/lib/temporalGradient";
import { CatalogBrowser } from "../compare/CatalogBrowser";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import { SidebarChatPanel } from "./PlanningChatPanel";
import { StageContextBar } from "./StageContextBar";
import { AddIdeaLodgingSheet } from "./AddIdeaLodgingSheet";
import type { CatalogIdea, TripData } from "@/app/trips/[tripId]/tabs/types";

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

// ── IdeaLodgingOption ─────────────────────────────────────────────────────

export interface IdeaLodgingOption {
  id: string;
  idea_id: string;
  trip_id: string;
  name: string;
  source?: string | null;
  sleeps?: number | null;
  price_note?: string | null;
  url?: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
}

// ── IdeaCard ─────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  tripId,
  canEdit,
  isOwner,
  tripStartDate,
  currentUserId,
  memberData,
  onVote,
  votePending,
  onSetDestination,
  onDelete,
}: {
  idea: Idea;
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  tripStartDate?: string | null;
  currentUserId?: string;
  memberData: { memberId: string; displayName: string }[];
  onVote: (ideaId: string) => void;
  votePending: boolean;
  onSetDestination: (idea: Idea) => void;
  onDelete: (idea: Idea) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const utils = trpc.useUtils();
  const [editingField, setEditingField] = useState<"title" | "location" | "description" | "pros" | "cons" | "golfCourses" | "activities" | "accommodation" | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [showAddLodging, setShowAddLodging] = useState(false);
  const [editingLodging, setEditingLodging] = useState<IdeaLodgingOption | null>(null);

  const { data: lodgingOptions = [] } = trpc.ideaLodging.list.useQuery(
    { ideaId: idea.id },
    { staleTime: 30_000 }
  );

  const removeLodging = trpc.ideaLodging.remove.useMutation({
    onSuccess: () => utils.ideaLodging.list.invalidate({ ideaId: idea.id }),
  });

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
        {updateIdea.isPending ? "Saving..." : "Save"}
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
      className="overflow-hidden rounded-2xl transition-shadow"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden min-h-[160px]"
        style={{
          background: idea.image_url ? undefined : temporalGradient(tripStartDate, isDark),
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
              background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
            }}
          />
        )}
        {/* Vote button + voter avatars — top-left overlay */}
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
          {(() => {
            const isVoted = idea.votes.some((v) => v.user_id === currentUserId);
            return (
              <button
                data-testid={`vote-idea-${idea.id}`}
                disabled={votePending}
                onClick={(e) => { e.stopPropagation(); onVote(idea.id); }}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all disabled:opacity-40"
                style={isVoted ? {
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-base)",
                } : {
                  background: "color-mix(in srgb, var(--color-bt-card) 80%, transparent)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                <ThumbsUp size={14} />
                {isVoted ? "My vote" : "Vote"}
              </button>
            );
          })()}
          {idea.votes.length > 0 && (() => {
            const voterIds = idea.votes.map((v) => v.user_id);
            const visible = voterIds.slice(0, 4);
            const overflow = voterIds.length - visible.length;
            return (
              <div className="flex items-center">
                {visible.map((voterId, idx) => {
                  const member = memberData.find((m) => m.memberId === voterId);
                  const name = member?.displayName ?? voterId.slice(0, 8);
                  return (
                    <div
                      key={voterId}
                      style={{ marginLeft: idx === 0 ? 0 : -6, zIndex: visible.length - idx }}
                      className="relative"
                    >
                      <UserAvatar name={name} avatarUrl={null} sizePx={20} />
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <span
                    className="flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold"
                    style={{
                      marginLeft: -6,
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text-dim)",
                    }}
                  >
                    +{overflow}
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        {idea.cost_tier && (
          <div className="absolute right-3 top-3">
            <span
              className="rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}
            >
              {idea.cost_tier}
            </span>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-4">
          {(() => {
            // Text colors: white over photo scrim, theme tokens over gradient fallback
            const titleColor = idea.image_url ? "#ffffff" : "var(--color-bt-text)";
            const subColor = idea.image_url ? "rgba(255,255,255,0.85)" : "var(--color-bt-text-dim)";
            const dimColor = idea.image_url ? "rgba(255,255,255,0.5)" : "var(--color-bt-text-dim)";
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
                        {updateIdea.isPending ? "Saving..." : "Save"}
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
                        {updateIdea.isPending ? "Saving..." : "Save"}
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
                      : <span className="italic">{canEdit ? "Add location..." : ""}</span>}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Body — single column ────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--color-bt-border)" }}>
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
                  + Add a description &mdash; what&apos;s the pitch?
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
                  <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--color-bt-danger)" }}>&times; CONS</p>
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

          {/* Lodging options */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Lodging
            </p>
            {lodgingOptions.length === 0 ? (
              canEdit ? (
                <button
                  data-testid={`add-lodging-empty-${idea.id}`}
                  onClick={() => setShowAddLodging(true)}
                  className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-[13px] transition-opacity hover:opacity-70"
                  style={{
                    border: "1.5px dashed var(--color-bt-accent)",
                    color: "var(--color-bt-accent)",
                  }}
                >
                  <Plus size={14} />
                  Add properties for discussion
                </button>
              ) : null
            ) : (
              <>
                <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
                  {lodgingOptions.map((opt) => (
                    <div
                      key={opt.id}
                      className="rounded-xl px-3 py-2.5"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {opt.source && (
                            <span
                              className="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase"
                              style={{
                                background: "var(--color-bt-card)",
                                border: "1px solid var(--color-bt-border)",
                                color: "var(--color-bt-text-dim)",
                              }}
                            >
                              {opt.source}
                            </span>
                          )}
                          <p className="truncate text-[14px] font-medium" style={{ color: "var(--color-bt-text)" }}>
                            {opt.name}
                          </p>
                        </div>
                        {canEdit && (
                          <div className="flex flex-shrink-0 items-center gap-1">
                            <button
                              onClick={() => setEditingLodging(opt as IdeaLodgingOption)}
                              className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
                              aria-label="Edit"
                            >
                              <Pencil size={14} style={{ color: "var(--color-bt-text-dim)" }} />
                            </button>
                            <button
                              onClick={() => removeLodging.mutate({ id: opt.id, tripId: idea.trip_id })}
                              disabled={removeLodging.isPending}
                              className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
                              aria-label="Delete"
                            >
                              <Trash2 size={14} style={{ color: "var(--color-bt-text-dim)" }} />
                            </button>
                          </div>
                        )}
                      </div>
                      {(opt.sleeps != null || opt.price_note) && (
                        <p className="mt-1 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                          {[
                            opt.sleeps != null ? `Sleeps ${opt.sleeps}` : null,
                            opt.price_note ?? null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {opt.url && (
                        <a
                          href={opt.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 flex items-center gap-1 text-[12px] transition-opacity hover:opacity-70"
                          style={{ color: "var(--color-bt-accent)" }}
                        >
                          <ExternalLink size={11} />
                          View listing
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    data-testid={`add-lodging-more-${idea.id}`}
                    onClick={() => setShowAddLodging(true)}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl px-4 py-3 text-[13px] transition-opacity hover:opacity-70"
                    style={{
                      border: "1.5px dashed var(--color-bt-accent)",
                      color: "var(--color-bt-accent)",
                    }}
                  >
                    <Plus size={14} />
                    Add another property
                  </button>
                )}
              </>
            )}
          </div>
          {/* AddIdeaLodgingSheet */}
          {showAddLodging && (
            <AddIdeaLodgingSheet
              tripId={tripId}
              ideaId={idea.id}
              onClose={() => setShowAddLodging(false)}
            />
          )}
          {editingLodging && (
            <AddIdeaLodgingSheet
              tripId={tripId}
              ideaId={idea.id}
              item={editingLodging}
              onClose={() => setEditingLodging(null)}
            />
          )}

          {/* Footer actions */}
          {(isOwner || canEdit) && (
            <div
              className="flex items-center justify-between pt-3"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              {isOwner ? (
                <button
                  data-testid={`set-destination-${idea.id}`}
                  onClick={() => onSetDestination(idea)}
                  className="text-sm font-medium transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  Set as destination
                </button>
              ) : (
                <span />
              )}
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
        style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)", boxShadow: "var(--shadow-floating)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-2 text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Remove {idea.title}?
        </p>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          This will permanently delete this idea and all its votes.
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
            {removeIdea.isPending ? "Removing..." : "Yes, remove it"}
          </button>
        </div>
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
  const [buddyExpanded, setBuddyExpanded] = useState(false);
  const [buddyPrompt, setBuddyPrompt] = useState("");
  const [buddyLoading, setBuddyLoading] = useState(false);
  const [buddyError, setBuddyError] = useState("");
  const [buddySuggestions, setBuddySuggestions] = useState<LocalIdea[]>([]);
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

  const handleAskBuddy = async () => {
    setBuddyError("");
    setBuddyLoading(true);
    try {
      const res = await fetch("/api/ai/suggest-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewDescription: buddyPrompt.trim() }),
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
      // Replace any previous suggestions — user can toggle these cards to select/deselect
      setBuddySuggestions(incoming);
      setBuddyPrompt("");
    } catch {
      setBuddyError("Failed to get suggestions. Please try again.");
    } finally {
      setBuddyLoading(false);
    }
  };

  const toggleBuddySuggestion = (suggestion: LocalIdea) => {
    const alreadyStaged = localIdeas.some((i) => i.id === suggestion.id);
    if (alreadyStaged) {
      setLocalIdeas((prev) => prev.filter((i) => i.id !== suggestion.id));
    } else {
      setLocalIdeas((prev) => [...prev, suggestion]);
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

      {/* ── 3. Ask Buddy panel — collapsed by default ── */}
      {!buddyExpanded ? (
        /* ── Collapsed trigger ── */
        <button
          onClick={() => setBuddyExpanded(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{
            borderColor: "var(--color-bt-border)",
            borderStyle: "dashed",
            color: "var(--color-bt-accent)",
          }}
        >
          <Sparkles size={15} />
          Ask Buddy for suggestions
        </button>
      ) : (
        /* ── Expanded panel ── */
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
        >
          {/* Header row */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} style={{ color: "var(--color-bt-accent)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Ask Buddy
              </span>
            </div>
            <button
              onClick={() => setBuddyExpanded(false)}
              className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Prompt + fetch */}
          <p className="mb-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            Tell us about your crew and we&apos;ll suggest some ideas to kick things off.
          </p>
          <textarea
            value={buddyPrompt}
            onChange={(e) => setBuddyPrompt(e.target.value)}
            placeholder="e.g. 6 guys, links lovers, mid-range budget, did Bandon last year..."
            rows={3}
            maxLength={2000}
            className="mb-2 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          {buddyError && (
            <p className="mb-2 text-xs" style={{ color: "var(--color-bt-danger)" }}>{buddyError}</p>
          )}
          <button
            onClick={handleAskBuddy}
            disabled={!buddyPrompt.trim() || buddyLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {buddyLoading ? (
              <><Loader2 size={14} className="animate-spin" /> Thinking...</>
            ) : (
              <><Sparkles size={14} /> Ask Buddy</>
            )}
          </button>

          {/* Suggestion cards — same tap-to-select as catalog ── */}
          {buddySuggestions.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
                Tap to add to your list:
              </p>
              <div className="grid grid-cols-2 gap-3">
                {buddySuggestions.map((s) => {
                  const isSelected = localIdeas.some((i) => i.id === s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleBuddySuggestion(s)}
                      className="relative overflow-hidden rounded-xl border text-left transition-all"
                      style={{
                        borderColor: isSelected ? "var(--color-bt-accent)" : "var(--color-bt-border)",
                        background: isSelected ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
                      }}
                    >
                      {isSelected && (
                        <div
                          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full"
                          style={{ background: "var(--color-bt-accent)" }}
                        >
                          <Check size={11} color="var(--color-bt-base)" />
                        </div>
                      )}
                      <div className="p-3">
                        <p
                          className="pr-6 text-xs font-semibold leading-tight"
                          style={{ color: "var(--color-bt-text)" }}
                        >
                          {s.title}
                        </p>
                        <p className="mt-1 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                          {s.location}
                          {s.costTier && (
                            <span className="ml-1.5 font-semibold" style={{ color: "var(--color-bt-accent)" }}>
                              {s.costTier}
                            </span>
                          )}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => { setBuddySuggestions([]); setBuddyPrompt(""); }}
                className="mt-2 w-full text-center text-xs"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Try again with a different description
              </button>
            </div>
          )}
        </div>
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

      {/* ── 5. Sticky compare bar ── */}
      {localIdeas.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 px-4 pt-3"
          style={{
            zIndex: 60,
            paddingBottom: "4.5rem",
            background: "var(--color-bt-card)",
            borderTop: "1px solid var(--color-bt-accent-border)",
            boxShadow: "0 -4px 12px rgba(0,0,0,.08)",
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
              <><Loader2 size={16} className="animate-spin" /> Saving...</>
            ) : (
              <>Compare {localIdeas.length} idea{localIdeas.length !== 1 ? "s" : ""} &rarr;</>
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
    <>
      {/* Mobile — bottom sheet */}
      <div
        className="fixed inset-0 z-50 flex items-end lg:hidden"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="flex w-full max-h-[90vh] flex-col rounded-t-2xl overflow-hidden"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2 shrink-0">
            <div className="h-1 w-8 rounded-full" style={{ background: "var(--color-bt-border)" }} />
          </div>
          <div className="flex items-center justify-between px-5 pb-0 shrink-0">
            <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Add destination ideas
            </p>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto">
            <EmptyStateOnboarding tripId={tripId} onClose={onClose} />
          </div>
        </div>
      </div>

      {/* Desktop — centered modal */}
      <div
        className="fixed inset-0 z-50 hidden items-start justify-center overflow-y-auto px-4 pt-16 lg:flex"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Add destination ideas
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
    </>
  );
}

// ── SetDestinationSheet ───────────────────────────────────────────────────

function SetDestinationSheet({
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lodgingError, setLodgingError] = useState<string | null>(null);

  const { data: lodgingOptions = [] } = trpc.ideaLodging.list.useQuery(
    { ideaId: idea.id },
    { staleTime: 30_000 }
  );

  // Default: all options checked
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(lodgingOptions.map((o) => o.id))
  );

  // Update checkedIds when options load (initialises after query resolves)
  const [initialised, setInitialised] = useState(false);
  if (!initialised && lodgingOptions.length > 0) {
    setCheckedIds(new Set(lodgingOptions.map((o) => o.id)));
    setInitialised(true);
  }

  const lockDestination = trpc.trips.lockDestination.useMutation();
  const advanceToPlanning = trpc.trips.advanceToPlanning.useMutation();
  const unlockDestination = trpc.trips.unlockDestination.useMutation();
  const createLogistics = trpc.logistics.create.useMutation();

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setLodgingError(null);
    try {
      // 1. Lock destination
      await lockDestination.mutateAsync({
        tripId,
        title: idea.title,
        location: idea.location,
      });

      // 2. Carry over checked lodging options
      const toCarry = lodgingOptions.filter((o) => checkedIds.has(o.id));
      if (toCarry.length > 0) {
        try {
          await Promise.all(
            toCarry.map((opt) =>
              createLogistics.mutateAsync({
                tripId,
                type: "lodging",
                label: opt.name,
                propertyName: opt.sleeps != null ? String(opt.sleeps) : undefined,
                detail: opt.url ?? undefined,
                transportType: opt.source ?? "other",
              })
            )
          );
        } catch {
          setLodgingError(
            "Destination set but some lodging options couldn't be copied — add them manually."
          );
          // Stage advance still proceeds
        }
      }

      // 3. Advance to planning
      try {
        await advanceToPlanning.mutateAsync({ tripId });
      } catch {
        // Rollback the lock if advancing fails
        await unlockDestination.mutateAsync({ tripId });
        throw new Error("Failed to advance to planning. Destination lock rolled back.");
      }

      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      utils.ideas.list.invalidate({ tripId });
      onClose();
    } catch (err) {
      console.error("Failed to set destination:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
        style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)", boxShadow: "var(--shadow-floating)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: "var(--color-bt-border)" }} />

        <p className="mb-2 text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Set {idea.location} as your destination?
        </p>
        <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          This will lock in{" "}
          <strong style={{ color: "var(--color-bt-text)" }}>{idea.location}</strong>{" "}
          and move the trip to Planning. The crew can start on dates and logistics.
        </p>

        {/* Lodging carry-over section */}
        {lodgingOptions.length > 0 && (
          <>
            <div className="my-4" style={{ borderTop: "1px solid var(--color-bt-border)" }} />
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Lodging Options
            </p>
            <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Carry these over to your planning logistics?
            </p>
            <div className="space-y-2 mb-3">
              {lodgingOptions.map((opt) => {
                const isChecked = checkedIds.has(opt.id);
                const meta = [
                  opt.sleeps != null ? `Sleeps ${opt.sleeps}` : null,
                  opt.price_note ?? null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleCheck(opt.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                    style={{ background: "var(--color-bt-card-raised)" }}
                  >
                    <div
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
                      style={{
                        background: isChecked ? "var(--color-bt-accent)" : "transparent",
                        border: isChecked ? "none" : "1.5px solid var(--color-bt-border)",
                      }}
                    >
                      {isChecked && <Check size={10} color="var(--color-bt-base)" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                        {opt.name}
                      </p>
                      {meta && (
                        <p className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                          {meta}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mb-4 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
              Checked items will be added to your planning logistics.
            </p>
          </>
        )}

        {lodgingError && (
          <p className="mb-3 text-xs" style={{ color: "var(--color-bt-danger)" }}>
            {lodgingError}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Not yet
          </button>
          <button
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {isSubmitting ? "Setting..." : "Let's go"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CoPlannerPanel (IDEA stage — enhanced co-planners mini panel) ─────────

function CoPlannerPanel({
  tripId,
  members,
  isOwner,
  allVoterIds,
}: {
  tripId: string;
  members: Array<{ user_id: string; memberId: string; role: string; status: string; displayName: string }>;
  isOwner: boolean;
  /** Set of user IDs who have voted on any idea */
  allVoterIds: Set<string>;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const planners = members.filter((m) => m.role === "Owner" || m.role === "Planner");

  const demote = trpc.tripMembers.updateRole.useMutation({
    onSuccess: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  return (
    <div
      className="hidden lg:block rounded-xl border px-3 py-3"
      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Co-planners
      </p>

      {/* Existing planners */}
      <div className="space-y-1.5">
        {planners.map((m) => {
          const isSelf = m.user_id === currentUser?.id;
          const canRemove = isOwner && !isSelf && m.role !== "Owner";
          const hasVoted = allVoterIds.has(m.user_id);
          return (
            <div key={m.user_id ?? m.memberId} className="flex items-center gap-2">
              <UserAvatar name={m.displayName} avatarUrl={null} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs" style={{ color: "var(--color-bt-text)" }}>
                  {m.displayName}
                </p>
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: hasVoted ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>
                {hasVoted ? "Voted \u2713" : "Not voted"}
              </span>
              {canRemove && (
                <button
                  onClick={() => demote.mutate({ tripId, userId: m.user_id, role: "Member" })}
                  className="flex h-5 w-5 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-bt-text-dim)" }}
                  aria-label={`Remove ${m.displayName} as planner`}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add planner — reuses CrewSearchInput with Planner default */}
      {isOwner && (
        <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
          <p className="mb-2 text-[11px] font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
            Get some help
          </p>
          <CrewSearchInput
            tripId={tripId}
            defaultRole="Planner"
            defaultStatus="draft"
            allowGhost={false}
            allowInvite
            showSearchIcon
            placeholder="Search by email..."
            frequentTripmates={[]}
          />
        </div>
      )}
    </div>
  );
}

// ── MobileCoPlannerSheet ──────────────────────────────────────────────────

function MobileCoPlannerSheet({
  tripId,
  members,
  isOwner,
  allVoterIds,
  onClose,
}: {
  tripId: string;
  members: Array<{ user_id: string; memberId: string; role: string; status: string; displayName: string }>;
  isOwner: boolean;
  allVoterIds: Set<string>;
  onClose: () => void;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();

  const planners = members.filter((m) => m.role === "Owner" || m.role === "Planner");

  const demote = trpc.tripMembers.updateRole.useMutation({
    onSuccess: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  useModalBackButton(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:hidden"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-h-[80vh] flex-col rounded-t-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1 w-8 rounded-full" style={{ background: "var(--color-bt-border)" }} />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 pb-2"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Co-planners
          </p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Planner list */}
        <div className="overflow-y-auto px-4 py-3 space-y-2">
          {planners.map((m) => {
            const isSelf = m.user_id === currentUser?.id;
            const canRemove = isOwner && !isSelf && m.role !== "Owner";
            const hasVoted = allVoterIds.has(m.user_id);
            return (
              <div key={m.user_id ?? m.memberId} className="flex items-center gap-3">
                <UserAvatar name={m.displayName} avatarUrl={null} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                    {m.displayName}
                  </p>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: hasVoted ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>
                  {hasVoted ? "Voted \u2713" : "Not voted"}
                </span>
                {canRemove && (
                  <button
                    onClick={() => demote.mutate({ tripId, userId: m.user_id, role: "Member" })}
                    className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add planner */}
          {isOwner && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
              <p className="mb-2 text-[11px] font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
                Get some help
              </p>
              <CrewSearchInput
                tripId={tripId}
                defaultRole="Planner"
                defaultStatus="draft"
                allowGhost={false}
                allowInvite
                showSearchIcon
                placeholder="Search by email..."
                frequentTripmates={[]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── IdeaZonePanel ─────────────────────────────────────────────────────────

export default function IdeaZonePanel({
  trip,
  canEdit,
  isOwner,
  onTabChange: _onTabChange,
  onOpenChat,
}: {
  trip: TripData;
  canEdit: boolean;
  isOwner: boolean;
  onTabChange?: (tab: string) => void;
  /** Opens the mobile ChatDrawer (managed in page.tsx) */
  onOpenChat?: () => void;
}) {
  const currentUser = useCurrentUser();
  const tripId = trip.id;

  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteIdea, setDeleteIdea] = useState<Idea | null>(null);
  const [setDestinationIdea, setSetDestinationIdea] = useState<Idea | null>(null);
  const [showMobileCoPlanners, setShowMobileCoPlanners] = useState(false);

  useEffect(() => {
    if (showAddModal) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [showAddModal]);

  const { data: ideas = [] } = trpc.ideas.list.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const ideasTyped = ideas as Idea[];

  // Member data for voter avatars
  const memberData = members.map((m) => ({
    memberId: m.user_id,
    displayName: m.displayName,
  }));

  // Vote mutation (lifted from VotingPanel so IdeaCards can use it)
  const utils = trpc.useUtils();
  const [votePendingId, setVotePendingId] = useState<string | null>(null);
  const voteMutation = trpc.ideas.vote.useMutation({
    async onMutate({ ideaId }) {
      setVotePendingId(ideaId);
      await utils.ideas.list.cancel({ tripId });
      const prev = utils.ideas.list.getData({ tripId });
      utils.ideas.list.setData({ tripId }, (prev ?? []).map((i) => {
        const clickingCurrentPick = i.id === ideaId && i.votes.some((v: { user_id: string }) => v.user_id === currentUser?.id);
        if (clickingCurrentPick) {
          return { ...i, votes: i.votes.filter((v: { user_id: string }) => v.user_id !== currentUser?.id) };
        }
        const withoutMe = i.votes.filter((v: { user_id: string }) => v.user_id !== currentUser?.id);
        if (i.id !== ideaId) return { ...i, votes: withoutMe };
        return { ...i, votes: [...withoutMe, { idea_id: ideaId, user_id: currentUser?.id ?? "", created_at: new Date().toISOString() }] };
      }));
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.ideas.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      setVotePendingId(null);
      utils.ideas.list.invalidate({ tripId });
    },
  });

  const handleVote = (ideaId: string) => voteMutation.mutate({ tripId, ideaId });

  // All user IDs who have voted on any idea in this trip
  const allVoterIds = new Set(ideasTyped.flatMap((i) => i.votes.map((v) => v.user_id)));

  // Number of planners/owners — used for co-planners dot indicator
  const plannerCount = members.filter(
    (m) => m.role === "owner" || m.role === "planner",
  ).length;

  if (ideasTyped.length === 0) {
    if (!canEdit) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <MapPin size={36} className="mb-4" style={{ color: "var(--color-bt-border)" }} />
          <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            No destination ideas yet
          </p>
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            Waiting for a planner to add ideas.
          </p>
        </div>
      );
    }
    return <EmptyStateOnboarding tripId={tripId} />;
  }

  // Preserve creation order — no reordering by votes (too jarring)
  const sorted = ideasTyped;

  return (
    <div>
      {/* ── Mobile layout ─────────────────────────────────────────────── */}
      <div className="lg:hidden space-y-4 p-4">
        {sorted.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            tripId={tripId}
            canEdit={canEdit}
            isOwner={isOwner}
            tripStartDate={trip.start_date}
            currentUserId={currentUser?.id}
            memberData={memberData}
            onVote={handleVote}
            votePending={votePendingId === idea.id}
            onSetDestination={setSetDestinationIdea}
            onDelete={setDeleteIdea}
          />
        ))}

      </div>

      {/* ── Desktop layout ────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:gap-6 lg:p-4">
        {/* Left: idea cards */}
        <div className="flex flex-1 min-w-0 flex-col gap-4">
          {sorted.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              tripId={tripId}
              canEdit={canEdit}
              isOwner={isOwner}
              tripStartDate={trip.start_date}
              currentUserId={currentUser?.id}
              memberData={memberData}
              onVote={handleVote}
              votePending={votePendingId === idea.id}
              onSetDestination={setSetDestinationIdea}
              onDelete={setDeleteIdea}
            />
          ))}
        </div>

        {/* Right: sidebar */}
        <div className="w-[320px] flex-shrink-0 sticky top-4 self-start space-y-3">
          <div className="hidden lg:block">
            <StageContextBar tripId={tripId} stage="idea" displayStatus="idea" isOwner={isOwner} />
          </div>
          {canEdit && (
            <button
              data-testid="add-idea-btn"
              onClick={() => setShowAddModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                border: "1.5px dashed var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
              }}
            >
              <Plus size={16} />
              <MapPin size={15} />
              Add destination idea
            </button>
          )}

          <CoPlannerPanel
            tripId={tripId}
            members={members as Array<{ user_id: string; memberId: string; role: string; status: string; displayName: string }>}
            isOwner={isOwner}
            allVoterIds={allVoterIds}
          />

          <SidebarChatPanel
            tripId={tripId}
            memberNames={Object.fromEntries(
              members.map((m) => [m.memberId, m.displayName])
            )}
          />
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddIdeasModal tripId={tripId} onClose={() => setShowAddModal(false)} />
      )}
      {deleteIdea && (
        <DeleteConfirmModal
          tripId={tripId}
          idea={deleteIdea}
          onClose={() => setDeleteIdea(null)}
        />
      )}
      {setDestinationIdea && (
        <SetDestinationSheet
          tripId={tripId}
          idea={setDestinationIdea}
          onClose={() => setSetDestinationIdea(null)}
        />
      )}

      {/* ── Mobile FAB unified pill (IDEA stage) ────────────────────── */}
      <div
        className="fixed right-3 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center lg:hidden"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          borderRadius: "1rem",
          boxShadow: "var(--shadow-floating)",
          width: "3rem",
        }}
      >
        {canEdit ? (
          <>
            {/* Add idea — top */}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex h-12 w-12 items-center justify-center gap-0.5 transition-colors active:scale-95"
              style={{ borderRadius: "1rem 1rem 0 0" }}
              aria-label="Add destination idea"
            >
              <Plus size={13} style={{ color: "var(--color-bt-accent)" }} />
              <MapPin size={13} style={{ color: "var(--color-bt-accent)" }} />
            </button>

            <div className="w-8" style={{ height: "1px", background: "var(--color-bt-border)" }} />
          </>
        ) : null}

        {/* Chat */}
        <button
          onClick={onOpenChat}
          data-testid="floating-chat-btn"
          className="flex h-12 w-12 items-center justify-center transition-colors active:scale-95"
          style={{ borderRadius: canEdit ? "0" : "1rem 1rem 0 0" }}
          aria-label="Open crew chat"
        >
          <MessageCircle size={18} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>

        <div className="w-8" style={{ height: "1px", background: "var(--color-bt-border)" }} />

        {/* Crew / co-planners — bottom */}
        <button
          onClick={() => setShowMobileCoPlanners(true)}
          className="relative flex h-12 w-12 items-center justify-center transition-colors active:scale-95"
          style={{ borderRadius: "0 0 1rem 1rem" }}
          aria-label="View co-planners"
        >
          <Users size={18} style={{ color: "var(--color-bt-text-dim)" }} />
          {plannerCount > 1 && (
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-full"
              style={{ background: "var(--color-bt-accent)" }}
            />
          )}
        </button>
      </div>

      {/* ── Mobile co-planners bottom sheet ──────────────────────────── */}
      {showMobileCoPlanners && (
        <MobileCoPlannerSheet
          tripId={tripId}
          members={members as Array<{ user_id: string; memberId: string; role: string; status: string; displayName: string }>}
          isOwner={isOwner}
          allVoterIds={allVoterIds}
          onClose={() => setShowMobileCoPlanners(false)}
        />
      )}
    </div>
  );
}
