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
 * CompetitionFace — the Live face's body: the board (leaderboard) plus the
 * consolidated Settings sub-surface, hosted on the escaped, clean competition
 * chrome (the host page provides Band 1 title bar + bottom nav; this owns
 * Band 2's competition header + the body).
 *
 * The competition is visible to the whole crew the moment it exists (option A —
 * the GO LIVE / setup↔active reveal was removed at the root; per-game
 * Setup/Scoring handles game-level readiness). So there is no setup/live toggle
 * here any more: the board is the home, Settings is a sub-surface reached from
 * the header gear and returns to it.
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

  // The leaderboard short-name tap opens the consolidated Edit Team modal for
  // EVERYONE — the modal self-gates via useCanEditTeam (owner: full; captain:
  // identity editable, roster read-only; member: all read-only). We only need
  // the team rows here to resolve the tapped id. faceBootstrap-seeded STRUCTURE
  // (cache hit).
  const { data: teamsList = [] } = trpc.teams.list.useQuery({ tripId, competitionId: competition.id }, STRUCTURE_QUERY);

  const handleEditTeam = (teamId: string) => {
    const team = (teamsList as Team[]).find((t) => t.id === teamId);
    if (team) setEditingTeam(team);
  };
  // GO LIVE / BACK TO SETUP was removed at the root (option A): a competition is
  // visible to the whole crew the moment it exists, and per-game Setup/Scoring
  // handles game-level readiness — a competition-level reveal is redundant. The
  // `competitions.status` setup↔active distinction is retired; do NOT re-add a
  // competition-level reveal/go-live state.

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
        // A hero team-short-name tap → the consolidated Edit Team modal (the
        // team-management home). It self-gates by role: owner edits everything,
        // captain edits identity (roster read-only), a plain member sees it
        // read-only.
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
          // The go-live team-structure freeze is retired with GO LIVE. Player
          // removals / team deletes stay protected by the SCORE-based lock
          // (teamAssignments.rosterLocked → assertRosterUnlocked), which is
          // independent of status. Task 3 re-points this at scoring_model
          // (head-to-head locks the count at 2; points allows 2–N).
          structureLocked={false}
          rosterBuilding={rosterSetup === "building"}
          onSaveRosters={() => { setRosterSetup("saved"); setRostersOpen(false); }}
          onClose={() => setRostersOpen(false)}
        />
      )}

      {/* Consolidated Edit Team modal — opened by a leaderboard short-name tap.
          The team-management home: identity + roster, self-gated by role
          (useCanEditTeam). showRoster defaults true here (the standalone home);
          the in-overlay per-card pencil passes false. */}
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
