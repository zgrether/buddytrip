"use client";

import { useState } from "react";
import { Ghost, Mail, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFrequentTripmates } from "@/hooks/useFrequentTripmates";
import { RoleBadge } from "@/components/RoleBadge";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import type { TabProps } from "./types";
import type { TripRole } from "@/server/middleware";

// ── RSVP status config ────────────────────────────────────────────────────

const RSVP_LABEL: Record<string, { label: string; color: string }> = {
  in:     { label: "In",       color: "var(--color-bt-accent)" },
  likely: { label: "Likely",   color: "var(--color-bt-ready)" },
  maybe:  { label: "Maybe",    color: "var(--color-bt-planning)" },
  out:    { label: "Can't go", color: "var(--color-bt-danger)" },
};

type RsvpStatus = "in" | "likely" | "maybe" | "out";

function RsvpBadge({ status }: { status: string }) {
  const cfg = RSVP_LABEL[status] ?? { label: status, color: "var(--color-bt-text-dim)" };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${cfg.color}22`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ── My RSVP selector ──────────────────────────────────────────────────────

function MyRsvpButtons({
  tripId,
  currentStatus,
}: {
  tripId: string;
  currentStatus?: string;
}) {
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();
  const updateRsvp = trpc.tripMembers.updateRsvp.useMutation({
    async onMutate({ status }) {
      await utils.tripMembers.list.cancel({ tripId });
      const prev = utils.tripMembers.list.getData({ tripId });
      utils.tripMembers.list.setData(
        { tripId },
        (prev ?? []).map((m) =>
          m.user_id === currentUser?.id ? { ...m, status } : m
        )
      );
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined)
        utils.tripMembers.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  return (
    <div className="mt-2 flex gap-1.5">
      {(["in", "likely", "maybe", "out"] as RsvpStatus[]).map((s) => {
        const cfg = RSVP_LABEL[s];
        const active = currentStatus === s;
        return (
          <button
            key={s}
            data-testid={`rsvp-${s}`}
            onClick={() => updateRsvp.mutate({ tripId, status: s })}
            className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
            style={{
              background: active ? `${cfg.color}22` : "var(--color-bt-base)",
              border: `1px solid ${active ? cfg.color : "var(--color-bt-border)"}`,
              color: cfg.color,
            }}
          >
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Member row ────────────────────────────────────────────────────────────

type MemberType = {
  memberId: string;
  user_id: string | null;
  role: string;
  status: string | null;
  displayName: string;
  isGuest: boolean;
  user: { email: string | null; is_guest?: boolean } | null;
};

function MemberRow({
  member,
  isMe,
  isOwner,
  tripId,
  isExpanded,
  onToggleExpand,
  me,
}: {
  member: MemberType;
  isMe: boolean;
  isOwner: boolean;
  tripId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  me: MemberType | undefined;
}) {
  const utils = trpc.useUtils();

  const updateRole = trpc.tripMembers.updateRole.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); },
  });

  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId }); },
  });

  return (
    <div
      data-testid={`member-${member.memberId}`}
      className="rounded-xl px-4 py-3"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{
            background: isMe ? "var(--color-bt-tag-bg)" : "var(--color-bt-past-bg)",
            color: isMe ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
          }}
        >
          {member.displayName.charAt(0).toUpperCase()}
          {member.isGuest && (
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full"
              style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text-dim)" }}
            >
              <Ghost size={9} />
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {member.displayName}
            {isMe && (
              <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                (you)
              </span>
            )}
          </p>
          {member.isGuest ? (
            <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
              {member.user?.email ?? "Guest \u00b7 no account"}
            </p>
          ) : (
            member.user?.email && (
              <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                {member.user.email}
              </p>
            )
          )}
        </div>

        {/* Badges + expand */}
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <RoleBadge role={member.role as TripRole} />
          {!member.isGuest && member.status && member.status !== "draft" && member.status !== "invited" && (
            <RsvpBadge status={member.status} />
          )}
          {member.status === "invited" && (
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: "var(--color-bt-ready)22", color: "var(--color-bt-ready)" }}
            >
              Invited
            </span>
          )}
          {member.status === "draft" && (
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: "var(--color-bt-text-dim)22", color: "var(--color-bt-text-dim)" }}
            >
              Draft
            </span>
          )}
          {isOwner && !isMe && (
            <button
              data-testid={`expand-member-${member.memberId}`}
              onClick={onToggleExpand}
              className="text-xs"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {isExpanded ? "\u25b2" : "\u22ef"}
            </button>
          )}
        </div>
      </div>

      {/* RSVP buttons for current user */}
      {isMe && !member.isGuest && member.status !== "draft" && member.status !== "invited" && (
        <MyRsvpButtons tripId={tripId} currentStatus={me?.status ?? undefined} />
      )}

      {/* Owner controls */}
      {isOwner && !isMe && isExpanded && (
        <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--color-bt-border)" }}>
          {!member.isGuest && (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Role:</span>
              {(["Member", "Planner"] as const).map((r) => (
                <button
                  key={r}
                  data-testid={`set-role-${member.memberId}-${r.toLowerCase()}`}
                  disabled={member.role === r || updateRole.isPending}
                  onClick={() => updateRole.mutate({ tripId, userId: member.user_id as string, role: r })}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                  style={{
                    background: member.role === r ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                    border: `1px solid ${member.role === r ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                    color: member.role === r ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <button
            data-testid={`remove-member-${member.memberId}`}
            disabled={removeMember.isPending}
            onClick={() => removeMember.mutate({ tripId, userId: member.user_id as string })}
            className="w-full rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
            style={{
              background: "var(--color-bt-danger-faint, #fee2e222)",
              color: "var(--color-bt-danger)",
              border: "1px solid var(--color-bt-danger-border, #fca5a5)",
            }}
          >
            {removeMember.isPending ? "Removing\u2026" : "Remove from trip"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Status section header ─────────────────────────────────────────────────

function StatusGroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <h3
      className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider first:mt-0"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      {label} ({count})
    </h3>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, canEdit, isOwner }: TabProps) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });
  const { data: frequentTripmates = [] } = useFrequentTripmates(trip.id, currentUser?.id ?? "");
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  const inviteByEmail = trpc.tripMembers.inviteByEmail.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId: trip.id }); },
  });

  const me = members.find((m) => m.user_id === currentUser?.id);

  // Group members by status
  const confirmed = members.filter((m) =>
    m.status === "in" || m.status === "likely" || m.status === "maybe" || m.status === "out"
  );
  const invited = members.filter((m) => m.status === "invited");
  const drafts = members.filter((m) => m.status === "draft");
  const draftWithEmail = drafts.filter((m) => m.user?.email);

  // Summary
  const summaryParts: string[] = [];
  if (confirmed.length > 0) summaryParts.push(`${confirmed.length} confirmed`);
  if (invited.length > 0) summaryParts.push(`${invited.length} invited`);
  if (drafts.length > 0) summaryParts.push(`${drafts.length} not yet invited`);

  function handleSendInvite(member: MemberType) {
    if (!member.user?.email) return;
    inviteByEmail.mutate({ tripId: trip.id, email: member.user.email, role: member.role as "Planner" | "Member" });
  }

  function handleSendAllInvites() {
    for (const m of draftWithEmail) {
      if (m.user?.email) {
        inviteByEmail.mutate({ tripId: trip.id, email: m.user.email, role: m.role as "Planner" | "Member" });
      }
    }
  }

  function renderMember(member: MemberType) {
    const isMe = member.user_id === currentUser?.id;
    const isExpanded = expandedMemberId === member.memberId;
    return (
      <MemberRow
        key={member.memberId}
        member={member}
        isMe={isMe}
        isOwner={isOwner ?? false}
        tripId={trip.id}
        isExpanded={isExpanded}
        onToggleExpand={() => setExpandedMemberId(isExpanded ? null : member.memberId)}
        me={me as MemberType | undefined}
      />
    );
  }

  return (
    <div className="space-y-5 px-4">

      {/* Summary bar */}
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {members.length} member{members.length !== 1 ? "s" : ""}
        {summaryParts.length > 0 && ` \u00b7 ${summaryParts.join(" \u00b7 ")}`}
      </p>

      {/* Add member (canEdit only) */}
      {canEdit && (
        <section
          className="rounded-xl p-4"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="mb-3 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            Add Crew Member
          </p>
          <CrewSearchInput
            tripId={trip.id}
            defaultRole="Member"
            defaultStatus="draft"
            allowGhost={true}
            allowInvite={true}
            placeholder="Search by email..."
            onAdded={() => utils.tripMembers.list.invalidate({ tripId: trip.id })}
            frequentTripmates={frequentTripmates
              .filter((t): t is typeof t & { email: string } =>
                t.email != null && !members.some((m) => m.user_id === t.id)
              )}
          />
        </section>
      )}

      {/* Confirmed members */}
      {confirmed.length > 0 && (
        <section>
          <StatusGroupHeader label="Confirmed" count={confirmed.length} />
          <div className="space-y-2">
            {confirmed.map(renderMember)}
          </div>
        </section>
      )}

      {/* Invited members */}
      {invited.length > 0 && (
        <section>
          <StatusGroupHeader label="Invited" count={invited.length} />
          <div className="space-y-2">
            {invited.map(renderMember)}
          </div>
        </section>
      )}

      {/* Draft members */}
      {drafts.length > 0 && (
        <section>
          <StatusGroupHeader label="Draft" count={drafts.length} />
          <div className="space-y-2">
            {drafts.map((member) => (
              <div key={member.memberId}>
                {renderMember(member)}
                {/* Inline send invite for drafts with email */}
                {isOwner && member.user?.email && (
                  <button
                    onClick={() => handleSendInvite(member as MemberType)}
                    disabled={inviteByEmail.isPending}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                    style={{
                      background: "var(--color-bt-accent-faint)",
                      color: "var(--color-bt-accent)",
                      border: "1px solid var(--color-bt-accent-border)",
                    }}
                  >
                    <Mail size={11} />
                    Send invite
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Bulk send all invites */}
          {isOwner && draftWithEmail.length > 1 && (
            <button
              onClick={handleSendAllInvites}
              disabled={inviteByEmail.isPending}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              <UserPlus size={12} />
              {inviteByEmail.isPending ? "Sending\u2026" : `Send all invites (${draftWithEmail.length})`}
            </button>
          )}
        </section>
      )}

      {members.length === 0 && (
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No members yet. Add someone above to get started.
        </p>
      )}
    </div>
  );
}
