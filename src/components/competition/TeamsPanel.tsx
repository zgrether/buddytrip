"use client";

import { useState, useMemo, useRef } from "react";
import {
  ArrowRight,
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
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc-client";
import { TEAM_COLORS } from "@/lib/teamColors";
import { ScrollLock } from "@/hooks/useScrollLock";
import { Avatar } from "@/components/Avatar";
import { RowNumber } from "@/components/games/RowNumber";
import { isTeamCaptain, useCanEditTeam } from "@/hooks/useCanEditTeam";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
  /** Owner OR Organizer — roster MEMBERSHIP (assign / remove) only. `canEdit`
   *  above still gates team create / delete / captaincy, which stay Owner-only
   *  at the server. See #789. */
  canManageRoster: boolean;
  /** When provided, the parent (CompTab) drives create state via the
   *  CompetitionHeader's +Team button. Local state is used as a
   *  fallback so this panel still works standalone. */
  creating?: boolean;
  onCreatingChange?: (v: boolean) => void;
  /**
   * Structure-lock: the team *count* is fixed — no add-team / remove-team /
   * draft. Driven by the frozen scoring_model: head-to-head is exactly two
   * teams (locked), points is 2–N (open). Rename a team and swap a player stay
   * available (rename = day-one ritual, swap = admin tweak). It's a structure
   * lock, not a data lock — same builder, fewer affordances.
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

// Team color palette (intentional team identity hex per STYLE_GUIDE §7) — now the ONE
// shared source, reused by competition create's auto-seeding (src/lib/teamColors.ts).

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

  // Rapid-fire calls (e.g. quickly assigning several players in a row) race their
  // independent onSettled → invalidate() calls: an EARLIER mutation's refetch can
  // resolve AFTER a LATER mutation's optimistic write lands, overwriting the cache
  // with server data that hasn't caught up to the later write yet — silently
  // dropping it (the "assign too fast, a player reappears unassigned" bug). Defer
  // the invalidate to the TRAILING EDGE of a burst: track in-flight mutations
  // across all four calls sharing this hook instance and only invalidate once the
  // count drops back to 0, so a fast burst gets exactly one, fully-settled refetch
  // instead of N racing ones. `needsLeaderboard` preserves each mutation type's own
  // invalidation set (reorder/setCaptain never touched leaderboard — team SIZE is
  // unchanged — so a reorder-only burst doesn't force an extra leaderboard refetch).
  const pendingRef = useRef(0);
  const needsLeaderboardRef = useRef(false);
  const beginMutation = (needsLeaderboard: boolean) => {
    pendingRef.current += 1;
    if (needsLeaderboard) needsLeaderboardRef.current = true;
  };
  const settleMutation = () => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current > 0) return; // more of this burst still in flight
    utils.teamAssignments.list.invalidate(queryKey);
    if (needsLeaderboardRef.current) {
      utils.competitions.leaderboard.invalidate(queryKey);
      needsLeaderboardRef.current = false;
    }
    // faceBootstrap ALSO seeds teamAssignments.list (#10): the consolidated
    // TeamSheet opens OUTSIDE the LiveFace re-seed path, so re-resolve the
    // bootstrap or the board reads stale until the 30s poll.
    utils.competitions.faceBootstrap.invalidate({ tripId });
    // Moving someone between teams (or off one) changes THEIR avatar colour,
    // which the app bar reads on every tab — cached with staleTime: Infinity, so
    // it only refreshes if invalidated here.
    utils.competitions.myTeamColor.invalidate({ tripId });
  };

  const assign = trpc.teamAssignments.assign.useMutation({
    onMutate: async (vars) => {
      beginMutation(true); // team-size change → leaderboard points move
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
    onSettled: settleMutation,
  });

  const remove = trpc.teamAssignments.remove.useMutation({
    onMutate: async (vars) => {
      beginMutation(true); // team-size change → leaderboard points move
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
    onSettled: settleMutation,
  });

  // reorder (Part 3) — optimistic: rewrite sort_order for this team per the new
  // order; other teams untouched. The roster lists derive display order from
  // sort_order, so the rows resequence instantly. faceBootstrap seeds the list,
  // so re-resolve it (#10) — the order survives an overlay/modal close + reopen.
  const reorder = trpc.teamAssignments.reorder.useMutation({
    onMutate: async (vars) => {
      beginMutation(false); // sort_order only — team size/points unaffected
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
    onSettled: settleMutation,
  });

  // setCaptain (PR b) — optimistic: the target gets the flag; any other captain
  // on the SAME team is cleared (one-per-team). faceBootstrap also seeds
  // teamAssignments.list, so re-resolve it (#10) — the captain survives an
  // overlay close/reopen, not just the live optimistic state.
  const setCaptain = trpc.teamAssignments.setCaptain.useMutation({
    onMutate: async (vars) => {
      beginMutation(false); // captain flag only — team size/points unaffected
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
    onSettled: settleMutation,
  });

  return { assign, remove, setCaptain, reorder };
}

// ── TeamsPanel ──────────────────────────────────────────────────────────────

export function TeamsPanel({
  competitionId,
  tripId,
  canEdit,
  canManageRoster,
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
  // ADDS stay enabled. (Distinct from `structureLocked`, the scoring_model
  // team-count lock.)
  const { data: removalsLocked = false } = trpc.teamAssignments.rosterLocked.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  // CORRECTION to the old F8/#695 note: the "reachable ... from
  // MatchGameView's standalone route" claim this comment used to make was
  // false — traced exhaustively during #517's roster-reorder Phase 0.
  // MatchGameView never renders RostersOverlay/TeamsPanel by any path (it has
  // its own comment saying rosters are deliberately NOT shown there).
  // TeamsPanel is reachable ONLY via RostersOverlay from CompetitionFace,
  // which DOES mount useRealtimeMembers (LiveFaceClient.tsx) — so this
  // query's only real mount context is already covered. Left on the
  // inherited (non-STRUCTURE_QUERY) policy for now pending a deliberate look
  // at promoting it, not because of the old (incorrect) reachability
  // reasoning — see #695 for the correction and useTripRole.ts's own comment
  // for the DIFFERENT hook that genuinely is reachable from those standalone
  // routes (via useGameEditAccess/useCanEditTeam).
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
      // #10 — deleting a team changes BOTH snapshotted sets (teams + the
      // cascade-cleared team_assignments); the child invalidates above are
      // silently undone by the bootstrap re-seed without this.
      utils.competitions.faceBootstrap.invalidate({ tripId });
      // Everyone on the deleted team loses their assignment, and with it their
      // avatar colour — back to teal.
      utils.competitions.myTeamColor.invalidate({ tripId });
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
          // Head-to-head is exactly two teams, so the team count is fixed (no
          // add / delete). Say so quietly — rename + swap still work, so this
          // explains the missing +Team rather than nagging.
          <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Head-to-head — two teams
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
                  canManageRoster={canManageRoster}
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
          existingColors={teamsTyped.map((t) => t.color)}
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
  canManageRoster,
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
  /** Owner only — delete team, and the captain ★. Roster membership is NOT this
   *  flag any more; see `canManageRoster` (#789). */
  canEdit: boolean;
  /** Owner OR Organizer — roster MEMBERSHIP: drag-to-trade and the per-row
   *  remove ×. `teamAssignments.assign` has always been Organizer-gated and
   *  `remove` moved there in #788. */
  canManageRoster: boolean;
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

  // Canonical roster order (mig 070): order this team's rows by sort_order, not
  // the incidental tripMembers (joined_at) order. Map the ordered assignments to
  // their Member rows so the card shows the SAME order as every other chooser.
  const teamMembers = assignments
    .filter((a) => a.team_id === team.id)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((a) => members.find((m) => (m.user_id ?? m.memberId) === a.user_id))
    .filter((m): m is Member => !!m);

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
              draggable={canManageRoster && !removalsLocked}
              isCaptain={isCaptain}
              onDragStart={
                canManageRoster && !removalsLocked
                  ? (e) => {
                      e.dataTransfer.setData(DND_USER_KEY, id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onRemove={canManageRoster ? () => remove.mutate({ tripId, competitionId, userId: id }) : undefined}
              removeLocked={removalsLocked}
              removeAriaLabel={`Remove ${m.displayName} from ${team.name}`}
              // Owner sets captain (PR b); everyone else — Organizers included —
              // sees the filled ★ read-only. Deliberately NOT canManageRoster:
              // setCaptain stayed Owner-gated when membership moved (#788/#789).
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
      className={`@container flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      {draggable && (
        <GripVertical size={14} className="hidden flex-shrink-0 lg:block" style={{ color: "var(--color-bt-text-dim)" }} />
      )}
      <Avatar name={name} avatarIcon={avatarIcon} teamColor={teamColor} sizePx={28} collapse />
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
                    className="@container flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    <Avatar
                      name={m.displayName}
                      avatarIcon={m.user?.avatar_icon ?? null}
                      size="md"
                      collapse
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
  existingColors = [],
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
  /** Colors already taken by other teams — used in CREATE mode to default the
   *  swatch to the first UNUSED palette color, so adding a 3rd/4th team doesn't
   *  silently collide on Blue (the old index-0 default). N-team legibility. */
  existingColors?: string[];
  /** Render the consolidated roster section (edit mode only). Default true —
   *  the STANDALONE TeamSheet (leaderboard short-name tap) is the full
   *  team-management home. The in-overlay per-card pencil passes false: the
   *  team card already owns roster mgmt there. */
  showRoster?: boolean;
  onClose: () => void;
}) {
  const isEdit = !!team;
  const utils = trpc.useUtils();

  // Three-tier gating (mirrors the server). IDENTITY (name/short/colour) AND
  // roster ORDER = owner OR this team's captain (mig 094); MEMBERSHIP
  // (add/remove/captain ★) = owner only. Create mode has no team yet — only the
  // owner can reach it (the opener gates), so identity is editable there.
  //
  // #18 CARVE-OUT — this MUST keep reading SERVER state, never a draft.
  // `useCanEditTeam` resolves captaincy from `teamAssignments.list`, and its
  // result decides whether the Save/Cancel bar renders at all. If the captain ★
  // were ever drafted, a staged change here could revoke the current editor's
  // own rights mid-edit — the modal would delete its own Save button under them.
  // Keeping ★ immediate (see `orderDraft`) is precisely what lets this stay a
  // plain server read with no special-casing. Mirrors the Danger Zone's
  // deliberate server-read in the match settings page.
  const { canEdit: canEditIdentity, isOwner, canManageRoster } = useCanEditTeam(
    tripId,
    competitionId,
    team?.id ?? null
  );
  const identityEditable = isEdit ? canEditIdentity : true;

  const [name, setName] = useState(team?.name ?? "");
  const [shortName, setShortName] = useState(team?.short_name ?? "");
  const [shortNameDirty, setShortNameDirty] = useState(isEdit);
  const [paletteIdx, setPaletteIdx] = useState(() => {
    if (team) {
      const idx = TEAM_COLORS.findIndex((c) => c.color === team.color);
      return idx >= 0 ? idx : 0;
    }
    // CREATE: default to the first palette color not already used by another
    // team, so each added team gets a distinct color (no Blue-on-Blue). If every
    // palette color is taken (8+ teams), fall back to index 0 — the swatch picker
    // still lets the owner choose.
    const used = new Set(existingColors);
    const firstFree = TEAM_COLORS.findIndex((c) => !used.has(c.color));
    return firstFree >= 0 ? firstFree : 0;
  });
  const [suggesterOpen, setSuggesterOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The picked color — used to PREVIEW the roster avatars live (changes the view
  // immediately); only PERSISTED on Save (handleSave reads the same paletteIdx).
  const selectedColor = TEAM_COLORS[paletteIdx]?.color ?? team?.color ?? TEAM_COLORS[0].color;

  // Save is enabled when the TEAM changed — identity (name / short name / color)
  // OR roster display order — or, in create mode, once the required fields are
  // present. Order joined this dirty-check when it became a drafted field; the
  // MEMBERSHIP actions (add / remove / captain ★) still persist on their own
  // action and are deliberately NOT part of it (see the rule at `orderDraft`).
  const trimmedName = name.trim();
  const trimmedShort = shortName.trim();
  const identityDirty =
    isEdit && team
      ? trimmedName !== team.name ||
        trimmedShort.toUpperCase() !== (team.short_name ?? "").toUpperCase() ||
        selectedColor !== team.color
      : true;

  // Roster section data (edit mode). Deduped against any other observer of the
  // same query keys (the Rosters overlay / leaderboard), so these are cache hits.
  // CORRECTION to the old F8/#695 note (see #695 for the full correction):
  // this one was doubly wrong — not just the wrong reachability claim, but the
  // wrong COMPONENT. This query lives in TeamSheet (the standalone Edit Team
  // modal), which is reached DIRECTLY from CompetitionFace's leaderboard
  // team-name tap — it is NEVER routed through RostersOverlay at all, let
  // alone reachable from a standalone game route. CompetitionFace mounts
  // useRealtimeMembers (LiveFaceClient.tsx), so this query's only real mount
  // context is already covered. Left on the inherited policy for now pending
  // a deliberate look at promoting it, not for the old (incorrect) reason.
  const { data: rosterMembers = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: isEdit && showRoster }
  );
  const { data: rosterAssignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId },
    { enabled: isEdit && showRoster && !!competitionId }
  );

  // ── Roster ORDER is a drafted field (joins name / short / colour) ──────────
  // THE RULE: editing the TEAM — name, short name, colour, display order —
  // drafts and commits on Save. Changing WHO is on it or who leads it — add,
  // remove, captain ★ — applies immediately.
  //
  // Order drafts because it is a presentation field, and because writing it on
  // every drop cost a server round-trip mid-gesture (up to ~1s on mobile, the
  // reported settle artifact). The captain ★ deliberately does NOT draft: it is
  // a GRANT, not a field edit, and drafting it would drag `identityEditable`
  // (derived from captain state) into a carve-out where a drafted change could
  // revoke the editor's own rights mid-edit. Leaving it immediate means that
  // carve-out never has to exist. See the notes at those call sites.
  //
  // `null` = untouched, so the roster follows the server. A non-null draft is a
  // full ordering of THIS team's user_ids.
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  // Committed by handleSave, not on drop. Keeps its existing invalidation set
  // (teamAssignments.list + competitions.leaderboard + faceBootstrap, #10/#719).
  const { reorder } = useTeamAssignmentMutations(tripId, competitionId);

  // The server's canonical order for this team — the draft's baseline, and what
  // the roster renders when nothing has been dragged yet.
  const serverOrderedIds = useMemo(
    () =>
      (rosterAssignments as Assignment[])
        .filter((a) => a.team_id === team?.id)
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((a) => a.user_id),
    [rosterAssignments, team?.id]
  );

  // Dirty only when the draft actually differs — dragging a row and putting it
  // back leaves Save disabled, same as retyping the original name.
  const orderDirty =
    orderDraft !== null &&
    (orderDraft.length !== serverOrderedIds.length ||
      !orderDraft.every((id, i) => id === serverOrderedIds[i]));

  const canSubmit = !!trimmedName && !!trimmedShort && (identityDirty || orderDirty);

  // The leaderboard roll-up (competitions.leaderboard) bakes in each team's
  // color / name / short_name, and the board renders from that bootstrap-seeded
  // cache — NOT teams.list. So every team mutation must invalidate the
  // leaderboard too, or the board shows stale colors/names until a hard refresh
  // (the reported bug). teams.list stays invalidated for the teams panel + guide.
  const create = trpc.teams.create.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate({ tripId, competitionId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      // #10: faceBootstrap snapshots `teams` and LiveFaceClient re-seeds
      // teams.list from it UNCONDITIONALLY. Invalidating only the child is
      // silently undone — the re-seed writes the stale bootstrap value back AND
      // marks it fresh, so no refetch fires. Both, never one.
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });
  const update = trpc.teams.update.useMutation({
    onSettled: () => {
      utils.teams.list.invalidate({ tripId, competitionId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      // #10 — the reported bug: a colour/name change repainted teams.list but the
      // stale bootstrap re-seed clobbered it, so the top-right team-colour avatar
      // needed a hard refresh to catch up. (That avatar used to read
      // `LiveFaceClient`'s own `myTeamColor` off `boot.teams`; that path was
      // removed with the standalone face, and the avatar now resolves through
      // `competitions.myTeamColor` — hence the extra invalidate below.)
      utils.competitions.faceBootstrap.invalidate({ tripId });
      // Recolouring a team recolours the avatar of everyone on it.
      utils.competitions.myTeamColor.invalidate({ tripId });
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

    // Option A: two calls, each keeping its own gate. They CANNOT be one atomic
    // write — sort_order lives on team_assignments, not teams, and reorder is a
    // permutation-validated bulk update, not a column patch. Since #720 both
    // sides share requireTeamIdentityEdit(), so a captain can't get one accepted
    // and the other refused on permissions.
    //
    // Identity goes first: it's the cheaper call, and if it fails there's no
    // point reordering. A partial outcome is possible and is reported as such —
    // never as success (see the catch below).
    try {
      if (isEdit && team) {
        if (identityDirty) {
          await update.mutateAsync({
            tripId,
            teamId: team.id,
            name: trimmed,
            shortName: sn,
            color: palette.color,
            colorDim: palette.colorDim,
          });
        }
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
    } catch (e) {
      // Nothing landed — the plain, pre-existing failure path.
      return setError(e instanceof Error ? e.message : "Failed to save team");
    }

    // Roster order — skipped entirely when unchanged, so an identity-only edit
    // fires exactly one request.
    if (isEdit && team && orderDirty && orderDraft) {
      try {
        await reorder.mutateAsync({
          tripId,
          competitionId,
          teamId: team.id,
          orderedUserIds: orderDraft,
        });
      } catch (e) {
        // PARTIAL FAILURE. Identity is already committed; the order is not.
        // Stay OPEN and say so precisely — closing here would report success for
        // a write that half-landed. The identity fields now match the server, so
        // `identityDirty` is false and Save stays enabled on `orderDirty` alone:
        // pressing it again retries ONLY the reorder.
        const why = e instanceof Error ? e.message : "unknown error";
        return setError(
          `Saved the team’s details, but couldn’t save the roster order (${why}). Your order is still here — press Save to retry it.`
        );
      }
    }

    setOrderDraft(null);
    onClose();
  }

  return (
    <ScrollLock>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
          maxHeight: "85vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between px-4 py-3"
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

        {/* Bounded + scrollable (not the previous unbounded overflow:visible) —
            a long roster needs a genuine scrollable ancestor for dnd-kit's
            autoScroll to act on; `position:fixed` + `overflow:visible` let the
            PAGE grow to reach overflowing content (a real but autoScroll-
            invisible browser behavior — confirmed live: no scroll at all
            while holding a drag near the viewport edge before this change). */}
        <div className="space-y-4 overflow-y-auto p-4" style={{ minHeight: 0 }}>
          {/* Team name (most of the row) + a narrow short-name box, side by side. */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
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
            </div>
            <div className="flex-shrink-0" style={{ width: 92 }}>
          <Field label="Short" required>
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
              // The `uppercase` class below is COSMETIC — `onChange` above already
              // normalizes `shortName` itself to uppercase, which is what `handleSave`
              // and the dirty-check compare. Checked after #987 (the delete-account
              // confirm field relied on this class ALONE, with no JS normalization,
              // and the comparison silently failed for anyone who typed lowercase):
              // this input doesn't share that gap, but keep the two in sync — if the
              // `onChange` normalization above is ever removed, this class must go too
              // or this becomes the same bug.
              className="w-full rounded-lg px-2 py-2 text-center text-sm uppercase outline-none disabled:opacity-70"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>
            </div>
          </div>

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

          {/* Consolidated roster section — the team-management home (edit mode).
              Owner gets full controls; captain/member see it read-only. The
              avatars use the PREVIEW color (selectedColor) so a color pick shows
              immediately, persisting only on Save. */}
          {isEdit && showRoster && team && (
            <TeamSheetRoster
              tripId={tripId}
              competitionId={competitionId}
              team={team}
              teamColor={selectedColor}
              // MEMBERSHIP (add / remove) — Owner OR Organizer (#789). `assign`
              // has always been requireTripRole("Organizer") server-side and
              // `remove` moved there in #788, so this was hiding a permission an
              // Organizer already held. Captaincy is NOT this flag — see
              // `canAppointCaptain`, which stays Owner-only.
              canManage={canManageRoster}
              // Appointing the captain stays with the Owner: a captain holds real
              // RLS grants (065 / 094), so naming one is "changing who is trusted"
              // one level down — and `setCaptain` is still Owner-gated server-side.
              canAppointCaptain={isOwner}
              // Reorder is the ONE roster capability a captain has (mig 094 +
              // teamAssignments.reorder's requireTeamIdentityEdit gate).
              // `canEditIdentity` is already owner-OR-this-team's-captain, which
              // is exactly the server gate — so the affordance can't drift from
              // the permission.
              canReorder={canEditIdentity}
              members={rosterMembers as Member[]}
              assignments={rosterAssignments as Assignment[]}
              // Order is drafted HERE (TeamSheet owns Save); the roster renders
              // the draft when present and reports drags back up. It never
              // writes order itself any more.
              orderedIds={orderDraft ?? serverOrderedIds}
              onReorder={setOrderDraft}
            />
          )}
        </div>

        {/* Pinned action bar — OUTSIDE the scrollable body above, so it stays put
            with a 20+ member roster instead of scrolling away with the list
            (CLAUDE.md #14: bottom controls anchor to the viewport, not the end of
            the content). The modal is a flex column with a bounded max-height, so
            `flex-shrink-0` here is exactly the SettingsSlideOver header/scroll/
            footer shape — reused rather than reinvented.
            It also has to live BELOW the roster now that Save commits roster
            order: an action bar above the list would misstate its scope. */}
        {identityEditable && (
          <div
            className="flex flex-shrink-0 gap-2 px-4 py-3"
            style={{
              borderTop: "1px solid var(--color-bt-border)",
              background: "var(--color-bt-card-float)",
            }}
          >
            {/* Cancel discards the whole draft — identity AND order — by closing;
                the local state dies with the unmount, so nothing is written.
                It does NOT undo an add, a remove, or a captain change: those are
                membership acts that applied when tapped. Deliberate, per the
                rule at `orderDraft`, not an oversight. */}
            <button
              type="button"
              onClick={onClose}
              disabled={create.isPending || update.isPending || reorder.isPending}
              className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{
                background: "transparent",
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
              data-testid="team-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSubmit || create.isPending || update.isPending || reorder.isPending}
              className="flex-[2] rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              data-testid="team-save"
            >
              {/* "Save Team" still reads right: order is a property OF the team,
                  same as its name and colour — which is the whole rule this
                  modal now follows. */}
              {isEdit ? "Save Team" : "Add Team"}
            </button>
          </div>
        )}
      </div>
    </div>
    </ScrollLock>
  );
}

// ── TeamSheetRoster ─────────────────────────────────────────────────────────
// The consolidated roster section of the STANDALONE Edit Team modal: this team's
// players in CANONICAL order (sort_order). Owner/Organizer (canManage) get add +
// remove; the captain ★ is Owner-only (canAppointCaptain); reorder is canReorder. Captain + plain member see it READ-ONLY (names + the
// captain ★). Reorder has TWO controls: ↑↓ buttons (the touch fallback) + grip
// drag with an insertion line (desktop, mirrors the match-assignments panel) —
// HTML5 drag doesn't fire on touch, so the arrows are how mobile reorders.

function TeamSheetRoster({
  tripId,
  competitionId,
  team,
  teamColor,
  canManage,
  canAppointCaptain,
  canReorder,
  members,
  assignments,
  orderedIds,
  onReorder,
}: {
  tripId: string;
  competitionId: string;
  team: Team;
  /** The PREVIEW color (the live color-picker selection) — drives the row avatars
   *  so a color pick shows immediately; persists only on Save. */
  teamColor: string;
  /** Owner or Organizer — MEMBERSHIP mutations: add / remove. Matches the server
   *  (`assign` is Organizer-gated; `remove` moved there in #788). */
  canManage: boolean;
  /** Owner ONLY — appointing/unappointing the team captain (`setCaptain`, still
   *  Owner-gated). Split from `canManage` in #789. */
  canAppointCaptain: boolean;
  /** Owner OR this team's captain — roster ORDER only (mig 094). Split from
   *  `canManage` deliberately: display order is not membership. */
  canReorder: boolean;
  members: Member[];
  assignments: Assignment[];
  /** CONTROLLED display order (TeamSheet owns the draft + Save). The parent
   *  passes `orderDraft ?? serverOrderedIds`, so this component renders the
   *  drafted order without knowing whether one exists. */
  orderedIds: string[];
  /** Report a drag result upward. Local state only — NO network call on drop;
   *  the write happens in TeamSheet's handleSave. */
  onReorder: (next: string[]) => void;
}) {
  // `reorder` is deliberately NOT taken here any more — order is committed by
  // TeamSheet's Save. assign / remove / setCaptain stay immediate (the rule:
  // membership applies now, team fields commit on Save).
  const { assign, remove, setCaptain } = useTeamAssignmentMutations(
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

  // This team's rows, sequenced by the CONTROLLED `orderedIds` (the parent's
  // draft when one exists, else the server's sort_order). Ordering by the prop
  // rather than by each row's sort_order is what makes a drag show instantly
  // without a write — the underlying rows still carry their old sort_order until
  // Save lands.
  //
  // Built from a lookup so it degrades safely: a row whose id isn't in
  // `orderedIds` (a teammate added on another device mid-draft) is appended
  // rather than dropped, and an id with no row is skipped.
  const roster = useMemo(() => {
    const mine = assignments.filter((a) => a.team_id === team.id);
    const byId = new Map(mine.map((a) => [a.user_id, a]));
    const seq = orderedIds.map((id) => byId.get(id)).filter((a): a is Assignment => !!a);
    const missing = mine.filter((a) => !orderedIds.includes(a.user_id));
    return [...seq, ...missing];
  }, [assignments, team.id, orderedIds]);

  const unassigned = useMemo(() => {
    const assignedIds = new Set(assignments.map((a) => a.user_id));
    return members.filter((m) => !assignedIds.has(m.user_id ?? m.memberId));
  }, [members, assignments]);

  const [addSheetOpen, setAddSheetOpen] = useState(false);

  // Drag-to-reorder (dnd-kit) — mirrors the match-reorder pattern (#711/#712):
  // PointerSensor (mouse+touch+pen) + KeyboardSensor, a DragOverlay with
  // dropAnimation={null} (device testing on matches found the default
  // animation targets the wrong slot when ids are re-minted per render — HERE
  // ids are STABLE (user_id), so that failure mode doesn't apply, but null is
  // still correct: the live reflow during the drag already shows the
  // destination, so nothing needs to animate on release). Source row hidden
  // (opacity 0) while dragging — one visual object, not two.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const from = orderedIds.indexOf(String(active.id));
      const to = orderedIds.indexOf(String(over.id));
      // Draft only — no network call on drop. This is what removes the mobile
      // settle artifact: the gesture no longer waits on a round-trip.
      if (from !== -1 && to !== -1) onReorder(arrayMove(orderedIds, from, to));
    }
    setActiveId(null);
  };
  const handleDragCancel = () => setActiveId(null);
  const activeAssignment = activeId ? roster.find((a) => a.user_id === activeId) : null;
  const activeMember = activeAssignment ? memberById.get(activeAssignment.user_id) : null;
  const activeIndex = activeId ? orderedIds.indexOf(activeId) : -1;

  return (
    <div
      data-testid="teamsheet-roster"
      className="pt-2"
      style={{ borderTop: "1px solid var(--color-bt-border)" }}
    >
      {/* Header — no count (the numbered rows already convey it). The
          "Captain = ★" legend is right-justified: the rows are a FLEX layout, so
          the star column drifts with width — there's no stable column to center
          over. Legend shows for all viewers (it's a marker key). */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Roster
        </h4>
        {roster.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Captain =
            <Star size={11} fill="currentColor" style={{ color: "var(--color-bt-accent)" }} />
          </span>
        )}
      </div>

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {roster.map((a, i) => {
                const m = memberById.get(a.user_id);
                const name = m?.displayName ?? "Unknown";
                return (
                  <RosterRow
                    key={a.user_id}
                    id={a.user_id}
                    name={name}
                    avatarIcon={m?.user?.avatar_icon ?? null}
                    teamColor={teamColor}
                    isCaptain={!!a.is_captain}
                    canManage={canManage}
                    canAppointCaptain={canAppointCaptain}
                    canReorder={canReorder}
                    index={i}
                    removeLocked={removalsLocked}
                    // IMMEDIATE, deliberately — not drafted, and Cancel will not
                    // undo it. Removing someone is a MEMBERSHIP act; only team
                    // FIELDS (name / short / colour / order) wait for Save.
                    onRemove={() => remove.mutate({ tripId, competitionId, userId: a.user_id })}
                    // IMMEDIATE, deliberately — see the #18 carve-out on
                    // `useCanEditTeam` above. Captaincy is a GRANT, and it feeds
                    // `identityEditable`; drafting it would let a staged change
                    // revoke the editor's own Save button mid-edit. Cancel does
                    // not undo it.
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
                  />
                );
              })}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeAssignment && activeIndex !== -1 ? (
              <StaticRosterRow
                name={activeMember?.displayName ?? "Unknown"}
                avatarIcon={activeMember?.user?.avatar_icon ?? null}
                teamColor={teamColor}
                isCaptain={!!activeAssignment.is_captain}
                canManage={canManage}
                canAppointCaptain={canAppointCaptain}
                canReorder={canReorder}
                index={activeIndex}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add player (owner) — a full-width button (like "add match") that opens a
          sheet listing the UNASSIGNED pool, mirroring the match-play player
          selector. Unassigned-pool ONLY (no cross-team reassignment). */}
      {canManage && unassigned.length > 0 && (
        <button
          type="button"
          onClick={() => setAddSheetOpen(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1.5px dashed var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
          data-testid="teamsheet-add-player"
        >
          <Plus size={16} />
          Add player
        </button>
      )}

      {addSheetOpen && (
        <AddPlayerSheet
          teamName={team.name}
          teamColor={teamColor}
          unassigned={unassigned}
          // IMMEDIATE, deliberately — adding is a MEMBERSHIP act, so it lands on
          // tap and Cancel does not undo it. (It also assigns sort_order
          // server-side as max+1, which a drafted add would have to invent.)
          onPick={(id) => assign.mutate({ tripId, competitionId, userId: id, teamId: team.id })}
          onClose={() => setAddSheetOpen(false)}
        />
      )}

      {/* Removal lock is KEPT (owner decision) — say why, so the disabled × reads
          as intentional, not broken. Adds stay enabled. */}
      {canManage && removalsLocked && (
        <p
          className="mt-3 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
          data-testid="teamsheet-locked-note"
        >
          Rosters are locked once scoring starts.
        </p>
      )}
    </div>
  );
}

// ── AddPlayerSheet ──────────────────────────────────────────────────────────
// Bottom-sheet player picker for adding to a team, mirroring the match-play
// PlayerSelector. Lists the UNASSIGNED pool only (no cross-team reassignment).
// Stays open as you pick so several can be added; the list shrinks as they're
// assigned (the parent recomputes `unassigned`), then shows the empty state.

function AddPlayerSheet({
  teamName,
  teamColor,
  unassigned,
  onPick,
  onClose,
}: {
  teamName: string;
  teamColor: string;
  unassigned: Member[];
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-[60] flex items-end"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
        data-testid="teamsheet-add-sheet"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full"
          style={{
            background: "var(--color-bt-card-float)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: "16px 16px 28px",
            maxHeight: "75vh",
            overflowY: "auto",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: teamColor }} />
              Add to {teamName}
            </div>
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
          <p
            className="mt-3 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Unassigned crew
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {unassigned.length === 0 ? (
              <span className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
                Everyone&apos;s on a team.
              </span>
            ) : (
              unassigned.map((m) => {
                const id = m.user_id ?? m.memberId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onPick(id)}
                    className="@container flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                    data-testid={`teamsheet-add-${id}`}
                  >
                    <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="md" collapse />
                    <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                      {m.displayName}
                    </span>
                    <Plus size={16} style={{ color: "var(--color-bt-accent)" }} />
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

// ── RosterRow ───────────────────────────────────────────────────────────────
// One player row in the TeamSheet roster. Owner sees grip (drag-reorder) +
// captain ★ + ↑↓ (touch-fallback reorder) + remove ×; captain/member see name
// (+ the captain ★ read-only) only.

// H (roster): drag handle for a roster row (dnd-kit, pointer-based → works on
// touch). The row is a flex layout (not CSS grid, unlike matches), so the
// 44×44 hit target is built via negative margins rather than `justifySelf` —
// the original grip slot was 16×28 (h-7 w-4); the handle overflows that by
// 14px each side / 8px top+bottom, into the row's own padding/gap, not onto
// any other interactive cell. Visual glyph stays small.
function RosterDragHandle({
  name,
  attributes,
  listeners,
}: {
  name: string;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
}) {
  return (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${name}`}
      className="flex flex-shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
      style={{
        width: 44,
        height: 44,
        margin: "-8px -14px",
        touchAction: "none",
        color: "var(--color-bt-text-dim)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <GripVertical size={16} />
    </button>
  );
}

/** A purely visual copy of the handle for the DragOverlay's floating row — no
 *  attributes/listeners (the overlay isn't itself draggable; dnd-kit positions
 *  it programmatically). Same look as the real handle, no overflow margin
 *  needed since nothing else shares the overlay's row. */
function StaticRosterDragHandle() {
  return (
    <div aria-hidden className="flex flex-shrink-0 items-center justify-center" style={{ width: 16, height: 28, color: "var(--color-bt-text-dim)" }}>
      <GripVertical size={16} />
    </div>
  );
}

// Shared row content — handle │ # │ avatar │ name │ captain │ ↑↓ │ ×. Used by
// BOTH the live sortable row and the DragOverlay's floating copy so the two
// can't visually drift apart (mirrors matches' matchRowContent).
function rosterRowContent({
  handle,
  name,
  avatarIcon,
  teamColor,
  isCaptain,
  canManage,
  canAppointCaptain,
  canReorder,
  index,
  removeLocked,
  onRemove,
  onToggleCaptain,
  removeAriaLabel,
  captainAriaLabel,
}: {
  handle: React.ReactNode;
  name: string;
  avatarIcon: string | null;
  teamColor: string;
  isCaptain: boolean;
  canManage: boolean;
  canAppointCaptain: boolean;
  canReorder: boolean;
  index: number;
  removeLocked?: boolean;
  onRemove?: () => void;
  onToggleCaptain?: () => void;
  removeAriaLabel?: string;
  captainAriaLabel?: string;
}) {
  return (
    <>
      {/* Grip — arms the drag (dnd-kit's PointerSensor + KeyboardSensor), so the
          row buttons stay tappable everywhere else. Gated on canReorder (owner OR
          THIS team's captain, mig 094), not canManage — ordering isn't membership. */}
      {canReorder && handle}
      {/* Row index — quiet table-number column, like the match pickers. */}
      <RowNumber number={index + 1} className="flex-shrink-0" style={{ width: 16 }} />
      <Avatar name={name} avatarIcon={avatarIcon} teamColor={teamColor} sizePx={28} collapse />
      <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
        {name}
      </span>

      {/* Captain ★ — OWNER ONLY (`canAppointCaptain`, not `canManage`): setCaptain
          stayed Owner-gated when membership moved to Organizer (#788/#789).
          Everyone else, Organizers included, sees it read-only. */}
      {canAppointCaptain ? (
        <button
          type="button"
          onClick={onToggleCaptain}
          aria-label={captainAriaLabel}
          aria-pressed={isCaptain}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ color: isCaptain ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
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

      {/* The ↑↓ arrows are gone. They existed as the touch fallback while
          reorder used native HTML5 drag, which never fired on touch; dnd-kit's
          PointerSensor covers touch and KeyboardSensor covers the non-pointer
          path (verified in #713), so the fallback had no remaining job. */}

      {/* Remove × (owner) — disabled once scoring locks removals. */}
      {canManage && (
        <button
          type="button"
          onClick={removeLocked ? undefined : onRemove}
          disabled={removeLocked}
          aria-label={removeAriaLabel}
          title={removeLocked ? "Locked — scoring has started. You can still add players." : undefined}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
        >
          <X size={14} />
        </button>
      )}
    </>
  );
}

function RosterRow({
  id,
  name,
  avatarIcon,
  teamColor,
  isCaptain,
  canManage,
  canAppointCaptain,
  canReorder,
  index,
  removeLocked,
  onRemove,
  onToggleCaptain,
  removeAriaLabel,
  captainAriaLabel,
}: {
  /** Sortable id — the STABLE user_id, never the array index (CLAUDE.md #711
   *  lesson: a positional id gets re-minted every render and breaks dnd-kit's
   *  assumption that an id names the same logical item across a drag). */
  id: string;
  name: string;
  avatarIcon: string | null;
  teamColor: string;
  isCaptain: boolean;
  canManage: boolean;
  canAppointCaptain: boolean;
  canReorder: boolean;
  index: number;
  removeLocked: boolean;
  onRemove: () => void;
  onToggleCaptain: () => void;
  removeAriaLabel: string;
  captainAriaLabel: string;
}) {
  // animateLayoutChanges: false — dnd-kit's default animates EVERY sortable
  // row whose index changed once a drag ends (wasDragging), independent of
  // the live drag-transform above. That's a second animation layered on top
  // of a possibly-still-settling transform, which is what read on device as
  // the neighbour row re-seating/overlapping right at release. The live
  // reflow during the drag (still driven by `transform`/`transition` below)
  // already shows the destination, so nothing needs to animate post-drop.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });
  return (
    <div
      ref={setNodeRef}
      className="@container relative flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        transform: CSS.Transform.toString(transform),
        transition,
        // Hidden (not dimmed) while dragging — the DragOverlay is the dragged
        // row's visual; the row still occupies its slot so siblings reflow
        // around a stable gap.
        opacity: isDragging ? 0 : 1,
        // The reported flash: -webkit-tap-highlight-color was never reset
        // anywhere in this app. Unreset, WebKit/mobile browsers paint a native,
        // instantaneous highlight on whatever tappable element a touch lands/
        // releases on — no CSS transition involved, which is why "nothing
        // moves" and why it only shows on rows the drag's release point landed
        // on. Reset here and on every button below (their own tap targets).
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {rosterRowContent({
        handle: <RosterDragHandle name={name} attributes={attributes} listeners={listeners} />,
        name,
        avatarIcon,
        teamColor,
        isCaptain,
        canManage,
        canAppointCaptain,
        canReorder,
        index,
        removeLocked,
        onRemove,
        onToggleCaptain,
        removeAriaLabel,
        captainAriaLabel,
      })}
    </div>
  );
}

// The DragOverlay's floating copy — a lifted-card look (STYLE_GUIDE §1 Level 3
// float surface), matching the matches pattern.
function StaticRosterRow({
  name,
  avatarIcon,
  teamColor,
  isCaptain,
  canManage,
  canAppointCaptain,
  canReorder,
  index,
}: {
  name: string;
  avatarIcon: string | null;
  teamColor: string;
  isCaptain: boolean;
  canManage: boolean;
  canAppointCaptain: boolean;
  canReorder: boolean;
  index: number;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{ background: "var(--color-bt-card-float)", boxShadow: "var(--shadow-floating)" }}
    >
      {rosterRowContent({
        handle: <StaticRosterDragHandle />,
        name,
        avatarIcon,
        teamColor,
        isCaptain,
        canManage,
        canAppointCaptain,
        canReorder,
        index,
      })}
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
