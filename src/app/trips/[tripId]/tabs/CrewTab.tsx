"use client";

import { useState } from "react";
import { Ghost, X } from "lucide-react";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import { UserAvatar } from "@/components/UserAvatar";
import { useTheme } from "next-themes";
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
  canEdit,
  isOwner,
  isMe,
  isExpanded,
  index,
  isPlannerRow,
  onToggle,
  onUpdated,
}: {
  member: Member;
  tripId: string;
  canEdit: boolean;
  isOwner: boolean;
  isMe: boolean;
  isExpanded: boolean;
  index: number;
  isPlannerRow?: boolean;
  onToggle: () => void;
  onUpdated: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const utils = trpc.useUtils();
  const [editName, setEditName] = useState(m.displayName);
  const [editEmail, setEditEmail] = useState(m.user?.email ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const updateRole = trpc.tripMembers.updateRole.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); },
  });
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
  const editable = canEdit && !isMe && m.role !== "Owner";
  const canActOnPlanner = isOwner && !isMe && m.role === "Planner";
  const canPromoteToCoplanner = isOwner && !isMe && m.role === "Member" && !isPlannerRow && !!m.user?.email;
  const hasTextChanges = editName.trim() !== m.displayName || editEmail.trim() !== (m.user?.email ?? "");

  const handleSave = async () => {
    if (m.isGuest && m.user_id) {
      const nameChanged = editName.trim() !== m.displayName;
      const emailChanged = editEmail.trim() !== (m.user?.email ?? "");
      if (nameChanged || emailChanged) {
        await updateGuest.mutateAsync({
          tripId,
          guestUserId: m.user_id,
          ...(nameChanged && { name: editName.trim() }),
          ...(emailChanged && { email: editEmail.trim() || null }),
        });
      }
    }
    onToggle();
    onUpdated();
  };

  const handleRemove = () => {
    if (!m.user_id) return;
    if (m.isGuest) {
      removeGuest.mutate({ tripId, guestUserId: m.user_id });
    } else {
      removeMember.mutate({ tripId, userId: m.user_id });
    }
  };

  return (
    <div
      className="border-b"
      style={{
        borderColor: "var(--color-bt-border)",
        background: index % 2 === 1 ? (isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)") : undefined,
      }}
    >
      {/* ── Main row (tappable) ──────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 py-2.5 px-1 -mx-1 rounded"
        style={{
          cursor: editable && !isPlannerRow ? "pointer" : undefined,
        }}
        onClick={editable && !isPlannerRow ? onToggle : undefined}
      >
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
            <p className="truncate text-xs opacity-40" style={{ color: "var(--color-bt-text-dim)" }}>
              no email on file
            </p>
          ) : null}
        </div>

        {/* ── Right side: actions ──────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center">
          <div className="flex flex-shrink-0 items-center gap-1">
            {/* Planner row: move to rest of crew */}
            {isPlannerRow && canActOnPlanner && (
              <button
                onClick={(e) => { e.stopPropagation(); if (m.user_id) updateRole.mutate({ tripId, userId: m.user_id, role: "Member" }); }}
                disabled={updateRole.isPending}
                className="rounded-lg px-2 py-1 text-xs disabled:opacity-40"
                style={{ color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
              >
                Remove as planner
              </button>
            )}
            {/* Crew row: promote to co-planner */}
            {canPromoteToCoplanner && (
              <button
                onClick={(e) => { e.stopPropagation(); if (m.user_id) updateRole.mutate({ tripId, userId: m.user_id, role: "Planner" }); }}
                disabled={updateRole.isPending}
                className="rounded-lg px-2 py-1 text-xs disabled:opacity-40"
                style={{ color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
              >
                Make planner
              </button>
            )}
            {/* Remove (X) */}
            {editable && (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Remove confirmation ──────────────────────────────────────────── */}
      {confirmRemove && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 mb-1"
          style={{ background: "color-mix(in srgb, var(--color-bt-danger) 6%, var(--color-bt-base))" }}
        >
          <p className="flex-1 text-xs" style={{ color: "var(--color-bt-danger)" }}>
            Remove {display} from this trip?
          </p>
          <button
            onClick={handleRemove}
            disabled={removeMember.isPending || removeGuest.isPending}
            className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-danger)", color: "white" }}
          >
            Remove
          </button>
          <button
            onClick={() => setConfirmRemove(false)}
            className="rounded-lg border px-3 py-1 text-xs"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Expanded edit panel — crew only, not for planner rows ─────────── */}
      {isExpanded && editable && !isPlannerRow && (
        <div
          className="space-y-2 rounded-lg px-3 py-2.5 mb-1"
          style={{ background: "color-mix(in srgb, var(--color-bt-accent) 6%, var(--color-bt-base))" }}
        >
          {/* Name + email — guest-only (validated users manage their own profile) */}
          {m.isGuest && (
            <div className="flex gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Name"
                className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
              <input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="Email"
                type="email"
                className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
            </div>
          )}

          {/* Actions row — save/cancel (planner promotion lives in the inline row button) */}
          <div className="flex items-center justify-end gap-2">
            {m.isGuest && (
              <button
                onClick={handleSave}
                disabled={!hasTextChanges || updateGuest.isPending}
                className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Save
              </button>
            )}
            <button
              onClick={onToggle}
              className="rounded-lg border px-3 py-1 text-xs"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              {m.isGuest ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, canEdit }: TabProps) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const tripId = trip.id;
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createGhost = trpc.ghostCrew.create.useMutation();
  const inviteByEmail = trpc.tripMembers.inviteByEmail.useMutation();

  const me = members.find((m) => m.user_id === currentUser?.id);
  const isOwner = me?.role === "Owner";
  const sorted = [...members].sort((a, b) => {
    const aOrder = ROLE_ORDER[a.role] ?? 2;
    const bOrder = ROLE_ORDER[b.role] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Real members before ghosts within the same role
    if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });

  const handleAdd = async () => {
    const name = addName.trim();
    const email = addEmail.trim().toLowerCase() || null;
    if (!name) return;

    setIsAdding(true);
    try {
      if (email) {
        // Email provided: use inviteByEmail which handles both
        // existing accounts (adds directly) and new users (creates invite + sends email)
        await inviteByEmail.mutateAsync({ tripId, email, role: "Member" });
      } else {
        await createGhost.mutateAsync({ tripId, name, role: "Member" });
      }
      setAddName("");
      setAddEmail("");
      utils.tripMembers.list.invalidate({ tripId });
    } finally {
      setIsAdding(false);
    }
  };

  // Split members into planners and crew
  const plannersSorted = sorted.filter((m) => m.role === "Owner" || m.role === "Planner");
  const crewSorted = sorted.filter((m) => m.role !== "Owner" && m.role !== "Planner");

  return (
    <div className="px-4 lg:grid lg:grid-cols-[1fr_380px] lg:gap-5 lg:items-start lg:px-0 lg:pl-4 lg:pr-4">
      <div className="space-y-4">
      {/* ── PLANNERS section ── */}
      <div>
        <h2
          className="mb-2 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Planners
        </h2>
        {isOwner && (
          <>
            <p className="mb-2 text-[13px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              Invite people who want to help plan. Planners can add destination ideas, vote, and weigh in before the trip is official — everyone else gets added when it&apos;s time to go.
            </p>
            <div className="mb-2">
              <CrewSearchInput
                tripId={tripId}
                defaultRole="Planner"
                defaultStatus="draft"
                allowGhost={false}
                allowInvite
                showSearchIcon
                placeholder="Search by email..."
                frequentTripmates={[]}
                onAdded={() => utils.tripMembers.list.invalidate({ tripId })}
              />
            </div>
          </>
        )}
        {plannersSorted.map((m, i) => {
          const isMe = m.user_id === currentUser?.id;
          return (
            <CrewMemberRow
              key={m.memberId}
              member={m}
              tripId={tripId}
              canEdit={canEdit}
              isOwner={isOwner}
              isMe={isMe}
              index={i}
              isExpanded={false}
              isPlannerRow
              onToggle={() => {}}
              onUpdated={() => utils.tripMembers.list.invalidate({ tripId })}
            />
          );
        })}
      </div>

      {/* ── REST OF THE CREW section ── */}
      <div className="pt-4">
        <h2
          className="mb-2 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Rest of the crew
        </h2>

        {/* Name + email add for crew members */}
        {canEdit && (
          <div className="mb-2">
            <p className="mb-2 text-[13px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              Start building your crew list. Add names and emails as you think of them — invites go out later when you&apos;re ready.
            </p>
            <div className="flex gap-2">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Name"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
              <input
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="Email (optional)"
                type="email"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
              <button
                onClick={handleAdd}
                disabled={!addName.trim() || isAdding}
                className="flex-shrink-0 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {isAdding ? "..." : "Add"}
              </button>
            </div>
          </div>
        )}

        <div>
          {crewSorted.map((m, i) => {
            const isMe = m.user_id === currentUser?.id;
            return (
              <CrewMemberRow
                key={m.memberId}
                member={m}
                tripId={tripId}
                canEdit={canEdit}
                isOwner={isOwner}
                isMe={isMe}
                index={i}
                isExpanded={expandedId === m.user_id}
                onToggle={() => setExpandedId(expandedId === m.user_id ? null : m.user_id)}
                onUpdated={() => utils.tripMembers.list.invalidate({ tripId })}
              />
            );
          })}
        </div>

        {crewSorted.length === 0 && !canEdit && (
          <p className="py-4 text-center text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            No crew members yet.
          </p>
        )}
      </div>
      </div>

      {/* Right column — owner-only sticky email panel (desktop only) */}
      <div className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
        {isOwner && <CrewEmailPanel trip={trip} isOwner={isOwner} />}
      </div>
    </div>
  );
}
