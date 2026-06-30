"use client";

import { useState } from "react";
import { ChevronLeft, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { CompetitionHeader } from "./CompetitionHeader";
import { CompetitionLeaderboard } from "./CompetitionLeaderboard";
import { CompetitionSettings } from "./CompetitionSettings";
import { RostersOverlay } from "./RostersOverlay";
import { TeamSheet, type Team } from "./TeamsPanel";
import { isTeamCaptain } from "@/hooks/useCanEditTeam";
import { GameSheet } from "./CompetitionGamesPanel";
import { GAME_TYPES } from "@/lib/gameTypes";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
  /** Roster-setup progression (building → saved → dismissed) — drives the
   *  Team Rosters button + the "moved to Settings" signpost on the board. */
  roster_setup?: "building" | "saved" | "dismissed";
  /** Scoring-model axis (W-NONGOLF-02), independent of team count. Branches the
   *  non-golf result editor: match_play → win/lose/tie; points → #430 placement.
   *  Defaults to match_play when absent (matches the DB default + backfill). */
  scoring_model?: "match_play" | "points";
}

/**
 * The competition face's surfaces (the setup guide AND the aggregate games panel
 * were both retired — creation lands directly on the bones board):
 *   board    — the leaderboard (the main view for everyone, setup + live)
 *   settings — the consolidated Settings page (competition details + Team Rosters
 *              + delete) — reached from the header gear and the pre-save Team
 *              Rosters button
 * "Add a game" no longer routes to a panel — it opens the GameSheet modal
 * directly over the board; existing games are managed on their per-game pages.
 */
type FaceView = "settings" | "board";

interface Props {
  tripId: string;
  competition: Competition;
  canEdit: boolean;
  isOwner: boolean;
  /** Fired after the owner deletes the competition (host resets its flag). */
  onCompetitionDeleted?: () => void;
}

/**
 * CompetitionFace — the Live face's body: the symmetric two-state experience
 * (setup guide ⇄ leaderboard) hosted on the escaped, clean competition chrome
 * (the host page provides Band 1 title bar + bottom nav; this owns Band 2's
 * competition header + the state body).
 *
 * Stage 3 ties three things together:
 *   1. The symmetric toggle — the guide peeks the board ("View leaderboard →"),
 *      the board returns to the guide ("Setup view"). Default flips at go-live.
 *   2. Go-live — the explicit owner switch. It's a VISIBILITY switch, not a
 *      data lock: the owner keeps the toggle (Back to Setup) and can edit
 *      mid-round. Centralized here so going live also flips the default view.
 *   3. Chrome-shrink — the header collapses to a compact bar once live.
 *
 * STANDARD PALETTE ONLY (supersession #2) — no competition accent / tonal shift.
 */
