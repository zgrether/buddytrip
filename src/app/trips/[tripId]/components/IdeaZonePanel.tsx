"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Avatar } from "@/components/Avatar";
import {
  ThumbsUp,
  MapPin,
  Star,
  Flag,
  Zap,
  X,
  Loader2,
  Trash2,
  Check,
  Plus,
  Pencil,
  ExternalLink,
  LayoutGrid,
  Columns2,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { temporalGradient } from "@/lib/temporalGradient";
import { CatalogBrowser } from "./CatalogBrowser";
import { ArchivedIdeasBrowser, type ArchivedIdea } from "./ArchivedIdeasBrowser";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import { AddPropertySheet, detectPlatform, extractDomain, isValidUrl, type PropertyFormValues } from "./AddPropertySheet";
import { PlannersPanel } from "@/app/trips/[tripId]/tabs/components/PlannersPanel";
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
  notes?: string | null;
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
  memberData: { memberId: string; displayName: string; avatar_icon?: string | null }[];
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
  const [deletingLodgingId, setDeletingLodgingId] = useState<string | null>(null);

  const { data: lodgingOptions = [] } = trpc.ideaLodging.list.useQuery(
    { ideaId: idea.id },
    { staleTime: 30_000 }
  );

  const createLodging = trpc.ideaLodging.create.useMutation({
    onSuccess: () => { utils.ideaLodging.list.invalidate({ ideaId: idea.id }); setShowAddLodging(false); },
  });

  const updateLodging = trpc.ideaLodging.update.useMutation({
    onSuccess: () => { utils.ideaLodging.list.invalidate({ ideaId: idea.id }); setEditingLodging(null); },
  });

  const removeLodging = trpc.ideaLodging.remove.useMutation({
    onSuccess: () => {
      utils.ideaLodging.list.invalidate({ ideaId: idea.id });
      setDeletingLodgingId(null);
    },
    onError: () => setDeletingLodgingId(null),
  });

  const toIdeaSource = (platform: ReturnType<typeof detectPlatform>) =>
    platform === "rental" ? "other" as const : platform;

  const handleLodgingCreate = (values: PropertyFormValues) => {
    const trimmedUrl = values.url.trim() || undefined;
    const sleepsNum = values.sleeps.trim() ? parseInt(values.sleeps.trim(), 10) : undefined;
    createLodging.mutate({
      ideaId: idea.id,
      tripId,
      name: values.name.trim() || (trimmedUrl ? extractDomain(trimmedUrl) : "Property"),
      source: trimmedUrl ? toIdeaSource(detectPlatform(trimmedUrl)) : undefined,
      sleeps: sleepsNum,
      priceNote: values.price.trim() || undefined,
      url: trimmedUrl,
      notes: values.notes.trim() || undefined,
    });
  };

  const handleLodgingUpdate = (values: PropertyFormValues) => {
    if (!editingLodging) return;
    const trimmedUrl = values.url.trim() || undefined;
    const sleepsNum = values.sleeps.trim() ? parseInt(values.sleeps.trim(), 10) : undefined;
    updateLodging.mutate({
      id: editingLodging.id,
      tripId,
      name: values.name.trim() || (trimmedUrl ? extractDomain(trimmedUrl) : "Property"),
      source: trimmedUrl ? toIdeaSource(detectPlatform(trimmedUrl)) : null,
      sleeps: sleepsNum ?? null,
      priceNote: values.price.trim() || null,
      url: trimmedUrl ?? null,
      notes: values.notes.trim() || null,
    });
  };

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
      className="overflow-hidden rounded-2xl transition-shadow flex flex-col"
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
                      <Avatar name={name} avatarIcon={member?.avatar_icon ?? null} sizePx={20} />
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
      <div className="flex flex-col flex-1" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
        <div className="flex flex-col flex-1 gap-4 p-4">
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
            {/* Header row: LODGING IDEAS label + inline Add (only when options exist) */}
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Lodging Ideas
              </p>
              {canEdit && lodgingOptions.length > 0 && (
                <button
                  data-testid={`add-lodging-empty-${idea.id}`}
                  onClick={() => setShowAddLodging(true)}
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  <Plus size={13} /> Add
                </button>
              )}
            </div>

            {/* Empty state: full-width Add button below header */}
            {canEdit && lodgingOptions.length === 0 && (
              <button
                data-testid={`add-lodging-empty-${idea.id}`}
                onClick={() => setShowAddLodging(true)}
                className="mb-1.5 flex items-center gap-1 text-xs"
                style={{ color: "var(--color-bt-accent)" }}
              >
                <Plus size={13} /> Add a property
              </button>
            )}

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {lodgingOptions.map((opt) => {
                const platformLabel: Record<string, string> = {
                  airbnb: "AirBnB", vrbo: "VRBO", hotel: "Hotel", other: "Listing",
                };
                const linkLabel = opt.source ? (platformLabel[opt.source] ?? "Listing") : "Listing";
                return (
                  <div
                    key={opt.id}
                    className="rounded-xl px-3 py-2.5"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    {/* Name + edit/delete */}
                    <div className="flex items-start justify-between gap-1">
                      <p className="min-w-0 flex-1 text-[13px] font-medium leading-tight" style={{ color: "var(--color-bt-text)" }}>
                        {opt.name}
                      </p>
                      {canEdit && (
                        <div className="flex flex-shrink-0 items-center gap-0.5">
                          <button
                            onClick={() => setEditingLodging(opt as IdeaLodgingOption)}
                            className="flex h-5 w-5 items-center justify-center rounded"
                            aria-label="Edit"
                          >
                            <Pencil size={11} style={{ color: "var(--color-bt-text-dim)" }} />
                          </button>
                          <button
                            onClick={() => { setDeletingLodgingId(opt.id); removeLodging.mutate({ id: opt.id, tripId: idea.trip_id }); }}
                            disabled={deletingLodgingId === opt.id}
                            className="flex h-5 w-5 items-center justify-center rounded disabled:opacity-40"
                            aria-label="Delete"
                          >
                            <Trash2 size={11} style={{ color: "var(--color-bt-text-dim)" }} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Sleeps (left) · Price (right) */}
                    {(opt.sleeps != null || opt.price_note) && (
                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        {opt.sleeps != null ? (
                          <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                            Sleeps {opt.sleeps}
                          </span>
                        ) : <span />}
                        {opt.price_note && (
                          <span className="flex-shrink-0 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                            {opt.price_note}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Thoughts */}
                    {opt.notes && (
                      <p className="mt-1 text-[11px] italic leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                        {opt.notes}
                      </p>
                    )}

                    {/* → Platform link */}
                    {opt.url && (
                      <a
                        href={opt.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
                        style={{ color: "var(--color-bt-accent)" }}
                      >
                        <ExternalLink size={10} />
                        {linkLabel}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
          {showAddLodging && (
            <AddPropertySheet
              isPending={createLodging.isPending}
              onSubmit={handleLodgingCreate}
              onClose={() => setShowAddLodging(false)}
            />
          )}
          {editingLodging && (
            <AddPropertySheet
              isEditing
              initialValues={{
                url: editingLodging.url ?? "",
                name: editingLodging.name ?? "",
                sleeps: editingLodging.sleeps != null ? String(editingLodging.sleeps) : "",
                price: editingLodging.price_note ?? "",
                notes: editingLodging.notes ?? "",
                address: "",
                checkIn: "",
                checkOut: "",
              }}
              isPending={updateLodging.isPending}
              onSubmit={handleLodgingUpdate}
              onClose={() => setEditingLodging(null)}
            />
          )}

          {/* Footer actions — owner only (set destination + remove) */}
          {isOwner && (
            <div
              className="flex items-center justify-between pt-3 mt-auto"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              <button
                data-testid={`set-destination-${idea.id}`}
                onClick={() => onSetDestination(idea)}
                className="text-sm font-medium transition-opacity hover:opacity-70"
                style={{ color: "var(--color-bt-accent)" }}
              >
                Set as destination
              </button>
              <button
                data-testid={`remove-idea-${idea.id}`}
                onClick={() => onDelete(idea)}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RemoveIdeaModal ──────────────────────────────────────────────────────
//
// Owners can either permanently delete an idea or archive it for reuse on a
// future trip. Archiving snapshots the idea into `archived_ideas` (scoped to
// the current user) and then removes it from the trip, which matches the
// user-visible behavior of plain delete — the idea disappears from the trip
// either way.

function RemoveIdeaModal({
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
  const removeIdea = trpc.ideas.remove.useMutation();
  const archiveIdea = trpc.archivedIdeas.archive.useMutation();

  const isPending = removeIdea.isPending || archiveIdea.isPending;

  const handleDelete = async () => {
    await removeIdea.mutateAsync({ tripId, ideaId: idea.id });
    await Promise.all([
      utils.ideas.list.invalidate({ tripId }),
    ]);
    onClose();
  };

  const handleArchive = async () => {
    // Archive-then-remove: snapshot first so we don't lose the row if the
    // delete succeeds but archiving fails.
    await archiveIdea.mutateAsync({ tripId, ideaId: idea.id });
    await removeIdea.mutateAsync({ tripId, ideaId: idea.id });
    await Promise.all([
      utils.ideas.list.invalidate({ tripId }),
      utils.archivedIdeas.list.invalidate(),
    ]);
    onClose();
  };

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
          Delete it permanently, or archive it so you can reuse it when planning a future trip.
        </p>
        <div className="flex flex-col gap-2">
          <button
            data-testid="archive-idea-btn"
            disabled={isPending}
            onClick={handleArchive}
            className="rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {archiveIdea.isPending ? "Archiving..." : "Archive for future trips"}
          </button>
          <button
            data-testid="confirm-remove-idea-btn"
            disabled={isPending}
            onClick={handleDelete}
            className="rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--color-bt-danger)", color: "#fff" }}
          >
            {removeIdea.isPending && !archiveIdea.isPending ? "Removing..." : "Delete permanently"}
          </button>
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border py-2.5 text-sm disabled:opacity-40"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LocalIdea ─────────────────────────────────────────────────────────────

export interface LocalIdea {
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

/**
 * The Add-Destination-Ideas screen. Works in two modes:
 *  - Existing trip (default): takes `tripId` and writes each staged idea via
 *    `ideas.create`, then invalidates `ideas.list`.
 *  - Trip-less (new-trip flow): pass `onSubmit` — the component won't call
 *    any mutations; it hands the staged list back to the parent which owns
 *    trip creation + navigation. `tripId` may be omitted in this mode.
 */
export function EmptyStateOnboarding({
  tripId,
  onClose,
  onSubmit,
  className,
  submitDisabled,
}: {
  tripId?: string;
  onClose?: () => void;
  onSubmit?: (ideas: LocalIdea[]) => Promise<void> | void;
  /** Override the default standalone wrapper (`mx-auto max-w-[896px] px-4 py-8`). */
  className?: string;
  /** When true, the final "Start comparing / Add to comparison" button is
   *  disabled even if there are staged ideas. Used by the new-trip flow to
   *  block submission until the parent trip name is entered. */
  submitDisabled?: boolean;
}) {
  const utils = trpc.useUtils();

  const [localIdeas, setLocalIdeas] = useState<LocalIdea[]>([]);
  const [titleInput, setTitleInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  // Archive-staged IDs are tracked as `arch-<archiveRowId>` (matching the
  // convention catalog uses — `cat-<catalogId>`). Same Set drives both the
  // tile checkmark and the "already staged" guard.
  const [stagedArchivedIds, setStagedArchivedIds] = useState<Set<string>>(new Set());

  const createIdea = trpc.ideas.create.useMutation();

  const handleAddManual = () => {
    const title = titleInput.trim();
    const location = locationInput.trim();
    if (!title) return;
    setLocalIdeas((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title, location: location || title, source: "manual" },
    ]);
    setTitleInput("");
    setLocationInput("");
  };

  const handleRemoveStaged = (id: string) => {
    setLocalIdeas((prev) => prev.filter((i) => i.id !== id));
    if (id.startsWith("cat-")) {
      const catalogId = id.slice(4);
      setSelectedCatalogIds((prev) => {
        const s = new Set(prev);
        s.delete(catalogId);
        return s;
      });
    }
    if (id.startsWith("arch-")) {
      setStagedArchivedIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
    }
  };

  const handleArchivedSelect = (archived: ArchivedIdea) => {
    const stagedId = `arch-${archived.id}`;
    const alreadyStaged = localIdeas.some((i) => i.id === stagedId);
    if (alreadyStaged) {
      setLocalIdeas((prev) => prev.filter((i) => i.id !== stagedId));
      setStagedArchivedIds((prev) => {
        const s = new Set(prev);
        s.delete(stagedId);
        return s;
      });
    } else {
      // Importing is a copy — per product spec, archiving creates a
      // personal snapshot and import clones it into the new trip. The
      // original archive row stays intact so the user can reuse it on
      // future trips too.
      setLocalIdeas((prev) => [
        ...prev,
        {
          id: stagedId,
          title: archived.title,
          location: archived.location,
          description: archived.description,
          costTier: archived.cost_tier ?? undefined,
          source: "manual" as const,
          imageUrl: archived.image_url ?? undefined,
          golfCourses: archived.golf_courses?.length ? archived.golf_courses : undefined,
          activities: archived.activities?.length ? archived.activities : undefined,
          accommodation: archived.accommodation ?? undefined,
          tips: archived.notes ?? undefined,
        },
      ]);
      setStagedArchivedIds((prev) => new Set([...prev, stagedId]));
    }
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

  const handleCompare = async () => {
    if (localIdeas.length === 0) return;
    setIsSubmitting(true);
    try {
      // Trip-less mode — hand off the staged list; parent owns trip creation,
      // idea writes, and navigation. No mutations from here.
      if (onSubmit) {
        await onSubmit(localIdeas);
        return;
      }
      if (!tripId) {
        throw new Error("EmptyStateOnboarding: tripId required when onSubmit is not provided");
      }
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
      // Await the refetch before clearing local state. Otherwise the parent's
      // `ideas.list` query is still returning the stale empty array while we
      // unmount the staged list, which flashes the empty-state onboarding for
      // a moment before the populated idea-phase view takes over.
      await utils.ideas.list.invalidate({ tripId });
      setLocalIdeas([]);
      onClose?.();
    } catch (err) {
      console.error("Failed to save ideas:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={className ?? "mx-auto max-w-[896px] px-4 py-8"}>
      <h2 className="mb-1 text-lg font-bold" style={{ color: "var(--color-bt-text)" }}>
        Add Destination Ideas
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
        Add options from the catalog or enter your own, compare them side by side, and let the crew pick their favorite.
      </p>

      {/* ── 1. Manual entry — single row: [Name] [Location] [Add]. Labels
             sit above the inputs; the Add button aligns with the inputs
             so the whole form collapses to a single functional line. ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0">
          <label
            htmlFor="manual-title"
            className="mb-1.5 block text-xs font-medium"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Name
          </label>
          <input
            id="manual-title"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAddManual(); }
            }}
            placeholder="Trip Down Magnolia Lane"
            maxLength={500}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
            style={{
              background: "var(--color-bt-card)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <label
            htmlFor="manual-location"
            className="mb-1.5 block text-xs font-medium"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Location
          </label>
          <input
            id="manual-location"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAddManual(); }
            }}
            placeholder="Augusta, GA"
            maxLength={500}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-1"
            style={{
              background: "var(--color-bt-card)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>
        <button
          onClick={handleAddManual}
          disabled={!titleInput.trim() || !locationInput.trim()}
          className="rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          Add
        </button>
      </div>

      {/* ── 2. Staged ideas — full-width 2-col grid below the form so
             entries fill right-then-down. The columns match the form's
             default full-width sizing. ── */}
      {localIdeas.length > 0 && (
        <div className="mt-5">
          <p
            className="mb-1.5 text-xs font-medium"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Your ideas
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {localIdeas.map((idea) => (
              <li
                key={idea.id}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                style={{
                  background: "var(--color-bt-card)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                {idea.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={idea.imageUrl}
                    alt=""
                    className="h-8 w-8 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded"
                    style={{ background: "var(--color-bt-dim-faint)" }}
                  >
                    <MapPin size={14} style={{ color: "var(--color-bt-text-dim)" }} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {idea.title}
                  </p>
                  {idea.location && idea.location !== idea.title && (
                    <p
                      className="truncate text-[11px]"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      {idea.location}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveStaged(idea.id)}
                  className="flex-shrink-0 rounded p-1 transition-opacity hover:opacity-70"
                  aria-label={`Remove ${idea.title}`}
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>

          {/* Compare / confirm button — lives right under the staged list. */}
          <button
            onClick={handleCompare}
            disabled={isSubmitting || submitDisabled}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {isSubmitting ? (
              <><Loader2 size={16} className="animate-spin" /> Saving...</>
            ) : onClose ? (
              <>Add to comparison</>
            ) : (
              <>Start comparing &rarr;</>
            )}
          </button>
        </div>
      )}

      {/* ── 2. My archived ideas — rendered only when the user has any.
             Sits between their own staged list and the shared catalog so
             the personal archive is the first reuse source they see. ── */}
      <div className="mt-6">
        <ArchivedIdeasBrowser
          onSelect={handleArchivedSelect}
          selectedIds={stagedArchivedIds}
        />
      </div>

      {/* ── 3. Catalog browser — renders its own "Destination catalog"
             header inline with the filter pill (right-justified). ── */}
      <div className="mt-6">
        <CatalogBrowser
          title="Destination catalog"
          onSelect={handleCatalogSelect}
          selectedIds={selectedCatalogIds}
        />
      </div>
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
          className="relative flex w-full max-h-[90vh] flex-col rounded-t-2xl overflow-hidden"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2 shrink-0">
            <div className="h-1 w-8 rounded-full" style={{ background: "var(--color-bt-border)" }} />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
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
          className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
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

  // All other ideas on this trip — candidates to archive alongside the
  // destination lock. The winning idea itself is filtered out.
  const { data: allIdeas = [] } = trpc.ideas.list.useQuery({ tripId });
  const otherIdeas = allIdeas.filter((i) => i.id !== idea.id);

  // Default: all options checked
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(lodgingOptions.map((o) => o.id))
  );

  // Archive candidates — default all checked when they first load, matching
  // the "opt-out" pattern used by lodging carry-over above.
  const [archiveIds, setArchiveIds] = useState<Set<string>>(new Set());
  const [archiveInitialised, setArchiveInitialised] = useState(false);
  if (!archiveInitialised && otherIdeas.length > 0) {
    setArchiveIds(new Set(otherIdeas.map((i) => i.id)));
    setArchiveInitialised(true);
  }

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
  const archiveIdea = trpc.archivedIdeas.archive.useMutation();

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

  const toggleArchive = (id: string) => {
    setArchiveIds((prev) => {
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

      // 3. Archive losing ideas the owner chose to keep for future trips.
      //    Best-effort: a failed archive doesn't block the stage advance —
      //    the losing ideas just won't appear in the archive (they remain
      //    on the trip, which is the safer default).
      const toArchive = otherIdeas.filter((i) => archiveIds.has(i.id));
      if (toArchive.length > 0) {
        await Promise.allSettled(
          toArchive.map((i) =>
            archiveIdea.mutateAsync({ tripId, ideaId: i.id })
          )
        );
      }

      // 4. Advance to planning
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
      utils.archivedIdeas.list.invalidate();
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

        {/* Archive-other-ideas section — same opt-out pattern as lodging
            carry-over below. Rendered first because archiving is about the
            trip-level ideas the owner is leaving behind, while lodging is
            about what rides along to Planning. */}
        {otherIdeas.length > 0 && (
          <>
            <div className="my-4" style={{ borderTop: "1px solid var(--color-bt-border)" }} />
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Archive Ideas
            </p>
            <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Save these for a future trip?
            </p>
            <div className="space-y-2 mb-3">
              {otherIdeas.map((other) => {
                const isChecked = archiveIds.has(other.id);
                return (
                  <button
                    key={other.id}
                    type="button"
                    onClick={() => toggleArchive(other.id)}
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
                        {other.title}
                      </p>
                      {other.location && other.location !== other.title && (
                        <p className="truncate text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                          {other.location}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mb-4 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
              Checked ideas will be saved to your personal archive for future trips.
            </p>
          </>
        )}

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

export function CoPlannerPanel({
  tripId,
  members,
  isOwner,
  allVoterIds,
}: {
  tripId: string;
  members: Array<{ user_id: string; memberId: string; role: string; status: string; displayName: string; user?: { avatar_icon?: string | null } | null }>;
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
      className="rounded-xl border px-3 py-3"
      style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Planners
      </p>

      {/* Existing planners */}
      <div className="space-y-1.5">
        {planners.map((m) => {
          const isSelf = m.user_id === currentUser?.id;
          const canRemove = isOwner && !isSelf && m.role !== "Owner";
          const hasVoted = allVoterIds.has(m.user_id);
          return (
            <div key={m.user_id ?? m.memberId} className="flex items-center gap-2">
              <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="sm" />
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
                  aria-label={`Remove ${m.displayName} as organizer`}
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
  members: Array<{ user_id: string; memberId: string; role: string; status: string; displayName: string; user?: { avatar_icon?: string | null } | null }>;
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
            Planners
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
                <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="sm" />
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
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AddIdeaCard ───────────────────────────────────────────────────────────

function AddIdeaCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-testid="add-idea-btn"
      onClick={onClick}
      className="rounded-xl flex flex-col items-center justify-center gap-2.5 cursor-pointer min-h-[180px] p-6 text-center transition-colors"
      style={{
        border: "1.5px dashed var(--color-bt-border)",
        background: "rgba(255,255,255,0.02)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--color-bt-accent)";
        e.currentTarget.style.background = "var(--color-bt-accent-faint)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-bt-border)";
        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        <Plus size={18} style={{ color: "var(--color-bt-text-dim)" }} />
      </div>
      <p className="text-sm font-bold" style={{ color: "var(--color-bt-text-dim)" }}>
        Add destination idea
      </p>
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)", lineHeight: 1.4 }}>
        From the catalog or enter your own
      </p>
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
  /** Opens the FloatingChatPanel (managed in page.tsx) */
  onOpenChat?: () => void;
}) {
  const currentUser = useCurrentUser();
  const tripId = trip.id;

  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteIdea, setDeleteIdea] = useState<Idea | null>(null);
  const [setDestinationIdea, setSetDestinationIdea] = useState<Idea | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`planners-collapsed-${tripId}`) === "true";
  });
  const [isCompact, setIsCompact] = useState(false);

  const handleToggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem(`planners-collapsed-${tripId}`, String(next));
  };

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
    avatar_icon: (m as { user?: { avatar_icon?: string | null } | null }).user?.avatar_icon ?? null,
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

  // Planners list for PlannersPanel
  const plannersList = members
    .filter((m) => m.role.toLowerCase() === "owner" || m.role.toLowerCase() === "planner")
    .map((m) => ({
      userId: m.user_id,
      name: m.displayName,
      avatarIcon: (m as { user?: { avatar_icon?: string | null } | null }).user?.avatar_icon ?? null,
      email: (m as { user?: { email?: string | null } | null }).user?.email ?? null,
      role: m.role.toLowerCase() as "owner" | "planner",
      hasVoted: allVoterIds.has(m.user_id),
      isMe: m.user_id === currentUser?.id,
      isGuest: !!(m as { isGuest?: boolean }).isGuest,
    }));

  if (ideasTyped.length === 0) {
    if (!isOwner) {
      const ownerName =
        members.find((m) => m.role === "owner")?.displayName ?? "The owner";
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <MapPin size={36} className="mb-4" style={{ color: "var(--color-bt-border)" }} />
          <p className="mb-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            No destination ideas yet
          </p>
          <p className="max-w-xs text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {ownerName} is going to add some ideas for you all to discuss — check back later.
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
      {/* ── Single column layout ──────────────────────────────────────── */}
      <div className="px-4 py-4 space-y-4">
        {/* Planners panel — top of column */}
        <div className="max-w-2xl">
          <PlannersPanel
            tripId={tripId}
            planners={plannersList}
            isOwner={isOwner}
            canEdit={canEdit}
            isCollapsed={isCollapsed}
            onToggleCollapse={handleToggleCollapse}
          />
        </div>

        {/* Section header */}
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Destination Ideas
        </h2>

        {/* Orientation copy + view toggle */}
        <div className="flex items-center gap-3">
          <p
            className="flex-1 text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Add your top contenders from the catalog or enter your own — compare
            them side by side, then let the crew weigh in.
          </p>
          <button
            onClick={() => setIsCompact((c) => !c)}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--color-bt-border)",
              background: isCompact ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
              color: isCompact ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            aria-label={isCompact ? "Switch to wide view" : "Switch to compact view"}
          >
            {isCompact ? <Columns2 size={14} /> : <LayoutGrid size={14} />}
          </button>
        </div>

        {/* Destination cards + add card grid */}
        <div className={`grid gap-3.5 ${isCompact ? "grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))]" : "grid-cols-[repeat(auto-fill,minmax(min(100%,480px),1fr))]"}`}>
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
          {isOwner && <AddIdeaCard onClick={() => setShowAddModal(true)} />}
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddIdeasModal tripId={tripId} onClose={() => setShowAddModal(false)} />
      )}
      {deleteIdea && (
        <RemoveIdeaModal
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

    </div>
  );
}
