"use client";

import { useState, useMemo } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { Avatar } from "@/components/Avatar";
import { isTeamCaptain, useCanEditTeam } from "@/hooks/useCanEditTeam";

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
  /**
   * Embedded mode: the panel is hosted inside the Rosters overlay (W-TEAMSURFACE-01),
   * which already supplies the card chrome + "Rosters" title. Drop the bordered
   * wrapper + the redundant section title; keep the status + add-team toolbar.
   */
  embedded?: boolean;
}

export interface Team {
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
  is_captain?: boolean;
  sort_order?: number;
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
    onSettled: () => {
      utils.teamAssignments.list.invalidate(queryKey);
      // The leaderboard roll-up derives per_match points from TEAM SIZES, so a
      // (re)assignment moves pointsAvailable / winNumber. The board reads the
      // bootstrap-seeded competitions.leaderboard cache — invalidate it too so
      // the leaderboard reflects the change without a hard refresh.
      utils.competitions.leaderboard.invalidate(queryKey);
      // faceBootstrap ALSO seeds teamAssignments.list (#10): the consolidated
      // TeamSheet opens OUTSIDE the LiveFace re-seed path, so re-resolve the
      // bootstrap or the board reads stale until the 30s poll. (setCaptain already
      // does this; assign/remove/reorder carry it too for consistency.)
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
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
    onSettled: () => {
      utils.teamAssignments.list.invalidate(queryKey);
      // Removing a player changes team sizes → the leaderboard roll-up's
      // per_match points. Refresh the board's seeded cache (see `assign`).
      utils.competitions.leaderboard.invalidate(queryKey);
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  // reorder (Part 3) — optimistic: rewrite sort_order for this team per the new
  // order; other teams untouched. The roster lists derive display order from
  // sort_order, so the rows resequence instantly. faceBootstrap seeds the list,
  // so re-resolve it (#10) — the order survives an overlay/modal close + reopen.
  const reorder = trpc.teamAssignments.reorder.useMutation({
    onMutate: async (vars) => {
      await utils.teamAssignments.list.cancel(queryKey);
      const previous = utils.teamAssignments.list.getData(queryKey);
      const orderIndex = new Map(vars.orderedUserIds.map((id, i) => [id, i]));
      utils.teamAssignments.list.setData(queryKey, (old) => {
        const list = (old as Assignment[] | undefined) ?? [];
        return list.map((a) =>
          a.team_id === vars.teamId && orderIndex.has(a.user_id)
            ? { ...a, sort_order: orderIndex.get(a.user_id)! }
            : a
        ) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctxRollback) => {
      if (ctxRollback?.previous) {
        utils.teamAssignments.list.setData(queryKey, ctxRollback.previous);
      }
    },
    onSettled: () => {
      utils.teamAssignments.list.invalidate(queryKey);
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  // setCaptain (PR b) — optimistic: the target gets the flag; any other captain
  // on the SAME team is cleared (one-per-team). faceBootstrap also seeds
  // teamAssignments.list, so re-resolve it (#10) — the captain survives an
  // overlay close/reopen, not just the live optimistic state.
  const setCaptain = trpc.teamAssignments.setCaptain.useMutation({
    onMutate: async (vars) => {
      await utils.teamAssignments.list.cancel(queryKey);
      const previous = utils.teamAssignments.list.getData(queryKey);
      utils.teamAssignments.list.setData(queryKey, (old) => {
        const list = (old as Assignment[] | undefined) ?? [];
        return list.map((a) => {
          if (a.team_id !== vars.teamId) return a;
          if (a.user_id === vars.userId) return { ...a, is_captain: vars.isCaptain };
          return a.is_captain ? { ...a, is_captain: false } : a;
        }) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctxRollback) => {
      if (ctxRollback?.previous) {
        utils.teamAssignments.list.setData(queryKey, ctxRollback.previous);
      }
    },
    onSettled: () => {
      utils.teamAssignments.list.invalidate(queryKey);
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  return { assign, remove, setCaptain, reorder };
}

// ── TeamsPanel ──────────────────────────────────────────────────────────────

export function TeamsPanel({
  competitionId,
  tripId,
  canEdit,
  creating: creatingProp,
  onCreatingChange,
  structureLocked = false,
  embedded = false,
}: Props) {
  const utils = trpc.useUtils();
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
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
  // Roster-removal lock: once any game has a score, removals/trades/team-deletes are
  // server-blocked (C1). Disable those controls here so the block isn't a surprise;
  // ADDS stay enabled. (Distinct from `structureLocked`/go-live.)
  const { data: removalsLocked = false } = trpc.teamAssignments.rosterLocked.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  // The viewer — to resolve "is the captain of THIS team" for identity editing
  // (PR b2). canEdit is the owner (structure); identity opens to owner OR captain.
  const { data: me } = trpc.users.getMe.useQuery();

  const teamsTyped = teams as Team[];
  const assignmentsTyped = assignments as Assignment[];
  const totalMembers = members.length;
  const assignedCount = assignments.length;
  const teamsExist = teamsTyped.length > 0;

  // Identity edit (name/short/color) inside the overlay = owner OR the captain of
  // THAT team — gates the per-card pencil/header (PR b2). The leaderboard
  // team-name tap opens a STANDALONE editor instead (CompetitionFace), so the
  // overlay only edits via its own pencil.
  // Identity edit = owner (canEdit prop) OR the captain of THAT team. Routes
  // through the shared isTeamCaptain so the captain rule lives in one place
  // (Part 1 dedup) — TeamsPanel maps over teams, so it uses the predicate (not
  // the useCanEditTeam hook, which React forbids calling per row).
  const canEditIdentity = (teamId: string) => canEdit || isTeamCaptain(assignmentsTyped, me?.id, teamId);

  const statusText = !teamsExist
    ? "Not set up"
    : `${teamsTyped.length} team${teamsTyped.length === 1 ? "" : "s"} · ${assignedCount} of ${totalMembers} assigned`;

  // List-level delete (W-TEAMDEL-01): the delete affordance lives on each team
  // card, NOT buried in the edit modal. Lifted here so one confirm + mutation
  // serves the whole list. Same invalidations the edit modal used.
  const deleteTeam = trpc.teams.delete.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate({ tripId, competitionId });
      utils.teamAssignments.list.invalidate({ tripId, competitionId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    },
    onSuccess: () => setDeletingTeam(null),
  });
  const deletingMemberCount = deletingTeam
    ? (assignments as Assignment[]).filter((a) => a.team_id === deletingTeam.id).length
    : 0;

  return (
    <div
      data-testid="teams-panel"
      className={embedded ? "" : "overflow-hidden rounded-xl"}
      style={embedded ? undefined : { border: "1px solid var(--color-bt-border)" }}
    >
      {/* Header — full section header standalone; a slim status+add toolbar when
          embedded in the Rosters overlay (which owns the title). */}
      <div className={`flex items-center justify-between px-4 ${embedded ? "pt-1 pb-3" : "py-3"}`}>
        {embedded ? (
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {statusText}
          </p>
        ) : (
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
        )}
        {canEdit && !structureLocked && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
            data-testid="teams-add"
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
        className={`space-y-4 px-4 pb-4 ${embedded ? "" : "pt-3"}`}
        style={embedded ? undefined : { borderTop: "1px solid var(--color-bt-border)" }}
      >
        {canEdit && removalsLocked && (
          // Quiet explanation, not an alarm — the controls below are disabled, this
          // says why. Adds stay live.
          <p
            className="rounded-lg px-3 py-2 text-[11px]"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
            data-testid="rosters-locked-note"
          >
            Scoring has started — rosters are locked for removals. You can still add players.
          </p>
        )}
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
                  canEditIdentity={canEditIdentity(team.id)}
                  structureLocked={structureLocked}
                  removalsLocked={removalsLocked}
                  onEdit={() => setEditingTeam(team)}
                  onDelete={() => setDeletingTeam(team)}
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
          existingTeamNames={teamsTyped.map((t) => t.name.toLowerCase())}
          // Inside the Rosters overlay the team CARD already owns roster mgmt, so
          // the per-card pencil opens identity-only. The consolidated roster
          // section lives on the STANDALONE TeamSheet (leaderboard short-name tap).
          showRoster={false}
          onClose={() => {
            setCreating(false);
            setEditingTeam(null);
          }}
        />
      )}

      {deletingTeam && (
        <DeleteTeamConfirmModal
          teamName={deletingTeam.name}
          memberCount={deletingMemberCount}
          isPending={deleteTeam.isPending}
          onCancel={() => setDeletingTeam(null)}
          onConfirm={() => deleteTeam.mutate({ tripId, teamId: deletingTeam.id })}
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
  canEditIdentity,
  structureLocked,
  removalsLocked,
  onEdit,
  onDelete,
  tripId,
  competitionId,
}: {
  team: Team;
  members: Member[];
  assignments: Assignment[];
  /** STRUCTURE (owner): drag/remove players, delete team, set captain ★. */
  canEdit: boolean;
  /** IDENTITY (owner OR this team's captain): tap the header to edit name/short/
   *  color (PR b2). A captain edits ONLY their own team's identity. */
  canEditIdentity: boolean;
  structureLocked: boolean;
  /** Scoring has started → removals/trades/team-delete are blocked (C1). Disables
   *  the per-player ×, the move-drag, and the team-delete trash; adds stay live. */
  removalsLocked: boolean;
  onEdit: () => void;
  onDelete: () => void;
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

  // Optimistic — the dropped player needs to land in the target team
  // instantly, not after the server round-trip. `remove` powers the
  // per-row × button; `setCaptain` powers the ★ (owner only).
  const { assign, remove, setCaptain } = useTeamAssignmentMutations(tripId, competitionId);

  const captainOf = (userId: string) =>
    assignments.find((a) => a.user_id === userId && a.team_id === team.id)?.is_captain ?? false;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const userId = e.dataTransfer.getData(DND_USER_KEY);
    if (!userId) return;
    assign.mutate({ tripId, competitionId, userId, teamId: team.id });
  }

  const headerBg = {
    background: dragOver
      ? `color-mix(in srgb, ${team.color} 14%, var(--color-bt-card-raised))`
      : `color-mix(in srgb, ${team.color} 8%, var(--color-bt-card-raised))`,
  };

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
      {/* Header — the team identity is tap-to-edit for the owner (W-TEAMTAP-01):
          the whole name area is a button with a pencil cue, not a buried icon.
          Delete is a sibling list-level affordance (W-TEAMDEL-01), not inside the
          edit modal. */}
      <div className="flex items-center gap-1 px-3 py-2.5" style={headerBg}>
        {canEditIdentity ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${team.name}`}
            className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-opacity hover:opacity-80"
            data-testid={`team-edit-${team.id}`}
          >
            <span className="h-6 w-6 flex-shrink-0 rounded-full" style={{ background: team.color }} aria-hidden />
            <span className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {team.name}
            </span>
            <span
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
            >
              {team.short_name}
            </span>
            <Pencil size={12} className="flex-shrink-0 opacity-60 group-hover:opacity-100" style={{ color: "var(--color-bt-accent)" }} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1">
            <span className="h-6 w-6 flex-shrink-0 rounded-full" style={{ background: team.color }} aria-hidden />
            <span className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {team.name}
            </span>
            <span
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
            >
              {team.short_name}
            </span>
          </div>
        )}
        <span className="flex-shrink-0 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {teamMembers.length}
        </span>
        {canEdit && !structureLocked && !removalsLocked && (
          // Delete-team lives at the list level (W-TEAMDEL-01). Hidden once live OR
          // once scoring starts — deleting a team is a mass removal (the locked note
          // above explains it).
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${team.name}`}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-danger)" }}
            data-testid={`team-delete-${team.id}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Members — full-width player rows (W-TEAMBUILD-01), via the Avatar
          team-color disc. A row is the drag source (owner, desktop); its × is
          the per-player remove. The captain ★ slot lands here in PR (b). */}
      <div className="space-y-1.5 px-3 pb-3 pt-1" style={{ minHeight: 40 }}>
        {teamMembers.length === 0 && (
          <p className="px-1 py-1.5 text-[11px] italic" style={{ color: "var(--color-bt-text-dim)" }}>
            {canEdit ? (
              <>
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
          const isCaptain = captainOf(id);
          return (
            <PlayerRow
              key={id}
              name={m.displayName}
              avatarIcon={m.user?.avatar_icon ?? null}
              teamColor={team.color}
              // Dragging an assigned player = a MOVE/trade → disabled once removals lock.
              draggable={canEdit && !removalsLocked}
              isCaptain={isCaptain}
              onDragStart={
                canEdit && !removalsLocked
                  ? (e) => {
                      e.dataTransfer.setData(DND_USER_KEY, id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onRemove={canEdit ? () => remove.mutate({ tripId, competitionId, userId: id }) : undefined}
              removeLocked={removalsLocked}
              removeAriaLabel={`Remove ${m.displayName} from ${team.name}`}
              // Owner sets captain (PR b); members see the filled ★ read-only.
              onToggleCaptain={
                canEdit
                  ? () => setCaptain.mutate({ tripId, competitionId, teamId: team.id, userId: id, isCaptain: !isCaptain })
                  : undefined
              }
              captainAriaLabel={isCaptain ? `Remove ${m.displayName} as captain` : `Make ${m.displayName} captain`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── PlayerRow ───────────────────────────────────────────────────────────────
// Full-width player card (W-TEAMBUILD-01): the team-color Avatar disc (R3) + name
// + captain ★ + (owner) remove. Draggable for the desktop assign-by-drag flow.

function PlayerRow({
  name,
  avatarIcon,
  teamColor,
  draggable,
  isCaptain,
  onDragStart,
  onRemove,
  removeLocked = false,
  removeAriaLabel,
  onToggleCaptain,
  captainAriaLabel,
}: {
  name: string;
  avatarIcon: string | null;
  teamColor: string;
  draggable: boolean;
  isCaptain: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onRemove?: () => void;
  /** Scoring started → the × is shown DISABLED (with a why-tooltip), not hidden. */
  removeLocked?: boolean;
  removeAriaLabel: string;
  /** Owner-only: tap the ★ to mark/unmark captain. Absent for members. */
  onToggleCaptain?: () => void;
  captainAriaLabel: string;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      {draggable && (
        <GripVertical size={14} className="hidden flex-shrink-0 lg:block" style={{ color: "var(--color-bt-text-dim)" }} />
      )}
      <Avatar name={name} avatarIcon={avatarIcon} teamColor={teamColor} sizePx={28} />
      <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
        {name}
      </span>

      {/* Captain ★ — owner taps to mark/unmark (filled = captain, outline = not);
          a member sees only the filled ★ on the captain, read-only. One per team
          (the server clears the prior). */}
      {onToggleCaptain ? (
        <button
          type="button"
          onClick={onToggleCaptain}
          aria-label={captainAriaLabel}
          aria-pressed={isCaptain}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ color: isCaptain ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          data-testid="captain-toggle"
        >
          <Star size={15} fill={isCaptain ? "currentColor" : "none"} />
        </button>
      ) : (
        isCaptain && (
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center"
            style={{ color: "var(--color-bt-accent)" }}
            aria-label={`${name} is captain`}
            title="Captain"
          >
            <Star size={15} fill="currentColor" />
          </span>
        )
      )}

      {onRemove && (
        <button
          type="button"
          onClick={removeLocked ? undefined : onRemove}
          disabled={removeLocked}
          aria-label={removeAriaLabel}
          title={removeLocked ? "Locked — scoring has started. You can still add players." : undefined}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>
      )}
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
// Exported so the leaderboard team-name tap can open it STANDALONE (PR b2
// follow-up) — owner / captain-of-that-team edit a team's identity without the
// full Rosters overlay. The update mutation is captain-gated server-side.

export function TeamSheet({
  tripId,
  competitionId,
  team,
  existingTeamNames,
  showRoster = true,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  team: Team | null;
  /** Lowercased names of teams already in this competition — used to skip
   *  collisions when rolling a name from a theme. The current team's own
   *  name is excluded by the caller in edit mode. */
  existingTeamNames: string[];
  /** Render the consolidated roster section (edit mode only). Default true —
   *  the STANDALONE TeamSheet (leaderboard short-name tap) is the full
   *  team-management home. The in-overlay per-card pencil passes false: the
   *  team card already owns roster mgmt there. */
  showRoster?: boolean;
  onClose: () => void;
}) {
  const isEdit = !!team;
  const utils = trpc.useUtils();

  // Three-tier gating (mirrors the server). IDENTITY (name/short/color) = owner
  // OR this team's captain; ROSTER (add/remove/reorder/captain) = owner only.
  // Create mode has no team yet — only the owner can reach it (the opener gates),
  // so identity is editable there.
  const { canEdit: canEditIdentity, isOwner } = useCanEditTeam(
    tripId,
    competitionId,
    team?.id ?? null
  );
  const identityEditable = isEdit ? canEditIdentity : true;

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

  // Roster section data (edit mode). Deduped against any other observer of the
  // same query keys (the Rosters overlay / leaderboard), so these are cache hits.
  const { data: rosterMembers = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: isEdit && showRoster }
  );
  const { data: rosterAssignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId },
    { enabled: isEdit && showRoster && !!competitionId }
  );

  // The leaderboard roll-up (competitions.leaderboard) bakes in each team's
  // color / name / short_name, and the board renders from that bootstrap-seeded
  // cache — NOT teams.list. So every team mutation must invalidate the
  // leaderboard too, or the board shows stale colors/names until a hard refresh
  // (the reported bug). teams.list stays invalidated for the teams panel + guide.
  const create = trpc.teams.create.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate({ tripId, competitionId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    },
  });
  const update = trpc.teams.update.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate({ tripId, competitionId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
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
              disabled={!identityEditable}
              readOnly={!identityEditable}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-70"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
              data-testid="team-name-input"
            />
            {identityEditable && !suggesterOpen && !name.trim() && (
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
              disabled={!identityEditable}
              readOnly={!identityEditable}
              className="w-full rounded-lg px-3 py-2 text-sm uppercase outline-none disabled:opacity-70"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          {/* Color — a PICKER only when identity is editable (owner / captain).
              A read-only viewer (plain member) sees the team's color as a static
              swatch, never a picker (spec: member = no color picker). */}
          {identityEditable ? (
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
          ) : (
            team && (
              <Field label="Color">
                <span
                  className="inline-block h-7 w-7 rounded-full"
                  style={{ background: team.color, border: "1px solid var(--color-bt-border)" }}
                  aria-label="Team color"
                />
              </Field>
            )
          )}

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}

          {identityEditable && (
            <button
              type="button"
              onClick={handleSave}
              disabled={create.isPending || update.isPending}
              className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              {isEdit ? "Save Team" : "Add Team"}
            </button>
          )}

          {/* Consolidated roster section — the team-management home (edit mode).
              Owner gets full controls; captain/member see it read-only. */}
          {isEdit && showRoster && team && (
            <TeamSheetRoster
              tripId={tripId}
              competitionId={competitionId}
              team={team}
              canManage={isOwner}
              members={rosterMembers as Member[]}
              assignments={rosterAssignments as Assignment[]}
            />
          )}
        </div>
      </div>
    </div>
    </ScrollLock>
  );
}

// ── TeamSheetRoster ─────────────────────────────────────────────────────────
// The consolidated roster section of the STANDALONE Edit Team modal: this team's
// players in CANONICAL order (sort_order). Owner (canManage) gets add / remove /
// reorder / captain ★. Captain + plain member see it READ-ONLY (names + the
// captain ★). Reorder is ↑↓ buttons (mobile-first — they work on touch, which
// native HTML5 drag does not) PLUS grip-drag on desktop (lg+), mirroring this
// file's desktop-drag / mobile-fallback pattern.

function TeamSheetRoster({
  tripId,
  competitionId,
  team,
  canManage,
  members,
  assignments,
}: {
  tripId: string;
  competitionId: string;
  team: Team;
  /** Owner only — roster mutations (add/remove/reorder/captain) stay owner-scoped. */
  canManage: boolean;
  members: Member[];
  assignments: Assignment[];
}) {
  const { assign, remove, setCaptain, reorder } = useTeamAssignmentMutations(
    tripId,
    competitionId
  );
  // Removals are server-blocked once scoring starts (C1) — disable the × so it
  // isn't a surprise. Adds + reorder stay live (reorder orphans no one).
  const { data: removalsLocked = false } = trpc.teamAssignments.rosterLocked.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const memberById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.user_id ?? m.memberId, m);
    return map;
  }, [members]);

  // This team's roster in canonical order — sorted defensively by sort_order in
  // case the cache array isn't pre-sorted (optimistic patches mutate sort_order,
  // not array position).
  const roster = useMemo(
    () =>
      assignments
        .filter((a) => a.team_id === team.id)
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [assignments, team.id]
  );
  const orderedIds = roster.map((a) => a.user_id);

  const unassigned = useMemo(() => {
    const assignedIds = new Set(assignments.map((a) => a.user_id));
    return members.filter((m) => !assignedIds.has(m.user_id ?? m.memberId));
  }, [members, assignments]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function moveTo(userId: string, toIndex: number) {
    if (toIndex < 0 || toIndex >= orderedIds.length) return;
    const without = orderedIds.filter((x) => x !== userId);
    without.splice(toIndex, 0, userId);
    if (without.every((id, i) => id === orderedIds[i])) return; // no-op
    reorder.mutate({ tripId, competitionId, teamId: team.id, orderedUserIds: without });
  }

  return (
    <div
      data-testid="teamsheet-roster"
      className="pt-2"
      style={{ borderTop: "1px solid var(--color-bt-border)" }}
    >
      <h4
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Roster · {roster.length}
      </h4>

      {roster.length === 0 ? (
        <p
          className="rounded-lg px-3 py-2 text-[11px] italic"
          style={{
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text-dim)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          No players yet.{canManage ? " Add from the crew below." : ""}
        </p>
      ) : (
        <div className="space-y-1.5">
          {roster.map((a, i) => {
            const m = memberById.get(a.user_id);
            const name = m?.displayName ?? "Unknown";
            return (
              <RosterRow
                key={a.user_id}
                name={name}
                avatarIcon={m?.user?.avatar_icon ?? null}
                teamColor={team.color}
                isCaptain={!!a.is_captain}
                canManage={canManage}
                index={i}
                count={orderedIds.length}
                removeLocked={removalsLocked}
                onMoveUp={() => moveTo(a.user_id, i - 1)}
                onMoveDown={() => moveTo(a.user_id, i + 1)}
                onRemove={() => remove.mutate({ tripId, competitionId, userId: a.user_id })}
                onToggleCaptain={() =>
                  setCaptain.mutate({
                    tripId,
                    competitionId,
                    teamId: team.id,
                    userId: a.user_id,
                    isCaptain: !a.is_captain,
                  })
                }
                removeAriaLabel={`Remove ${name} from ${team.name}`}
                captainAriaLabel={a.is_captain ? `Remove ${name} as captain` : `Make ${name} captain`}
                onDragStart={canManage ? () => setDragId(a.user_id) : undefined}
                onDropRow={
                  canManage
                    ? () => {
                        if (dragId) moveTo(dragId, i);
                        setDragId(null);
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      {/* Add player (owner) — assign an unassigned crew member to THIS team. */}
      {canManage && unassigned.length > 0 && (
        <div className="mt-2">
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
              style={{ color: "var(--color-bt-accent)" }}
              data-testid="teamsheet-add-player"
            >
              <Plus size={13} />
              Add player
            </button>
          ) : (
            <div className="space-y-1">
              <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Tap a crew member to add
              </p>
              {unassigned.map((m) => {
                const id = m.user_id ?? m.memberId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => assign.mutate({ tripId, competitionId, userId: id, teamId: team.id })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                    data-testid={`teamsheet-add-${id}`}
                  >
                    <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="md" />
                    <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                      {m.displayName}
                    </span>
                    <Plus size={14} style={{ color: "var(--color-bt-accent)" }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RosterRow ───────────────────────────────────────────────────────────────
// One player row in the TeamSheet roster. Owner sees grip + captain ★ + ↑↓ +
// remove ×; captain/member see name (+ the captain ★ read-only) only.

function RosterRow({
  name,
  avatarIcon,
  teamColor,
  isCaptain,
  canManage,
  index,
  count,
  removeLocked,
  onMoveUp,
  onMoveDown,
  onRemove,
  onToggleCaptain,
  removeAriaLabel,
  captainAriaLabel,
  onDragStart,
  onDropRow,
}: {
  name: string;
  avatarIcon: string | null;
  teamColor: string;
  isCaptain: boolean;
  canManage: boolean;
  index: number;
  count: number;
  removeLocked: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onToggleCaptain: () => void;
  removeAriaLabel: string;
  captainAriaLabel: string;
  onDragStart?: () => void;
  onDropRow?: () => void;
}) {
  return (
    <div
      draggable={canManage && !!onDragStart}
      onDragStart={
        onDragStart
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart();
            }
          : undefined
      }
      onDragOver={onDropRow ? (e) => e.preventDefault() : undefined}
      onDrop={
        onDropRow
          ? (e) => {
              e.preventDefault();
              onDropRow();
            }
          : undefined
      }
      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      {canManage && (
        <GripVertical
          size={14}
          className="hidden flex-shrink-0 cursor-grab lg:block"
          style={{ color: "var(--color-bt-text-dim)" }}
          aria-hidden
        />
      )}
      <Avatar name={name} avatarIcon={avatarIcon} teamColor={teamColor} sizePx={28} />
      <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
        {name}
      </span>

      {/* Captain ★ — owner taps to mark/unmark; captain/member see it read-only. */}
      {canManage ? (
        <button
          type="button"
          onClick={onToggleCaptain}
          aria-label={captainAriaLabel}
          aria-pressed={isCaptain}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ color: isCaptain ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          data-testid="captain-toggle"
        >
          <Star size={15} fill={isCaptain ? "currentColor" : "none"} />
        </button>
      ) : (
        isCaptain && (
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center"
            style={{ color: "var(--color-bt-accent)" }}
            aria-label={`${name} is captain`}
            title="Captain"
          >
            <Star size={15} fill="currentColor" />
          </span>
        )
      )}

      {/* Reorder ↑↓ (owner) — the mobile-first canonical-order control. */}
      {canManage && (
        <div className="flex flex-shrink-0 items-center">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={`Move ${name} up`}
            className="flex h-7 w-6 items-center justify-center rounded-lg disabled:opacity-30"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="roster-move-up"
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === count - 1}
            aria-label={`Move ${name} down`}
            className="flex h-7 w-6 items-center justify-center rounded-lg disabled:opacity-30"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="roster-move-down"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      )}

      {/* Remove × (owner) — disabled once scoring locks removals. */}
      {canManage && (
        <button
          type="button"
          onClick={removeLocked ? undefined : onRemove}
          disabled={removeLocked}
          aria-label={removeAriaLabel}
          title={removeLocked ? "Locked — scoring has started. You can still add players." : undefined}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>
      )}
    </div>
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