export function CompetitionFace({
  tripId,
  competition,
  canEdit,
  isOwner,
  onCompetitionDeleted,
}: Props) {
  const utils = trpc.useUtils();
  const isLive = competition.status === "active";

  // The board is the home in every stage now — creation lands here directly
  // (the setup guide was retired); Settings is a sub-surface reached from the
  // board and returns to it. "Add a game" opens a modal over the board.
  const [view, setView] = useState<FaceView>("board");
  const [addingGame, setAddingGame] = useState(false);
  const [rostersOpen, setRostersOpen] = useState(false);
  // Leaderboard team-name tap → a STANDALONE identity editor (owner / captain-of-
  // that-team), NOT the overlay; non-permitted taps fall to the read-only overlay.
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // GameSheet (add-game modal) needs the type catalog. Format definitions live in
  // CODE (W-PERF-01) — read synchronously, no fetch — so the modal's top half is
  // present the instant it opens, even on the bad signal organizers hit on-site.
  const gameTypes = GAME_TYPES;

  // Non-golf (manual) games now have their own scoreboard PAGE (the W-NONGOLF
  // lifecycle surface) — an editor taps the row and NAVIGATES there (the GameRow
  // link), the same as golf. The old in-place RunSheet + its pencil → GameSheet
  // edit-reopen are retired (the page's gear → settings page is the edit home now,
  // like golf). So this board no longer scores/edits non-golf games inline.

  // Team-identity editing from a leaderboard name tap (PR b2): the standalone
  // editor needs full team rows; the captain check needs assignments + the viewer.
  // All member-visible + faceBootstrap-seeded (cache hits) STRUCTURE, so kept.
  const { data: teamsList = [] } = trpc.teams.list.useQuery({ tripId, competitionId: competition.id }, STRUCTURE_QUERY);
  const { data: teamAssignmentsList = [] } = trpc.teamAssignments.list.useQuery({ tripId, competitionId: competition.id }, STRUCTURE_QUERY);
  const { data: me } = trpc.users.getMe.useQuery(undefined, STRUCTURE_QUERY);

  // Identity-edit gate = owner OR the captain of THAT team. Shares the single
  // captain-resolution (isTeamCaptain) with TeamSheet + TeamsPanel so the rule
  // can't drift per-surface (Part 1 dedup).
  const canEditTeamIdentity = (teamId: string) =>
    isOwner || isTeamCaptain(teamAssignmentsList as { user_id: string; team_id: string; is_captain?: boolean }[], me?.id, teamId);

  // Owner / captain-of-that-team → standalone identity editor. Otherwise the
  // graceful read-only path: open the Rosters overlay (see the lineup, no edit).
  const handleEditTeam = (teamId: string) => {
    if (canEditTeamIdentity(teamId)) {
      const team = (teamsList as Team[]).find((t) => t.id === teamId);
      if (team) setEditingTeam(team);
    } else {
      setRostersOpen(true);
    }
  };
  // ── Go live / back to setup (visibility switch, NOT a data lock) ───────────
  // Centralized here (not in the header) so going live can also flip the
  // default view to the board. Optimistic so the chrome-shrink + toggle update
  // instantly.
  const setStatus = trpc.competitions.update.useMutation({
    onMutate: async (vars) => {
      await utils.competitions.getByTrip.cancel({ tripId });
      const previous = utils.competitions.getByTrip.getData({ tripId });
      if (previous && vars.status) {
        utils.competitions.getByTrip.setData({ tripId }, {
          ...previous,
          status: vars.status,
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) {
        utils.competitions.getByTrip.setData({ tripId }, ctx.previous);
      }
    },
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      // The header reads status from the faceBootstrap snapshot (boot.competition),
      // not getByTrip — re-resolve it so the chrome-shrink (and the crew's board
      // reveal at go-live) lands without a hard refresh. Optimism above keeps the
      // toggle/view switch instant.
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });

  const toggleLive = () => {
    const next: "upcoming" | "active" = isLive ? "upcoming" : "active";
    // The board is the home in BOTH stages now (the setup guide was retired), so
    // go-live / back-to-setup both land there; the optimistic status flip keeps
    // the chrome in sync.
    setView("board");
    setStatus.mutate({ tripId, competitionId: competition.id, status: next });
  };

  // Roster-setup progression (building → saved → dismissed). Optimistic so the
  // Team Rosters button → signpost → clean transition is instant; the face reads
  // roster_setup from the faceBootstrap snapshot, so invalidate that too (#10).
  const rosterSetup = competition.roster_setup ?? "building";
  const advanceRoster = trpc.competitions.update.useMutation({
    onSettled: () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
    },
  });
  const setRosterSetup = (next: "saved" | "dismissed") =>
    advanceRoster.mutate({ tripId, competitionId: competition.id, rosterSetup: next });

  const header = (
    <CompetitionHeader
      competition={competition}
      tripId={tripId}
      compact={isLive}
      onToggleLive={
        // Go-live is operational (owner-minus-destructive) — co-admins flip it
        // too. canEdit = owner OR co-admin (trip organizer).
        canEdit && competition.status !== "completed" ? toggleLive : undefined
      }
      togglePending={setStatus.isPending}
      onSettings={canEdit ? () => setView("settings") : undefined}
    />
  );

  // ── Sub-surface: the consolidated Settings page — reached from the board ─────
  if (view === "settings") {
    return (
      <div className="space-y-4">
        {header}
        <button
          type="button"
          onClick={() => setView("board")}
          className="inline-flex items-center gap-1 text-[13px] font-semibold"
          style={{ color: "var(--color-bt-accent)" }}
          data-testid="comp-back-to-board"
        >
          <ChevronLeft size={16} /> Board
        </button>

        <CompetitionSettings
          competition={competition}
          tripId={tripId}
          canEdit={canEdit}
          isOwner={isOwner}
          onDeleted={onCompetitionDeleted}
        />
      </div>
    );
  }

  // ── Board (the home, setup + live) ──────────────────────────────────────────
  return (
    <div className="space-y-4">
      {header}

      {/* Rosters entry point (W-TEAMSURFACE-01) — board-level so it shows in EVERY
          standings state (empty / setup / live / final), which is precisely when
          you need it. Member-visible. This (and the in-overlay pencil) are the
          ONLY ways the overlay opens; a hero team-name tap goes to the standalone
          identity editor instead. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setRostersOpen(true)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "0.5px solid var(--color-bt-border)" }}
          data-testid="open-rosters"
        >
          <Users size={14} style={{ color: "var(--color-bt-accent)" }} />
          Rosters
        </button>
      </div>

      <CompetitionLeaderboard
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
        onAddGame={() => setAddingGame(true)}
        // A hero team-name tap → STANDALONE identity editor (owner / captain of
        // that team); a non-permitted tap falls to the read-only overlay.
        onEditTeam={handleEditTeam}
      />

      {/* Add a game opens the GameSheet modal directly over the board (the
          aggregate games panel was retired). It's ADD-only now — editing an
          existing game lives on the game's own settings page (the gear), for
          golf AND non-golf alike. It persists on its own Save and invalidates
          the board's leaderboard; we also re-resolve faceBootstrap so the
          board's GAMES list refreshes without a hard reload (#10). */}
      {addingGame && canEdit && (
        <GameSheet
          tripId={tripId}
          competitionId={competition.id}
          types={gameTypes}
          canEdit={canEdit}
          scoringModel={competition.scoring_model ?? "match_play"}
          onClose={() => {
            setAddingGame(false);
            utils.competitions.faceBootstrap.invalidate({ tripId });
          }}
        />
      )}

      {/* Rosters overlay — the one home for team management (W-TEAMSURFACE-01),
          member-visible, owner-editable. Opened ONLY via the Rosters button (or a
          non-permitted team-name tap). Carries the relocated "Save rosters" commit. */}
      {rostersOpen && (
        <RostersOverlay
          tripId={tripId}
          competitionId={competition.id}
          isOwner={isOwner}
          structureLocked={isLive}
          rosterBuilding={rosterSetup === "building"}
          onSaveRosters={() => { setRosterSetup("saved"); setRostersOpen(false); }}
          onClose={() => setRostersOpen(false)}
        />
      )}

      {/* Standalone team-identity editor — opened by a leaderboard team-name tap
          for the owner / that team's captain (PR b2). Reuses TeamSheet directly,
          no overlay. The update is captain-gated server-side. */}
      {editingTeam && (
        <TeamSheet
          tripId={tripId}
          competitionId={competition.id}
          team={editingTeam}
          existingTeamNames={(teamsList as Team[])
            .filter((t) => t.id !== editingTeam.id)
            .map((t) => t.name.toLowerCase())}
          onClose={() => setEditingTeam(null)}
        />
      )}
    </div>
  );
}
