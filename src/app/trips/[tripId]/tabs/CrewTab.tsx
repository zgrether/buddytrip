"use client";

import { useState } from "react";
import { Ghost, Link, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFrequentTripmates } from "@/hooks/useFrequentTripmates";
import { RoleBadge } from "@/components/RoleBadge";
import type { TabProps } from "./types";
import type { TripRole } from "@/server/middleware";

// ── RSVP status config ────────────────────────────────────────────────────

const RSVP_LABEL: Record<string, { label: string; color: string }> = {
  in:     { label: "✅ In",       color: "var(--color-bt-accent)" },
  likely: { label: "🤙 Likely",   color: "var(--color-bt-ready)" },
  maybe:  { label: "🤷 Maybe",    color: "var(--color-bt-planning)" },
  out:    { label: "❌ Can't go", color: "var(--color-bt-danger)" },
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

// ── Avatar initials ────────────────────────────────────────────────────────

function Avatar({ name, isMe, size = 10 }: { name: string; isMe?: boolean; size?: number }) {
  return (
    <div
      className={`flex h-${size} w-${size} flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold`}
      style={{
        background: isMe ? "var(--color-bt-tag-bg)" : "var(--color-bt-past-bg)",
        color: isMe ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── My RSVP selector (inline in current user row) ─────────────────────────

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

// ── Add Member Form ────────────────────────────────────────────────────────

type MatchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "matched"; user: { id: string; name: string | null; nickname: string | null; email: string | null } }
  | { kind: "no_match" };

function AddMemberForm({
  tripId,
  existingMemberIds,
  currentUserId,
  onFrequentAdd,
}: {
  tripId: string;
  existingMemberIds: string[];
  currentUserId: string | undefined;
  onFrequentAdd: (userId: string, name: string) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [match, setMatch] = useState<MatchState>({ kind: "idle" });
  const [role, setRole] = useState<"Member" | "Planner">("Member");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Search by email if present, otherwise by name
  const searchQuery = email.trim() || name.trim();
  const { refetch: searchUsers, isFetching } = trpc.users.search.useQuery(
    { query: searchQuery },
    { enabled: false }
  );

  const addMember = trpc.tripMembers.add.useMutation({
    onSuccess() {
      const matchedUser = match.kind === "matched" ? match.user : null;
      const label = matchedUser?.nickname ?? matchedUser?.name ?? matchedUser?.email ?? "User";
      utils.tripMembers.list.invalidate({ tripId });
      showToast(`${label} added to trip.`);
      setName("");
      setEmail("");
      setMatch({ kind: "idle" });
      setRole("Member");
    },
    onError(err) {
      showToast(err.message);
    },
  });

  const createGuest = trpc.ghostCrew.create.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId });
      showToast(`${name.trim() || email.trim()} added as guest.`);
      setName("");
      setEmail("");
      setMatch({ kind: "idle" });
      setRole("Member");
    },
    onError(err) {
      showToast(err.message);
    },
  });

  const handleSearch = async () => {
    if (!searchQuery) return;
    setMatch({ kind: "searching" });
    const result = await searchUsers();
    const users = result.data ?? [];
    const available = users.filter((u) => !existingMemberIds.includes(u.id));
    if (available.length > 0) {
      setMatch({ kind: "matched", user: available[0] });
    } else {
      setMatch({ kind: "no_match" });
    }
  };

  const handleAddGuest = () => {
    createGuest.mutate({
      tripId,
      name: name.trim(),
      email: email.trim() || undefined,
      role,
    });
  };

  const handleSendInvite = () => {
    const url = `${window.location.origin}/invite/stub`;
    navigator.clipboard.writeText(url).catch(() => {});
    showToast("Invite link copied");
  };

  const displayName = (u: { name: string | null; nickname: string | null; email: string | null }) =>
    u.nickname ?? u.name ?? u.email ?? "Unknown";

  const resetMatch = () => setMatch({ kind: "idle" });

  return (
    <div
      className="space-y-4 rounded-xl p-4"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
        Add Crew Member
      </p>

      {/* Frequently trips with — inside the card */}
      {currentUserId && (
        <FrequentTripmates
          tripId={tripId}
          currentUserId={currentUserId}
          onAdd={onFrequentAdd}
        />
      )}

      {/* Name + Email fields */}
      <div className="space-y-2">
        <input
          data-testid="add-member-name-input"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => { setName(e.target.value); resetMatch(); }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="w-full rounded-lg border py-2 px-3 text-sm outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <input
          data-testid="add-member-email-input"
          type="email"
          placeholder="Email (optional)"
          value={email}
          onChange={(e) => { setEmail(e.target.value); resetMatch(); }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="w-full rounded-lg border py-2 px-3 text-sm outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
      </div>

      <button
        data-testid="add-member-search-btn"
        disabled={!searchQuery || isFetching}
        onClick={handleSearch}
        className="w-full rounded-lg py-2 text-sm font-medium disabled:opacity-40"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
      >
        {isFetching ? "Searching…" : "Search"}
      </button>

      {/* Match found — confirmation card */}
      {match.kind === "matched" && (
        <div
          className="space-y-3 rounded-lg p-3"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <div className="flex items-center gap-3">
            <Avatar name={displayName(match.user)} size={8} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                {displayName(match.user)}
              </p>
              {match.user.email && (
                <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  {match.user.email}
                </p>
              )}
            </div>
          </div>

          {/* Role selector */}
          <div className="flex gap-2">
            {(["Member", "Planner"] as const).map((r) => (
              <button
                key={r}
                data-testid={`role-${r.toLowerCase()}`}
                onClick={() => setRole(r)}
                className="flex-1 rounded-lg py-1.5 text-xs font-medium transition-all"
                style={{
                  background: role === r ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                  border: `1px solid ${role === r ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                  color: role === r ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                }}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            data-testid="confirm-add-btn"
            disabled={addMember.isPending}
            onClick={() => addMember.mutate({ tripId, userId: match.user.id, role })}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-accent-border)",
            }}
          >
            <UserPlus size={14} />
            {addMember.isPending ? "Adding…" : "Add to Trip"}
          </button>
        </div>
      )}

      {/* No match — guest or invite */}
      {match.kind === "no_match" && (
        <div
          className="space-y-2 rounded-lg p-3"
          style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            No BuddyTrip account found for{" "}
            <span style={{ color: "var(--color-bt-text)" }}>{searchQuery}</span>.
          </p>
          <div className="flex gap-2">
            <button
              data-testid="add-as-guest-btn"
              disabled={!name.trim() || createGuest.isPending}
              onClick={handleAddGuest}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
              style={{
                background: "var(--color-bt-accent-faint)",
                color: "var(--color-bt-accent)",
                border: "1px solid var(--color-bt-accent-border)",
              }}
            >
              <Ghost size={12} />
              {createGuest.isPending ? "Adding…" : `Add ${name.trim() || "as a guest"}`}
            </button>
            <button
              data-testid="send-invite-link-btn"
              onClick={handleSendInvite}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
              style={{
                background: "var(--color-bt-base)",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Link size={12} />
              Send invite link
            </button>
          </div>
          {!name.trim() && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              Enter a name above to add as guest.
            </p>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <p className="text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
          {toast}
        </p>
      )}
    </div>
  );
}

// ── Frequently trips with ─────────────────────────────────────────────────

function FrequentTripmates({
  tripId,
  currentUserId,
  onAdd,
}: {
  tripId: string;
  currentUserId: string;
  onAdd: (userId: string, name: string) => void;
}) {
  const { data: tripmates = [] } = useFrequentTripmates(tripId, currentUserId);

  if (tripmates.length === 0) return null;

  return (
    <div>
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Frequently Trips With
      </p>
      <div className="flex flex-wrap gap-2">
        {tripmates.map((user) => {
          const label = user.nickname ?? user.name ?? user.email ?? "?";
          return (
            <button
              key={user.id}
              data-testid={`frequent-tripmate-${user.id}`}
              onClick={() => onAdd(user.id, label)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80"
              style={{
                background: "var(--color-bt-past-bg)",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
              >
                {label.charAt(0).toUpperCase()}
              </div>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── CrewTab ───────────────────────────────────────────────────────────────

export function CrewTab({ trip, canEdit, isOwner }: TabProps) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const updateRole = trpc.tripMembers.updateRole.useMutation({
    onSuccess() { utils.tripMembers.list.invalidate({ tripId: trip.id }); },
  });

  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId: trip.id });
      setExpandedMemberId(null);
    },
  });

  const addMember = trpc.tripMembers.add.useMutation({
    onSuccess(_, _vars) {
      utils.tripMembers.list.invalidate({ tripId: trip.id });
    },
  });

  const me = members.find((m) => m.user_id === currentUser?.id);
  const existingMemberIds = members
    .filter((m) => m.user_id)
    .map((m) => m.user_id as string);

  // Summary counts
  const statusCounts = { in: 0, likely: 0, maybe: 0, out: 0 };
  for (const m of members) {
    if (m.status && m.status in statusCounts) {
      statusCounts[m.status as keyof typeof statusCounts]++;
    }
  }
  const summaryParts: string[] = [`${members.length} member${members.length !== 1 ? "s" : ""}`];
  if (statusCounts.in > 0) summaryParts.push(`${statusCounts.in} in`);
  if (statusCounts.likely > 0) summaryParts.push(`${statusCounts.likely} likely`);
  if (statusCounts.maybe > 0) summaryParts.push(`${statusCounts.maybe} maybe`);
  if (statusCounts.out > 0) summaryParts.push(`${statusCounts.out} can't go`);

  const handleAddFrequentTripmate = (userId: string, name: string) => {
    addMember.mutate(
      { tripId: trip.id, userId, role: "Member" },
      {
        onSuccess() {
          utils.tripMembers.list.invalidate({ tripId: trip.id });
          showToast(`${name} added to trip.`);
        },
        onError(err) {
          showToast(err.message);
        },
      }
    );
  };

  return (
    <div className="space-y-5 px-4">

      {/* Summary bar */}
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {summaryParts.join(" · ")}
      </p>

      {/* Add form (canEdit only) — includes Frequently Trips With inside */}
      {canEdit && (
        <section>
          <AddMemberForm
            tripId={trip.id}
            existingMemberIds={existingMemberIds}
            currentUserId={currentUser?.id}
            onFrequentAdd={handleAddFrequentTripmate}
          />
          {toast && (
            <p className="mt-2 text-xs font-medium" style={{ color: "var(--color-bt-accent)" }}>
              {toast}
            </p>
          )}
        </section>
      )}

      {/* Members list */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Members ({members.length})
        </h2>

        <div className="space-y-2">
          {members.map((member) => {
            const isMe = member.user_id === currentUser?.id;
            const isExpanded = expandedMemberId === member.memberId;

            return (
              <div
                key={member.memberId}
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
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {member.displayName}
                      {isMe && (
                        <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          (you)
                        </span>
                      )}
                    </p>
                    {member.isGuest ? (
                      <p className="text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
                        {member.user?.email ?? "Guest · no account"}
                      </p>
                    ) : (
                      member.user?.email && (
                        <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          {member.user.email}
                        </p>
                      )
                    )}
                  </div>

                  {/* Badges + expand (owner/planner only, not self) */}
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <RoleBadge role={member.role as TripRole} />
                    {/* RSVP badge — visible to everyone for non-guests */}
                    {!member.isGuest && member.status && (
                      <RsvpBadge status={member.status} />
                    )}
                    {/* Expand button for owner/planner on other members */}
                    {isOwner && !isMe && (
                      <button
                        data-testid={`expand-member-${member.memberId}`}
                        onClick={() =>
                          setExpandedMemberId(isExpanded ? null : member.memberId)
                        }
                        className="text-xs"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {isExpanded ? "▲" : "⋯"}
                      </button>
                    )}
                  </div>
                </div>

                {/* RSVP buttons for current user */}
                {isMe && !member.isGuest && (
                  <MyRsvpButtons tripId={trip.id} currentStatus={me?.status ?? undefined} />
                )}

                {/* Owner/planner controls for other members */}
                {isOwner && !isMe && isExpanded && (
                  <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--color-bt-border)" }}>
                    {/* Role change */}
                    {!member.isGuest && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          Role:
                        </span>
                        {(["Member", "Planner"] as const).map((r) => (
                          <button
                            key={r}
                            data-testid={`set-role-${member.memberId}-${r.toLowerCase()}`}
                            disabled={member.role === r || updateRole.isPending}
                            onClick={() =>
                              updateRole.mutate({
                                tripId: trip.id,
                                userId: member.user_id as string,
                                role: r,
                              })
                            }
                            className="rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                            style={{
                              background:
                                member.role === r
                                  ? "var(--color-bt-accent-faint)"
                                  : "var(--color-bt-base)",
                              border: `1px solid ${
                                member.role === r
                                  ? "var(--color-bt-accent)"
                                  : "var(--color-bt-border)"
                              }`,
                              color:
                                member.role === r
                                  ? "var(--color-bt-accent)"
                                  : "var(--color-bt-text-dim)",
                            }}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Remove */}
                    <button
                      data-testid={`remove-member-${member.memberId}`}
                      disabled={removeMember.isPending}
                      onClick={() => {
                        if (member.isGuest) {
                          // ghostCrew.remove would be used for guests but keeping it simple
                        } else {
                          removeMember.mutate({
                            tripId: trip.id,
                            userId: member.user_id as string,
                          });
                        }
                      }}
                      className="w-full rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                      style={{
                        background: "var(--color-bt-danger-faint, #fee2e222)",
                        color: "var(--color-bt-danger)",
                        border: "1px solid var(--color-bt-danger-border, #fca5a5)",
                      }}
                    >
                      {removeMember.isPending ? "Removing…" : "Remove from trip"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
