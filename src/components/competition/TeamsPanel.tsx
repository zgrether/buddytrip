"use client";

import { useState, useMemo } from "react";
import {
  ArrowRight,
  GripVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { Avatar } from "@/components/Avatar";
import { TeamMemberChip } from "./TeamMemberChip";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
  /** When provided, the parent (CompTab) drives create state via the
   *  CompetitionHeader's +Team button. Local state is used as a
   *  fallback so this panel still works standalone. */
  creating?: boolean;
  onCreatingChange?: (v: boolean) => void;
  /**
   * Structure-lock (§9): once the competition is live the team *structure*
   * freezes — no add-team / remove-team / draft. Rename a team and swap a
   * player stay available (rename = day-one ritual, swap = admin tweak). It's a
   * structure lock, not a data lock — same builder, fewer affordances.
   */
  structureLocked?: boolean;
}

interface Team {
  id: string;
  name: string;
  short_name: string;
  color: string;
  color_dim: string;
}

interface Assignment {
  competition_id: string;
  user_id: string;
  team_id: string;
}

interface Member {
  user_id: string | null;
  memberId: string;
  displayName: string;
  isGuest?: boolean;
  user?: { avatar_icon?: string | null } | null;
}

// ── Team color palette (intentional team identity hex per STYLE_GUIDE §7) ───
const TEAM_COLORS: Array<{ color: string; colorDim: string; label: string }> = [
  { color: "#3b82f6", colorDim: "#0a1a2a", label: "Blue" },
  { color: "#22c55e", colorDim: "#0a2a0f", label: "Green" },
  { color: "#a855f7", colorDim: "#1a0a2a", label: "Purple" },
  { color: "#06b6d4", colorDim: "#0a1f2a", label: "Cyan" },
  { color: "#ef4444", colorDim: "#2a0a0a", label: "Red" },
  { color: "#f59e0b", colorDim: "#2a1f00", label: "Amber" },
  { color: "#ec4899", colorDim: "#2a0a1a", label: "Pink" },
  { color: "#f97316", colorDim: "#2a1200", label: "Orange" },
];

// ── Team name suggestion themes ────────────────────────────────────────────
// Tapping "✨ Suggest a name" reveals these as chips; tapping a chip rolls
// a random name from that theme into the field. Tapping the same chip
// again re-rolls — handy if the first pick is taken or doesn't fit.
const NAME_THEMES: Array<{ id: string; label: string; names: string[] }> = [
  {
    id: "colors",
    label: "Colors",
    names: [
      "Crimson", "Cobalt", "Amber", "Scarlet", "Jade",
      "Ivory", "Onyx", "Indigo", "Vermillion", "Sable",
    ],
  },
  {
    id: "animals",
    label: "Animals",
    names: [
      "Falcons", "Wolves", "Vipers", "Ravens", "Cobras",
      "Stallions", "Grizzlies", "Hawks", "Lynx", "Rhinos",
    ],
  },
  {
    id: "golf",
    label: "Golf",
    names: [
      "Birdies", "Eagles", "Bogeys", "Condors", "Aces",
      "Albatrosses", "Duffers", "Shanks", "Yips", "Scratch",
    ],
  },
  {
    id: "mythic",
    label: "Mythic",
    names: [
      "Titans", "Phoenix", "Spartans", "Vikings", "Pirates",
      "Centurions", "Krakens", "Valkyries", "Wyverns", "Gladiators",
    ],
  },
  {
    id: "cocktails",
    label: "Cocktails",
    names: [
      "Negronis", "Old Fashioneds", "Mojitos", "Manhattans", "Daiquiris",
      "Martinis", "Sazeracs", "Mules", "Margaritas", "Highballs",
    ],
  },
  {
    id: "weather",
    label: "Weather",
    names: [
      "Storm", "Lightning", "Thunder", "Hurricane", "Blizzard",
      "Squall", "Tempest", "Cyclone", "Tornado", "Avalanche",
    ],
  },
];

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

