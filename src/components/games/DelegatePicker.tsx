"use client";

import { useState } from "react";
import { UserCircle2, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Avatar } from "@/components/Avatar";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";

/**
 * DelegatePicker — the ONE "who is running this game?" control.
 *
 * There were two, and they disagreed about almost everything. Game settings had
 * an "Assigned to <name>" line that opened a headed panel of real `Avatar`s;
 * add-a-game had an "Assign a game organizer" button under a "Delegate" field
 * label, opening a list of bare names with a `Users` glyph and a `+`. Same
 * decision, two vocabularies, and only one of them told you who it was assigned
 * to right now.
 *
 * Settings' version won and this is it, so add-a-game gains the parts it was
 * missing: the current assignee stated up front, avatars, and the owner-implicit
 * default ("Assigned to you" rather than an empty control that looks unset).
 *
 * ── Team colour ────────────────────────────────────────────────────────────
 * Avatars carry the member's COMPETITION-TEAM colour, matching the leaderboard,
 * where a delegate chip already renders in team colour, and the app bar (#837).
 * A person's identity in a competition is their team; a picker that renders them
 * neutral while every other surface renders them in colour is the same avatar
 * meaning two different things.
 *
 * `competitionId` is optional because the colour is: a game outside a
 * competition, or a member on no team, resolves to `undefined` and `Avatar`
 * falls back to its default treatment. Nothing here fails without it.
 */

export function DelegatePicker({
  tripId,
  competitionId,
  canAssign,
  value,
  onChange,
}: {
  tripId: string;
  /** Resolves team colours. Null/absent → neutral avatars, no other change. */
  competitionId?: string | null;
  /** Can change the assignment — owner-only, matching the server gate. The
   *  DISPLAY renders for everyone (a member should see whose game this is). */
  canAssign: boolean;
  /** The assigned delegate's user id. Null = the owner (absence = owner). */
  value: string | null;
  /** Controlled — the parent owns persistence. Nothing commits here. */
  onChange: (next: string | null) => void;
}) {
  const me = useCurrentUser();
  const [picking, setPicking] = useState(false);

  // See GameIdentityHeader's note: deliberately NOT STRUCTURE_QUERY, because the
  // standalone game routes don't mount `useRealtimeMembers`.
  const membersQ = trpc.tripMembers.list.useQuery({ tripId });
  const members = (membersQ.data ?? []) as {
    memberId: string;
    displayName: string;
    role: string;
    user?: { avatar_icon?: string | null } | null;
  }[];

  // Team colour per member. Two structural reads, both already cached on the
  // surfaces that host this control, so this is usually a cache hit rather than
  // two more requests.
  const teamsQ = trpc.teams.list.useQuery(
    { tripId, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!competitionId },
  );
  const assignmentsQ = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!competitionId },
  );
  const colorByTeam = new Map(
    ((teamsQ.data ?? []) as { id: string; color: string }[]).map((t) => [t.id, t.color]),
  );
  const colorByUser = new Map<string, string>();
  for (const a of (assignmentsQ.data ?? []) as { user_id: string; team_id: string }[]) {
    const c = colorByTeam.get(a.team_id);
    if (c) colorByUser.set(a.user_id, c);
  }

  const delegateId = value ?? null;
  // The trip Owner is the implicit assignee when nothing is set, and is removed
  // from the list entirely — assigning is "hand it to someone ELSE", and absence
  // already means the owner.
  const ownerMember = members.find((m) => m.role === "Owner");
  const ownerName = ownerMember?.displayName ?? "the owner";
  const assignable = members.filter((m) => m.memberId !== ownerMember?.memberId);
  const memberById = (id: string) => members.find((m) => m.memberId === id);

  const delegateName = delegateId
    ? delegateId === me?.id
      ? "you"
      : memberById(delegateId)?.displayName ?? "a delegate"
    : null;
  // Say the PERSON, not the role — "you" to the owner, the owner's name to
  // anyone else.
  const isOwnerViewer = !!me?.id && me.id === ownerMember?.memberId;
  const assignedLabel = delegateName ?? (isOwnerViewer ? "you" : ownerName);

  function assign(next: string | null) {
    setPicking(false);
    if (next === delegateId) return;
    onChange(next);
  }

  if (picking) {
    return (
      <div
        className="flex flex-col gap-1.5 rounded-xl p-2"
        style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
        data-testid="delegate-picker-panel"
      >
        {/* Header + close: with the owner gone from the list there's no "pick me"
            row to back out with, so the panel needs its own × (STYLE_GUIDE §5). */}
        <div className="flex items-center justify-between">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Assign to
          </span>
          <button
            type="button"
            onClick={() => setPicking(false)}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="assign-close"
          >
            <X size={16} />
          </button>
        </div>
        {assignable.map((m) => (
          <button
            key={m.memberId}
            type="button"
            onClick={() => assign(m.memberId)}
            className="@container flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm"
            style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text)" }}
            data-testid={`delegate-option-${m.memberId}`}
          >
            <Avatar
              name={m.displayName}
              avatarIcon={m.user?.avatar_icon ?? null}
              teamColor={colorByUser.get(m.memberId)}
              sizePx={28}
              collapse
              collapseAt="chip"
            />
            <span className="truncate">{m.displayName}</span>
          </button>
        ))}
        {assignable.length === 0 && (
          <span className="px-3 py-2 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            No crew to assign yet.
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { if (canAssign) setPicking(true); }}
      disabled={!canAssign}
      className="flex items-center gap-1.5 text-sm"
      style={{ color: "var(--color-bt-text-dim)" }}
      data-testid="game-assigned-to"
    >
      {delegateId ? (
        <Avatar
          name={assignedLabel}
          avatarIcon={memberById(delegateId)?.user?.avatar_icon ?? null}
          teamColor={colorByUser.get(delegateId)}
          sizePx={22}
        />
      ) : (
        <UserCircle2 size={14} style={{ color: "var(--color-bt-text-dim)" }} />
      )}
      <span>
        Assigned to{" "}
        <span style={{ color: delegateName ? "var(--color-bt-accent)" : "var(--color-bt-text)", fontWeight: 600 }}>
          {assignedLabel}
        </span>
      </span>
      {/* The × clears a real delegate (→ back to the owner). Absent when already
          the owner default — there's nothing to clear. */}
      {canAssign && delegateName && (
        <X
          size={13}
          style={{ color: "var(--color-bt-text-dim)" }}
          onClick={(e) => { e.stopPropagation(); assign(null); }}
        />
      )}
    </button>
  );
}
