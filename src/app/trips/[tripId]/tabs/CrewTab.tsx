"use client";

import { useState } from "react";
import { Ghost, Mail, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { TabProps } from "./types";

// ── RSVP helpers ──────────────────────────────────────────────────────────

const RSVP_LABEL: Record<string, { label: string; color: string }> = {
  in:      { label: "In",       color: "var(--color-bt-accent)" },
  likely:  { label: "Likely",   color: "var(--color-bt-ready)" },
  maybe:   { label: "Maybe",    color: "var(--color-bt-planning)" },
  out:     { label: "Can't go", color: "var(--color-bt-danger)" },
};

const ROLE_COLOR: Record<string, string> = {
  Owner:   "var(--color-bt-accent)",
  Planner: "var(--color-bt-ready)",
  Member:  "var(--color-bt-text-dim)",
};

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
  isMe,
  isEditing,
  onEdit,
  onCancelEdit,
  onUpdated,
}: {
  member: Member;
  tripId: string;
  canEdit: boolean;
  isMe: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdated: () => void;
}) {
  const utils = trpc.useUtils();
  const [editName, setEditName] = useState(m.displayName);
  const [editEmail, setEditEmail] = useState(m.user?.email ?? "");
  const [editRole, setEditRole] = useState<"Planner" | "Member">(
    m.role === "Planner" ? "Planner" : "Member"
  );

  const updateRole = trpc.tripMembers.updateRole.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); },
  });
  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); onCancelEdit(); onUpdated(); },
  });
  const updateGuest = trpc.ghostCrew.update.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); },
  });

  const display = m.displayName;
  const initial = display.charAt(0).toUpperCase();
  const roleColor = ROLE_COLOR[m.role] ?? "var(--color-bt-text-dim)";
  const rsvpCfg = m.status ? RSVP_LABEL[m.status] : null;

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
    if (!m.isGuest && editRole !== m.role && m.user_id) {
      await updateRole.mutateAsync({ tripId, userId: m.user_id, role: editRole });
    }
    onCancelEdit();
    onUpdated();
  };

  const handleRemove = () => {
    if (!m.user_id) return;
    removeMember.mutate({ tripId, userId: m.user_id });
  };

  // ── Edit state ──────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div
        className="space-y-2 border-b px-1 py-2"
        style={{ borderColor: "var(--color-bt-border)", background: "color-mix(in srgb, var(--color-bt-accent) 8%, var(--color-bt-base))" }}
      >
        {/* Name + email on one line — not shown for self */}
        {!isMe && (
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

        {/* Actions row — planner toggle + buttons */}
        <div className="flex items-center gap-2">
          {/* Planner toggle — only for real (non-ghost, non-Owner) members */}
          {!isMe && m.role !== "Owner" && !m.isGuest && (
            <button
              onClick={() => setEditRole((r) => (r === "Planner" ? "Member" : "Planner"))}
              className="mr-auto flex items-center gap-1.5"
            >
              <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Planner</span>
              <span
                className="relative inline-block h-5 w-8 rounded-full transition-colors"
                style={{ background: editRole === "Planner" ? "var(--color-bt-accent)" : "var(--color-bt-border)" }}
              >
                <span
                  className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  style={{ transform: editRole === "Planner" ? "translateX(12px)" : "translateX(0)" }}
                />
              </span>
            </button>
          )}

          <div className="ml-auto flex gap-2">
            <button
              onClick={handleSave}
              disabled={updateGuest.isPending || updateRole.isPending}
              className="rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className="rounded-lg border px-3 py-1 text-xs"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
            {!isMe && (
              <button
                onClick={handleRemove}
                disabled={removeMember.isPending}
                className="rounded-lg px-2 py-1 text-xs disabled:opacity-40"
                style={{ color: "var(--color-bt-danger)" }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Normal state ────────────────────────────────────────────────────────
  return (
    <div>
      <div
        className="flex items-center gap-3 border-b py-2.5 px-1 -mx-1 rounded"
        style={{
          borderColor: "var(--color-bt-border)",
          background: rsvpCfg ? `${rsvpCfg.color}0a` : undefined,
        }}
      >
        {/* Avatar */}
        {m.isGuest ? (
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)", opacity: 0.6 }}
          >
            <Ghost size={14} />
          </div>
        ) : (
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
          >
            {initial}
          </div>
        )}

        {/* Name + email */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {display}
            {isMe && (
              <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>(you)</span>
            )}
          </p>
          {m.user?.email && (
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {m.user.email}
            </p>
          )}
        </div>

        {/* Role — hidden for ghost members */}
        {!m.isGuest && (
          <span className="flex-shrink-0 text-xs font-semibold" style={{ color: roleColor }}>
            {m.role}
          </span>
        )}

        {/* Status */}
        {m.status === "draft" ? (
          <span className="flex-shrink-0 text-xs italic" style={{ color: "var(--color-bt-text-dim)", opacity: 0.7 }}>
            Not invited
          </span>
        ) : m.status === "invited" ? (
          <span className="flex-shrink-0 text-xs" style={{ color: "var(--color-bt-ready)" }}>
            Invited
          </span>
        ) : rsvpCfg ? (
          <span className="flex-shrink-0 text-xs" style={{ color: rsvpCfg.color }}>
            {rsvpCfg.label}
          </span>
        ) : null}

        {/* Edit button — canEdit for others (not self, not Owner) */}
        {canEdit && !isMe && m.role !== "Owner" && (
          <button
            onClick={onEdit}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEmailPanel, setShowEmailPanel] = useState(false);

  const addMember = trpc.tripMembers.add.useMutation();
  const createGhost = trpc.ghostCrew.create.useMutation();

  const me = members.find((m) => m.user_id === currentUser?.id);
  const confirmedCount = members.filter((m) =>
    m.status === "in" || m.status === "likely" || m.status === "maybe" || m.status === "out"
  ).length;

  const sorted = [...members].sort((a, b) => {
    const aOrder = ROLE_ORDER[a.role] ?? 2;
    const bOrder = ROLE_ORDER[b.role] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.displayName.localeCompare(b.displayName);
  });

  const handleAdd = async () => {
    const name = addName.trim();
    const email = addEmail.trim().toLowerCase() || null;
    if (!name) return;

    setIsAdding(true);
    try {
      if (email) {
        const existing = await utils.users.search.fetch({ query: email });
        const realUser = existing?.find((u) => !u.is_guest);
        if (realUser) {
          await addMember.mutateAsync({ tripId, userId: realUser.id, role: "Member", status: "draft" });
        } else {
          await createGhost.mutateAsync({ tripId, name, email, role: "Member" });
        }
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

  return (
    <div className="space-y-4 px-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
          {members.length} people{confirmedCount > 0 ? ` \u00b7 ${confirmedCount} confirmed` : ""}
        </p>
        {canEdit && (
          <button
            onClick={() => setShowEmailPanel(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            <Mail size={13} />
            Send email
          </button>
        )}
      </div>

      {/* Inline add row */}
      {canEdit && (
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
      )}

      {/* Member list — flat, sorted by role then name */}
      <div>
        {sorted.map((m) => {
          const isMe = m.user_id === currentUser?.id;
          return (
            <CrewMemberRow
              key={m.memberId}
              member={m}
              tripId={tripId}
              canEdit={canEdit}
              isMe={isMe}
              isEditing={editingId === m.user_id}
              onEdit={() => setEditingId(m.user_id)}
              onCancelEdit={() => setEditingId(null)}
              onUpdated={() => utils.tripMembers.list.invalidate({ tripId })}
            />
          );
        })}
      </div>

      {members.length === 0 && (
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No members yet. Add someone above to get started.
        </p>
      )}

      {/* Send email panel (stub) */}
      {showEmailPanel && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowEmailPanel(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl p-5"
            style={{ background: "var(--color-bt-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Send email to crew
            </p>
            <p className="mb-4 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Email sending will be available once the invite system is set up.
              For now, copy the invite link to share manually.
            </p>
            <button
              onClick={() => {
                navigator.clipboard
                  .writeText(`${window.location.origin}/invite?trip=${tripId}`)
                  .catch(() => {});
                setShowEmailPanel(false);
              }}
              className="w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Copy invite link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