// Drag & drop dataTransfer key
const DND_USER_KEY = "application/x-buddytrip-user-id";

// ── Optimistic mutation hook ────────────────────────────────────────────────
// Both the drag-drop drop handler and the mobile crew roster talk to the
// same teamAssignments cache; this hook centralizes the onMutate cache
// patch + rollback so the avatar chip moves the instant the user drops or
// picks a team, not after the network roundtrip.

function useTeamAssignmentMutations(tripId: string, competitionId: string) {
  const utils = trpc.useUtils();
  const queryKey = { tripId, competitionId };

  const assign = trpc.teamAssignments.assign.useMutation({
    onMutate: async (vars) => {
      await utils.teamAssignments.list.cancel(queryKey);
      const previous = utils.teamAssignments.list.getData(queryKey);
      utils.teamAssignments.list.setData(queryKey, (old) => {
        const list = (old as Assignment[] | undefined) ?? [];
        // Composite PK is (competition_id, user_id) — drop any existing
        // row for this user before inserting the new pairing.
        const filtered = list.filter((a) => a.user_id !== vars.userId);
        return [
          ...filtered,
          {
            competition_id: vars.competitionId,
            user_id: vars.userId,
            team_id: vars.teamId,
          },
        ] as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctxRollback) => {
      if (ctxRollback?.previous) {
        utils.teamAssignments.list.setData(queryKey, ctxRollback.previous);
      }
    },
    onSettled: () => utils.teamAssignments.list.invalidate(queryKey),
  });

  const remove = trpc.teamAssignments.remove.useMutation({
    onMutate: async (vars) => {
      await utils.teamAssignments.list.cancel(queryKey);
      const previous = utils.teamAssignments.list.getData(queryKey);
      utils.teamAssignments.list.setData(queryKey, (old) => {
        const list = (old as Assignment[] | undefined) ?? [];
        return list.filter((a) => a.user_id !== vars.userId) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctxRollback) => {
      if (ctxRollback?.previous) {
        utils.teamAssignments.list.setData(queryKey, ctxRollback.previous);
      }
    },
    onSettled: () => utils.teamAssignments.list.invalidate(queryKey),
  });

  return { assign, remove };
}

// ── TeamsPanel ──────────────────────────────────────────────────────────────

export function TeamsPanel({
  competitionId,
  tripId,
  canEdit,
  creating: creatingProp,
  onCreatingChange,
  structureLocked = false,
}: Props) {
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [creatingLocal, setCreatingLocal] = useState(false);
  const creating = creatingProp ?? creatingLocal;
  const setCreating = (v: boolean) => {
    if (onCreatingChange) onCreatingChange(v);
    else setCreatingLocal(v);
  };

  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const teamsTyped = teams as Team[];
  const totalMembers = members.length;
  const assignedCount = assignments.length;
  const teamsExist = teamsTyped.length > 0;

  const statusText = !teamsExist
    ? "Not set up"
    : `${teamsTyped.length} team${teamsTyped.length === 1 ? "" : "s"} · ${assignedCount} of ${totalMembers} assigned`;

  return (
    <div
      data-testid="teams-panel"
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span style={{ color: "var(--color-bt-accent)" }} aria-hidden>
            <div className="flex items-center">
              <User size={14} />
              <ArrowRight size={11} className="mx-0.5" />
              <Users size={14} />
            </div>
          </span>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Team Rosters
            </p>
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {statusText}
            </p>
          </div>
        </div>
        {canEdit && !structureLocked && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            <Plus size={12} />
            Team
          </button>
        )}
        {canEdit && structureLocked && (
          // Live: the team structure is locked. Say so quietly — rename + swap
          // still work, so this explains the missing +Team rather than nagging.
          <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Teams locked — live
          </span>
        )}
      </div>

      {/* Content */}
      <div
        className="space-y-4 px-4 pb-4 pt-3"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        {!teamsExist && (
          <NoTeamsEmptyState
            canEdit={canEdit && !structureLocked}
            onAddTeam={() => setCreating(true)}
          />
        )}

        {teamsExist && (
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            {/* Crew roster: desktop column 1 (1/3 width) / mobile
                section below teams */}
            <CrewRoster
              tripId={tripId}
              competitionId={competitionId}
              members={members as Member[]}
              teams={teamsTyped}
              assignments={assignments as Assignment[]}
              canEdit={canEdit}
              order="lg-first"
            />

            {/* Teams column — 2/3 of the panel width on desktop */}
            <div>
              <div className="mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--color-bt-accent)" }}>
                    <Users size={12} />
                  </span>
                  <h4
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Teams
                  </h4>
                </div>
                {canEdit && (
                  // Hint refers to drag-drop, which only runs at lg+
                  // (mouse-capable widths) — hide on tablet/mobile where
                  // assignment happens via the dropdown.
                  <p
                    className="mt-0.5 hidden text-[10px] italic lg:block"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Drop a crew member here
                  </p>
                )}
              </div>
              <div className="space-y-3">
              {teamsTyped.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  members={members as Member[]}
                  assignments={assignments as Assignment[]}
                  canEdit={canEdit}
                  onEdit={() => setEditingTeam(team)}
                  tripId={tripId}
                  competitionId={competitionId}
                />
              ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {(creating || editingTeam) && (
        <TeamSheet
          tripId={tripId}
          competitionId={competitionId}
          team={editingTeam}
          structureLocked={structureLocked}
          existingTeamNames={teamsTyped.map((t) => t.name.toLowerCase())}
          onClose={() => {
            setCreating(false);
            setEditingTeam(null);
          }}
        />
      )}
    </div>
  );
}

// ── NoTeamsEmptyState ───────────────────────────────────────────────────────

function NoTeamsEmptyState({
  canEdit,
  onAddTeam,
}: {
  canEdit: boolean;
  onAddTeam: () => void;
}) {
  return (
    <div
      className="rounded-xl px-4 py-6 text-center"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <Users size={20} />
      </div>
      <p
        className="mt-3 text-sm font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        No teams yet
      </p>
      <p
        className="mt-1 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Add your first team to get started.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onAddTeam}
          className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          <Plus size={15} />
          Add Team
        </button>
      )}
    </div>
  );
}


// ── TeamCard (also a drop target on desktop) ────────────────────────────────

function TeamCard({
  team,
  members,
  assignments,
  canEdit,
  onEdit,
  tripId,
  competitionId,
}: {
  team: Team;
  members: Member[];
  assignments: Assignment[];
  canEdit: boolean;
  onEdit: () => void;
  tripId: string;
  competitionId: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  const teamMemberIds = assignments
    .filter((a) => a.team_id === team.id)
    .map((a) => a.user_id);
  const teamMembers = members.filter((m) =>
    teamMemberIds.includes(m.user_id ?? m.memberId)
  );

  // Optimistic — the dropped chip needs to land in the target team
  // instantly, not after the server round-trip. `remove` powers the
  // per-chip × button (Owner-only) inside the team card.
  const { assign, remove } = useTeamAssignmentMutations(tripId, competitionId);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const userId = e.dataTransfer.getData(DND_USER_KEY);
    if (!userId) return;
    assign.mutate({ tripId, competitionId, userId, teamId: team.id });
  }

  return (
    <div
      className="overflow-hidden rounded-xl transition-colors"
      style={{
        border: `${dragOver ? "1.5px" : "1px"} ${dragOver ? "dashed" : "solid"} ${
          dragOver ? team.color : `color-mix(in srgb, ${team.color} 35%, var(--color-bt-border))`
        }`,
      }}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={canEdit ? handleDrop : undefined}
      data-testid={`team-card-${team.id}`}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5"
        style={{
          background: dragOver
            ? `color-mix(in srgb, ${team.color} 14%, var(--color-bt-card-raised))`
            : `color-mix(in srgb, ${team.color} 8%, var(--color-bt-card-raised))`,
        }}
      >
        <span
          className="h-6 w-6 flex-shrink-0 rounded-full"
          style={{ background: team.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className="truncate text-sm font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {team.name}
            </p>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{
                background: "var(--color-bt-card)",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              {team.short_name}
            </span>
            <span className="ml-auto text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {teamMembers.length} member{teamMembers.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${team.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {/* Members area — chips sit directly on the team card, no inner box */}
      <div
        className="flex flex-wrap gap-2 px-3 pb-3 pt-2"
        style={{ minHeight: 40 }}
      >
        {teamMembers.length === 0 && (
          <p
            className="text-[11px] italic"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {canEdit ? (
              <>
                {/* Drag affordance lives on lg+ only — fall back to a
                    neutral phrase on touch widths (tablet + phone) */}
                <span className="hidden lg:inline">Drop a crew member here</span>
                <span className="lg:hidden">No members yet</span>
              </>
            ) : (
              "No members assigned"
            )}
          </p>
        )}
        {teamMembers.map((m) => {
          const id = m.user_id ?? m.memberId;
          return (
            <TeamMemberChip
              key={id}
              displayName={m.displayName}
              avatarIcon={m.user?.avatar_icon}
              isGuest={m.isGuest}
              teamColor={team.color}
              draggable={canEdit}
              onDragStart={
                canEdit
                  ? (e) => {
                      e.dataTransfer.setData(DND_USER_KEY, id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onRemove={
                // Swapping/unassigning a player is co-admin team-editing, not
                // competition-destructive — owner & co-admins both do it.
                canEdit
                  ? () => remove.mutate({ tripId, competitionId, userId: id })
                  : undefined
              }
              removeAriaLabel={`Remove ${m.displayName} from ${team.name}`}
            />
          );
        })}
      </div>

    </div>
  );
}

// ── DeleteTeamConfirmModal ──────────────────────────────────────────────────

function DeleteTeamConfirmModal({
  teamName,
  memberCount,
  isPending,
  onCancel,
  onConfirm,
}: {
  teamName: string;
  memberCount: number;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ScrollLock>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 text-center sm:text-left">
          <div
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
            style={{
              background: "var(--color-bt-danger-faint)",
              color: "var(--color-bt-danger)",
            }}
          >
            <Trash2 size={18} />
          </div>
          <h3
            className="mt-3 text-base font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Delete &ldquo;{teamName}&rdquo;?
          </h3>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {memberCount > 0
              ? `${memberCount} member${memberCount === 1 ? "" : "s"} will be unassigned. This can't be undone.`
              : "This can’t be undone."}
          </p>
        </div>
        <div
          className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end"
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--color-bt-danger)" }}
          >
            {isPending ? "Deleting…" : "Delete Team"}
          </button>
        </div>
      </div>
    </div>
    </ScrollLock>
  );
}

// ── CrewRoster ──────────────────────────────────────────────────────────────
//
// Desktop column (lg+) shows ONLY unassigned members as draggable
// cards — native HTML5 drag requires pointer events, so this layout is
// gated to mouse-capable widths. Tablets and phones (below lg) get the
// touch-friendly dropdown picker; once a member gets assigned they fade
// + collapse out of the list (managed below via the team cards). A
// short-lived "leaving" set keeps the row mounted during the exit
// animation so the disappearance isn't jarring.

function CrewRoster({
  tripId,
  competitionId,
  members,
  teams,
  assignments,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  members: Member[];
  teams: Team[];
  assignments: Assignment[];
  canEdit: boolean;
  /** Reserved for future ordering tweaks; currently every layout puts the
   *  roster panel before the teams column on lg+. */
  order?: "lg-first";
}) {
  const assignmentByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignments) map.set(a.user_id, a.team_id);
    return map;
  }, [assignments]);

  const unassigned = members.filter(
    (m) => !assignmentByUser.has(m.user_id ?? m.memberId)
  );

  const { assign, remove } = useTeamAssignmentMutations(tripId, competitionId);
  const [dragOver, setDragOver] = useState(false);

  // Mobile exit animation — when a member is assigned via the dropdown,
  // their row needs to disappear from the unassigned list. To avoid the
  // jarring "pop", we keep them mounted in a "leaving" state for a few
  // hundred ms, fading + collapsing them out before the unmount.
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());

  function handleAssignFromMobile(memberId: string, teamId: string) {
    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.add(memberId);
      return next;
    });
    assign.mutate({ tripId, competitionId, userId: memberId, teamId });
    window.setTimeout(() => {
      setLeavingIds((prev) => {
        if (!prev.has(memberId)) return prev;
        const next = new Set(prev);
        next.delete(memberId);
        return next;
      });
    }, 320);
  }

  function handleDropToUnassign(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const userId = e.dataTransfer.getData(DND_USER_KEY);
    if (!userId) return;
    // No-op if dragging the same already-unassigned card back into the column.
    if (!assignmentByUser.has(userId)) return;
    remove.mutate({ tripId, competitionId, userId });
  }

  // Mobile list = unassigned members, plus any currently mid-animation.
  const mobileVisible = members.filter((m) => {
    const id = m.user_id ?? m.memberId;
    return !assignmentByUser.has(id) || leavingIds.has(id);
  });

  return (
    <>
      {/* ── Desktop column: drag-and-drop unassigned roster ─────────── */}
      <section className="hidden lg:block" style={{ alignSelf: "start" }}>
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--color-bt-accent)" }}>
              <User size={12} />
            </span>
            <h4
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Unassigned Crew
            </h4>
          </div>
          {canEdit && (
            <p
              className="mt-0.5 text-[10px] italic"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Drag onto a team to assign
            </p>
          )}
        </div>
        <div
          className="rounded-xl p-3 transition-colors"
          style={{
            background: "transparent",
            border: `${dragOver ? "1.5px" : "1px"} dashed ${
              dragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"
            }`,
          }}
          onDragOver={
            canEdit
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOver(true);
                }
              : undefined
          }
          onDragLeave={canEdit ? () => setDragOver(false) : undefined}
          onDrop={canEdit ? handleDropToUnassign : undefined}
        >
        {unassigned.length === 0 ? (
          <p
            className="text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {canEdit
              ? "Everyone’s on a team. Drop here to unassign."
              : "Everyone’s on a team."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {unassigned.map((m) => {
              const id = m.user_id ?? m.memberId;
              return (
                <div
                  key={id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_USER_KEY, id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="flex cursor-grab items-center gap-2 rounded-lg px-3 py-2 active:cursor-grabbing"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <GripVertical
                    size={14}
                    className="flex-shrink-0"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  />
                  <Avatar
                    name={m.displayName}
                    avatarIcon={m.user?.avatar_icon ?? null}
                    size="md"
                  />
                  <span
                    className="truncate text-sm"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {m.displayName}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </section>

      {/* ── Mobile fallback: unassigned members only, with team picker.
           Assigned members get managed via the team cards above. ── */}
      <div className="lg:hidden">
        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Unassigned Crew
        </p>
        {mobileVisible.length === 0 ? (
          <p
            className="text-[11px] italic"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Everyone&rsquo;s on a team. Manage assignments from the team
            cards.
          </p>
        ) : (
          <div className="space-y-1.5">
            {mobileVisible.map((m) => {
              const id = m.user_id ?? m.memberId;
              const leaving = leavingIds.has(id);
              return (
                <div
                  key={id}
                  className="overflow-hidden transition-all ease-out"
                  style={{
                    transitionDuration: "280ms",
                    opacity: leaving ? 0 : 1,
                    maxHeight: leaving ? 0 : 64,
                    marginTop: leaving ? 0 : undefined,
                    transform: leaving ? "scale(0.98)" : "scale(1)",
                  }}
                >
                  <div
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    <Avatar
                      name={m.displayName}
                      avatarIcon={m.user?.avatar_icon ?? null}
                      size="md"
                    />
                    <span
                      className="flex-1 truncate text-sm font-medium"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {m.displayName}
                    </span>
                    <select
                      value=""
                      disabled={!canEdit || leaving}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        handleAssignFromMobile(id, value);
                      }}
                      className="rounded-md px-2 py-1 text-xs"
                      style={{
                        background: "var(--color-bt-card)",
                        color: "var(--color-bt-text-dim)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                      aria-label={`Team for ${m.displayName}`}
                    >
                      <option value="">Pick a team…</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── TeamSheet (create + edit) ───────────────────────────────────────────────

function TeamSheet({
  tripId,
  competitionId,
  team,
  structureLocked = false,
  existingTeamNames,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  team: Team | null;
  /** Live structure-lock (§9): hide the delete-team affordance (rename stays). */
  structureLocked?: boolean;
  /** Lowercased names of teams already in this competition — used to skip
   *  collisions when rolling a name from a theme. The current team's own
   *  name is excluded by the caller in edit mode. */
  existingTeamNames: string[];
  onClose: () => void;
}) {
  const isEdit = !!team;
  const utils = trpc.useUtils();

  const [name, setName] = useState(team?.name ?? "");
  const [shortName, setShortName] = useState(team?.short_name ?? "");
  const [shortNameDirty, setShortNameDirty] = useState(isEdit);
  const [paletteIdx, setPaletteIdx] = useState(() => {
    if (!team) return 0;
    const idx = TEAM_COLORS.findIndex((c) => c.color === team.color);
    return idx >= 0 ? idx : 0;
  });
  const [suggesterOpen, setSuggesterOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Snapshot member count for the confirm dialog before delete fires.
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId },
    { enabled: isEdit && !structureLocked }
  );
  const memberCount = team
    ? (assignments as Assignment[]).filter((a) => a.team_id === team.id).length
    : 0;

  const create = trpc.teams.create.useMutation({
    onSettled: () => utils.teams.list.invalidate({ tripId, competitionId }),
  });
  const update = trpc.teams.update.useMutation({
    onSettled: () => utils.teams.list.invalidate({ tripId, competitionId }),
  });
  const deleteTeam = trpc.teams.delete.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate({ tripId, competitionId });
      utils.teamAssignments.list.invalidate({ tripId, competitionId });
    },
    onSuccess: () => {
      setConfirmingDelete(false);
      onClose();
    },
  });

  function handleNameChange(value: string) {
    setName(value);
    // Auto-derive short_name from the first 3 chars until the user takes
    // manual control of the short name field.
    if (!shortNameDirty) {
      setShortName(value.replace(/\s+/g, "").slice(0, 3).toUpperCase());
    }
    // Once the user starts typing manually, collapse the suggester so it
    // doesn't sit there competing for attention.
    if (value.trim() && suggesterOpen) {
      setSuggesterOpen(false);
    }
  }

  function handlePickTheme(themeId: string) {
    const theme = NAME_THEMES.find((t) => t.id === themeId);
    if (!theme) return;
    // Filter out names already used by other teams in this competition so
    // a re-roll doesn't keep landing on the same conflict. Fall back to the
    // full list if every name in the theme is taken.
    const taken = new Set(existingTeamNames);
    const available = theme.names.filter((n) => !taken.has(n.toLowerCase()));
    const suggestion = pickRandom(available.length > 0 ? available : theme.names);
    setName(suggestion);
    if (!shortNameDirty) {
      setShortName(suggestion.replace(/\s+/g, "").slice(0, 3).toUpperCase());
    }
  }

  async function handleSave() {
    setError(null);
    const trimmed = name.trim();
    const sn = shortName.trim().toUpperCase();
    if (!trimmed) return setError("Team name is required");
    if (!sn) return setError("Short name is required");
    if (sn.length > 4) return setError("Short name must be 4 characters or fewer");

    const palette = TEAM_COLORS[paletteIdx];
    try {
      if (isEdit && team) {
        await update.mutateAsync({
          tripId,
          teamId: team.id,
          name: trimmed,
          shortName: sn,
          color: palette.color,
          colorDim: palette.colorDim,
        });
      } else {
        await create.mutateAsync({
          tripId,
          competitionId,
          name: trimmed,
          shortName: sn,
          color: palette.color,
          colorDim: palette.colorDim,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save team");
    }
  }

  return (
    <ScrollLock>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {isEdit ? "Edit Team" : "Add Team"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <Field label="Team Name" required>
            <input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Team Hammer"
              maxLength={100}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
              data-testid="team-name-input"
            />
            {!suggesterOpen && !name.trim() && (
              <button
                type="button"
                onClick={() => setSuggesterOpen(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium"
                style={{ color: "var(--color-bt-accent)" }}
                data-testid="team-name-suggest"
              >
                <Sparkles size={11} />
                Suggest a name
              </button>
            )}
            {suggesterOpen && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p
                    className="text-[11px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    Pick a theme — tap again to re-roll
                  </p>
                  <button
                    type="button"
                    onClick={() => setSuggesterOpen(false)}
                    aria-label="Close suggester"
                    className="flex h-5 w-5 items-center justify-center rounded"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <X size={11} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {NAME_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handlePickTheme(t.id)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-accent)",
                        border: "1px solid var(--color-bt-accent-border)",
                      }}
                      data-testid={`team-name-theme-${t.id}`}
                    >
                      <Sparkles size={10} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          <Field label="Short Name" required helper="Used on scorecards — e.g. USA, EUR, FIRE">
            <input
              value={shortName}
              onChange={(e) => {
                setShortName(e.target.value.toUpperCase());
                setShortNameDirty(true);
              }}
              placeholder="HAM"
              maxLength={4}
              className="w-full rounded-lg px-3 py-2 text-sm uppercase outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {TEAM_COLORS.map((c, i) => (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => setPaletteIdx(i)}
                  aria-label={`${c.label}${paletteIdx === i ? " (selected)" : ""}`}
                  className="h-8 w-8 rounded-full transition-transform"
                  style={{
                    background: c.color,
                    transform: paletteIdx === i ? "scale(1.15)" : "scale(1)",
                    border:
                      paletteIdx === i
                        ? "2px solid var(--color-bt-text)"
                        : "1px solid var(--color-bt-border)",
                  }}
                />
              ))}
            </div>
          </Field>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            {isEdit && !structureLocked && team && (
              // Delete-team is co-admin team-editing (reaching this sheet already
              // requires edit access) — not competition-destructive. Hidden once
              // live: removing a team is a structure change (§9).
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Delete ${team.name}`}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: "transparent",
                  color: "var(--color-bt-danger)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={create.isPending || update.isPending}
              className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              {isEdit ? "Save Team" : "Add Team"}
            </button>
          </div>
        </div>

        {confirmingDelete && team && (
          <DeleteTeamConfirmModal
            teamName={team.name}
            memberCount={memberCount}
            isPending={deleteTeam.isPending}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() => deleteTeam.mutate({ tripId, teamId: team.id })}
          />
        )}
      </div>
    </div>
    </ScrollLock>
  );
}

// ── Field ───────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </label>
        {required && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            required
          </span>
        )}
      </div>
      {children}
      {helper && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {helper}
        </p>
      )}
    </div>
  );
}
