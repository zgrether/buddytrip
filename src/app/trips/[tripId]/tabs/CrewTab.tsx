"use client";

import { useRef, useState } from "react";
import { Ghost, GripVertical, Mail, X, Crown, ChevronDown, Plus, Trash2, Users } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { TabProps } from "./types";
import { CrewEmailPanel } from "./components/CrewEmailPanel";

const ROLE_ORDER: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };

// ── Member type ───────────────────────────────────────────────────────────

type Member = {
  memberId: string;
  user_id: string | null;
  role: string;
  status: string | null;
  displayName: string;
  isGuest: boolean;
  user: { email: string | null; is_guest?: boolean } | null;
};

// ── CrewMemberRow ─────────────────────────────────────────────────────────

function CrewMemberRow({
  member: m,
  tripId,
  isOwnerView,
  isMe,
  isExpanded,
  isPlannerSection,
  hidePlannerBadge,
  draggable,
  onDragStart,
  onToggle,
  onUpdated,
  onUpdateRole,
}: {
  member: Member;
  tripId: string;
  isOwnerView: boolean;
  isMe: boolean;
  isExpanded: boolean;
  isPlannerSection?: boolean;
  /** Member view hides Planner badges — Owner badge still surfaces. */
  hidePlannerBadge?: boolean;
  /** True for rows that can be dragged between Planners / Crew columns. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onToggle: () => void;
  onUpdated: () => void;
  /** Hoisted to CrewTab so drag-drop and buttons share one optimistic mutation. */
  onUpdateRole?: (userId: string, role: "Planner" | "Member") => void;
}) {
  const utils = trpc.useUtils();
  const [editEmail, setEditEmail] = useState(m.user?.email ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); onUpdated(); },
  });
  const removeGuest = trpc.ghostCrew.remove.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); onUpdated(); },
  });
  const updateGuest = trpc.ghostCrew.update.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); },
  });

  const display = m.displayName;
  const isOwnerRow = m.role === "Owner";
  const isPlannerRow = m.role === "Planner";
  // Any real BT account — Owner, Planner, or Member — gets a faint teal
  // tint to separate them from guests at a glance.
  const isBTMember = !m.isGuest;
  // Owner is the only role that can expand/edit rows. Owner can never
  // expand themselves or the Owner row of the trip.
  const expandable = isOwnerView && !isMe && !isOwnerRow;
  const canActOnPlanner = isOwnerView && !isMe && isPlannerRow;
  const canPromoteToCoplanner = isOwnerView && !isMe && m.role === "Member" && !!m.user?.email;
  const hasTextChanges = editEmail.trim() !== (m.user?.email ?? "");

  const handleSave = async () => {
    if (m.isGuest && m.user_id && hasTextChanges) {
      await updateGuest.mutateAsync({
        tripId,
        guestUserId: m.user_id,
        email: editEmail.trim() || null,
      });
    }
    onToggle();
    onUpdated();
  };

  const handleRemove = () => {
    if (!m.user_id) return;
    if (m.isGuest) removeGuest.mutate({ tripId, guestUserId: m.user_id });
    else removeMember.mutate({ tripId, userId: m.user_id });
  };

  return (
    <div
      className="border-b last:border-b-0"
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      style={{
        borderColor: "var(--color-bt-border)",
        background: isExpanded
          ? "var(--color-bt-card-raised)"
          : isBTMember
            ? "color-mix(in srgb, var(--color-bt-accent) 5%, transparent)"
            : undefined,
        cursor: draggable ? "grab" : undefined,
      }}
    >
      {/* ── Main row (tappable when expandable) ────────────────────────── */}
      <div
        className="flex items-center gap-3 py-2.5 px-3"
        style={{ cursor: expandable ? "pointer" : draggable ? "grab" : undefined }}
        onClick={expandable ? onToggle : undefined}
      >
        {/* Grip handle — only on draggable owner-view rows */}
        {draggable && isOwnerView && (
          <GripVertical
            size={14}
            className="flex-shrink-0"
            style={{ color: "var(--color-bt-text-dim)" }}
          />
        )}
        {/* Avatar */}
        {m.isGuest ? (
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            <Ghost size={14} />
          </div>
        ) : (
          <UserAvatar name={display} avatarUrl={null} size="md" />
        )}

        {/* Name + email */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {display}
            {isMe && (
              <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>(you)</span>
            )}
          </p>
          {m.user?.email ? (
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {m.user.email}
            </p>
          ) : m.isGuest ? (
            <p className="truncate text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
              tap to add email
            </p>
          ) : null}
        </div>

        {/* ── Right side: badges + chevron ─────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Owner badge */}
          {isOwnerRow && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: "color-mix(in srgb, var(--color-bt-warning) 15%, transparent)",
                color: "var(--color-bt-warning)",
                border: "1px solid color-mix(in srgb, var(--color-bt-warning) 30%, transparent)",
              }}
            >
              <Crown size={10} />
              Owner
            </span>
          )}

          {/* Planner badge / Planner × button */}
          {isPlannerRow && !hidePlannerBadge && (
            canActOnPlanner ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (m.user_id) onUpdateRole?.(m.user_id, "Member"); }}
                aria-label={`Remove ${display} as planner`}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40 hover:opacity-75 transition-opacity"
                style={{
                  background: "var(--color-bt-accent-faint)",
                  color: "var(--color-bt-accent)",
                  border: "1px solid var(--color-bt-accent-border)",
                }}
              >
                Planner
                <X size={10} strokeWidth={2.5} />
              </button>
            ) : (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: "var(--color-bt-accent-faint)",
                  color: "var(--color-bt-accent)",
                  border: "1px solid var(--color-bt-accent-border)",
                }}
              >
                Planner
              </span>
            )
          )}

          {/* Make-planner button — owner only, member rows with email */}
          {canPromoteToCoplanner && (
            <button
              onClick={(e) => { e.stopPropagation(); if (m.user_id) onUpdateRole?.(m.user_id, "Planner"); }}
              className="rounded-lg px-2 py-1 text-xs disabled:opacity-40"
              style={{ color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
            >
              Make planner
            </button>
          )}

          {/* Chevron — only on expandable rows */}
          {expandable && (
            <ChevronDown
              size={16}
              className="transition-transform duration-150"
              style={{
                color: "var(--color-bt-text-dim)",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          )}
        </div>
      </div>

      {/* ── Expanded panel ───────────────────────────────────────────────── */}
      {/* Indented under the name column: an empty cell mirrors the avatar +
          gap so the inputs align with the name above. */}
      {isExpanded && expandable && (
        <div className="flex gap-3 px-3 pb-3">
          <div className="w-8 flex-shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 space-y-3">
          {/* Email — guest crew only. To change a guest's name, remove and
              re-add them. */}
          {m.isGuest && !isPlannerSection && (
            <div>
              <label
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Email
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && hasTextChanges && !updateGuest.isPending) {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  placeholder={`${m.displayName.toLowerCase()}@example.com`}
                  type="email"
                  className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                />
                <button
                  onClick={handleSave}
                  disabled={!hasTextChanges || updateGuest.isPending}
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Remove from trip */}
          <div className="flex items-center gap-2">
            {confirmRemove ? (
              <>
                <span className="text-xs font-medium" style={{ color: "var(--color-bt-danger)" }}>
                  Remove {display}?
                </span>
                <button
                  onClick={handleRemove}
                  disabled={removeMember.isPending || removeGuest.isPending}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                  style={{ background: "var(--color-bt-danger)", color: "white" }}
                >
                  Yes, remove
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  className="rounded-lg border px-2.5 py-1 text-xs"
                  style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmRemove(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium"
                style={{ color: "var(--color-bt-danger)", border: "1px solid var(--color-bt-danger)", opacity: 0.75 }}
              >
                <Trash2 size={12} />
                Remove {display} from trip
              </button>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

// Drag-and-drop key for crew role reassignment
const DND_CREW_KEY = "application/x-buddytrip-crew-user-id";

export function CrewTab({ trip, canEdit, embedded }: TabProps & { embedded?: boolean }) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const tripId = trip.id;
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberName, setAddMemberName] = useState("");
  const [plannersDragOver, setPlannersDragOver] = useState(false);
  const [crewDragOver, setCrewDragOver] = useState(false);
  const dragSource = useRef<{ userId: string; role: string } | null>(null);

  const createGuest = trpc.ghostCrew.create.useMutation({
    onSuccess() {
      setAddMemberName("");
      setShowAddMember(false);
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  // Hoisted updateRole — shared by drag-drop and the inline buttons in
  // CrewMemberRow. Optimistic so the member chip jumps columns instantly.
  const updateRole = trpc.tripMembers.updateRole.useMutation({
    onMutate: async (vars) => {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData({ tripId }, (old) =>
        (old ?? []).map((m) =>
          m.user_id === vars.userId ? { ...m, role: vars.role } : m
        )
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.tripMembers.list.setData({ tripId }, ctx.prev);
    },
    onSettled: () => utils.tripMembers.list.invalidate({ tripId }),
  });

  const handleUpdateRole = (userId: string, role: "Planner" | "Member") =>
    updateRole.mutate({ tripId, userId, role });

  const me = members.find((m) => m.user_id === currentUser?.id);
  const isOwner = me?.role === "Owner";
  const sorted = [...members].sort((a, b) => {
    const aOrder = ROLE_ORDER[a.role] ?? 2;
    const bOrder = ROLE_ORDER[b.role] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });

  const plannersSorted = sorted.filter((m) => m.role === "Owner" || m.role === "Planner");
  const crewSorted = sorted.filter((m) => m.role !== "Owner" && m.role !== "Planner");
  const unlinkedCount = members.filter((m) => m.isGuest).length;
  const hasGuest = members.some((m) => m.isGuest);

  return (
    <div className={embedded ? "@container" : "@container px-4"}>
      {/* ── Unlinked crew nudge — sits at the very top of the tab,
          above the CREW header, so it reads as a tab-level alert
          consistent with Schedule and Lodging. ── */}
      {isOwner && unlinkedCount > 0 && (
        <div
          className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
          >
            <Mail size={14} />
          </span>
          <div>
            <p className="text-[13px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
              {unlinkedCount} {unlinkedCount === 1 ? "person hasn't" : "people haven't"} joined yet
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
              Send them an email so they can see the plan
            </p>
          </div>
        </div>
      )}

      <h2
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Crew
      </h2>

      {/* Member view — single cohesive list, no Planners/Rest split,
          no Planner badges. Owner badge + ghost-guest legend stay. */}
      {!canEdit && (
        <div>
          {hasGuest && (
            <div
              className="mb-2 flex items-center justify-end gap-1.5 text-[11px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <span
                className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--color-bt-border)" }}
              >
                <Ghost size={10} />
              </span>
              <span>= not a BuddyTrip member</span>
            </div>
          )}
          <div
            className="overflow-hidden rounded-xl"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            {sorted.map((m) => {
              const isMe = m.user_id === currentUser?.id;
              return (
                <CrewMemberRow
                  key={m.memberId}
                  member={m}
                  tripId={tripId}
                  isOwnerView={false}
                  isMe={isMe}
                  isExpanded={false}
                  hidePlannerBadge
                  onToggle={() => {}}
                  onUpdated={() => {}}
                />
              );
            })}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          {/* ── Owner blurb + action buttons ── */}
          {isOwner && (
            <div className="space-y-2.5">
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
                Planners can help manage the trip alongside you — promote any crew member with a BuddyTrip account and they get access right away.
              </p>

              {/* Half+half action row */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowAddMember((v) => !v); setAddMemberName(""); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <Users size={13} />
                  <Plus size={10} />
                  Add crew member
                </button>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-85"
                  style={{
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                  }}
                >
                  <Mail size={13} />
                  Email the Crew
                </button>
              </div>

              {/* Inline add-member form */}
              {showAddMember && (
                <div
                  className="flex gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: "color-mix(in srgb, var(--color-bt-accent) 6%, var(--color-bt-base))" }}
                >
                  <input
                    value={addMemberName}
                    onChange={(e) => setAddMemberName(e.target.value)}
                    placeholder="Name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && addMemberName.trim()) {
                        createGuest.mutate({ tripId, name: addMemberName.trim(), role: "Member" });
                      }
                      if (e.key === "Escape") { setShowAddMember(false); setAddMemberName(""); }
                    }}
                    className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                    style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                  />
                  <button
                    onClick={() => {
                      if (addMemberName.trim()) createGuest.mutate({ tripId, name: addMemberName.trim(), role: "Member" });
                    }}
                    disabled={!addMemberName.trim() || createGuest.isPending}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >
                    {createGuest.isPending ? "..." : "Add"}
                  </button>
                  <button
                    onClick={() => { setShowAddMember(false); setAddMemberName(""); }}
                    className="rounded-lg border px-3 py-1.5 text-xs"
                    style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Two-column layout: Planners | Crew ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* ── Column 1: Planners — drop zone for Member→Planner ── */}
            <section style={{ alignSelf: "start" }}>
              <h2
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Planners
              </h2>
              <div
                className="overflow-hidden rounded-xl transition-colors"
                style={{
                  background: "var(--color-bt-card)",
                  border: plannersDragOver
                    ? "1.5px dashed var(--color-bt-accent)"
                    : "1px solid var(--color-bt-border)",
                }}
                onDragOver={(e) => { e.preventDefault(); setPlannersDragOver(true); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setPlannersDragOver(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setPlannersDragOver(false);
                  const userId = e.dataTransfer.getData(DND_CREW_KEY);
                  if (userId && dragSource.current?.role === "Member") {
                    handleUpdateRole(userId, "Planner");
                  }
                  dragSource.current = null;
                }}
              >
                {plannersSorted.map((m) => {
                  const isMe = m.user_id === currentUser?.id;
                  // Planners (not the owner, not ourselves) can be dragged to the Crew column
                  const isDraggable = isOwner && m.role === "Planner" && !isMe;
                  return (
                    <CrewMemberRow
                      key={m.memberId}
                      member={m}
                      tripId={tripId}
                      isOwnerView={isOwner}
                      isMe={isMe}
                      isExpanded={expandedId === m.user_id}
                      isPlannerSection
                      draggable={isDraggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_CREW_KEY, m.user_id ?? "");
                        dragSource.current = { userId: m.user_id ?? "", role: m.role };
                      }}
                      onToggle={() => setExpandedId(expandedId === m.user_id ? null : m.user_id)}
                      onUpdated={() => utils.tripMembers.list.invalidate({ tripId })}
                      onUpdateRole={handleUpdateRole}
                    />
                  );
                })}
              </div>
            </section>

            {/* ── Column 2: Crew — drop zone for Planner→Member ── */}
            <section style={{ alignSelf: "start" }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Rest of the crew
                </h2>
                {crewSorted.some((m) => m.isGuest) && (
                  <div
                    className="flex items-center gap-1.5 text-[11px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <span
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--color-bt-border)" }}
                    >
                      <Ghost size={10} />
                    </span>
                    <span>= not a BuddyTrip member</span>
                  </div>
                )}
              </div>
              <div
                className="overflow-hidden rounded-xl transition-colors"
                style={{
                  background: "var(--color-bt-card)",
                  border: crewDragOver
                    ? "1.5px dashed var(--color-bt-accent)"
                    : "1px solid var(--color-bt-border)",
                }}
                onDragOver={(e) => { e.preventDefault(); setCrewDragOver(true); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setCrewDragOver(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setCrewDragOver(false);
                  const userId = e.dataTransfer.getData(DND_CREW_KEY);
                  if (userId && dragSource.current?.role === "Planner") {
                    handleUpdateRole(userId, "Member");
                  }
                  dragSource.current = null;
                }}
              >
                {crewSorted.map((m) => {
                  const isMe = m.user_id === currentUser?.id;
                  // Real BT accounts (non-guests with a user_id) can be dragged to the Planners column
                  const isDraggable = isOwner && !m.isGuest && !!m.user_id;
                  return (
                    <CrewMemberRow
                      key={m.memberId}
                      member={m}
                      tripId={tripId}
                      isOwnerView={isOwner}
                      isMe={isMe}
                      isExpanded={expandedId === m.user_id}
                      draggable={isDraggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_CREW_KEY, m.user_id ?? "");
                        dragSource.current = { userId: m.user_id ?? "", role: m.role };
                      }}
                      onToggle={() => setExpandedId(expandedId === m.user_id ? null : m.user_id)}
                      onUpdated={() => utils.tripMembers.list.invalidate({ tripId })}
                      onUpdateRole={handleUpdateRole}
                    />
                  );
                })}
                {crewSorted.length === 0 && (
                  <p className="py-6 text-center text-sm italic" style={{ color: "var(--color-bt-text-dim)" }}>
                    {isOwner ? "Drag a planner here to move them to crew." : "No crew members yet."}
                  </p>
                )}
              </div>
            </section>

          </div>
        </div>
      )}

      {/* ── Crew Email modal ─────────────────────────────────────────────── */}
      {showEmailModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEmailModal(false); }}
        >
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-t-2xl sm:rounded-2xl"
            style={{
              background: "var(--color-bt-base)",
              maxHeight: "90dvh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Modal header */}
            <div
              className="flex flex-shrink-0 items-center gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid var(--color-bt-border)" }}
            >
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
              >
                <Mail size={15} />
              </span>
              <span className="flex-1 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Email the Crew
              </span>
              <button
                onClick={() => setShowEmailModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div className="overflow-y-auto p-4">
              <CrewEmailPanel trip={trip} isOwner={isOwner} />
            </div>

            {/* Modal footer */}
            <div
              className="flex flex-shrink-0 justify-end px-4 py-3"
              style={{ borderTop: "1px solid var(--color-bt-border)" }}
            >
              <button
                onClick={() => setShowEmailModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70"
                style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
