"use client";

import { useState } from "react";
import { Ghost, Mail, X } from "lucide-react";
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
  isExpanded,
  onToggle,
  onUpdated,
}: {
  member: Member;
  tripId: string;
  canEdit: boolean;
  isMe: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdated: () => void;
}) {
  const utils = trpc.useUtils();
  const [editName, setEditName] = useState(m.displayName);
  const [editEmail, setEditEmail] = useState(m.user?.email ?? "");
  const [editRole, setEditRole] = useState<"Planner" | "Member">(
    m.role === "Planner" ? "Planner" : "Member"
  );
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
  const initial = display.charAt(0).toUpperCase();
  const roleColor = ROLE_COLOR[m.role] ?? "var(--color-bt-text-dim)";
  const rsvpCfg = m.status ? RSVP_LABEL[m.status] : null;
  const editable = canEdit && !isMe && m.role !== "Owner";

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
      style={{ borderColor: "var(--color-bt-border)" }}
    >
      {/* ── Main row (tappable) ──────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 py-2.5 px-1 -mx-1 rounded"
        style={{
          background: rsvpCfg && m.role !== "Owner" && !m.isGuest ? `${rsvpCfg.color}0a` : undefined,
          cursor: editable ? "pointer" : undefined,
        }}
        onClick={editable ? onToggle : undefined}
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

        {/* Status — not shown for Owner (always in) or ghost members (no RSVP) */}
        {m.role !== "Owner" && !m.isGuest && (
          m.status === "draft" ? (
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
          ) : null
        )}

        {/* Delete (X) button */}
        {editable && (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={14} />
          </button>
        )}
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

      {/* ── Expanded edit panel ──────────────────────────────────────────── */}
      {isExpanded && editable && (
        <div
          className="space-y-2 rounded-lg px-3 py-2.5 mb-1"
          style={{ background: "color-mix(in srgb, var(--color-bt-accent) 6%, var(--color-bt-base))" }}
        >
          {/* Name + email */}
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

          {/* Actions row — planner toggle + save/cancel */}
          <div className="flex items-center gap-2">
            {/* Planner toggle — only for real (non-ghost, non-Owner) members */}
            {m.role !== "Owner" && !m.isGuest && (
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
                onClick={onToggle}
                className="rounded-lg border px-3 py-1 text-xs"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
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
              isExpanded={expandedId === m.user_id}
              onToggle={() => setExpandedId(expandedId === m.user_id ? null : m.user_id)}
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
