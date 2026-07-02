"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { isMatchPlayFormat, isRackFormat, isStrokeFormat, opensAsPanel } from "@/lib/gameRoutes";
import { MatchGameView } from "@/components/games/MatchGameView";
import { RackGameView } from "@/components/games/RackGameView";
import { NonGolfGameView } from "@/components/games/NonGolfGameView";
import { StrokeGameView } from "@/components/games/StrokeGameView";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";

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
 *              + delete) — reached from the header gear
 * Settings is a history-pushed overlay (the shared `useGameSettingsOverlay`, the
 * SAME contract the per-game settings pages use): opening it pushes a history
 * entry so the in-page "Board" back arrow AND the OS/browser back button both
 * dismiss it and return to the leaderboard — never past it to the trip home.
 * (Gear-only here — no `?settings=1` deep link; competition settings is reached
 * solely from the gear, so `deepLink: false`.)
 * "Add a game" no longer routes to a panel — it opens the GameSheet modal
 * directly over the board; existing games are managed on their per-game pages.
 */

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
  // (the setup guide was retired). Settings is a history-pushed overlay over the
  // board: opening pushes a history entry so back (in-page arrow OR OS/browser
  // button) returns to the leaderboard, not the trip home. Reuses the shared
  // game-settings overlay hook (one home for the behavior); gear-only, so
  // deepLink is false — competition settings has no `?settings=1` deep link.
  // "Add a game" opens a modal over the board.
  const { open: settingsOpen, openConfig: openSettings, closeConfig: closeSettings } =
    useGameSettingsOverlay({ canEdit, deepLink: false });
  const [addingGame, setAddingGame] = useState(false);
  const [rostersOpen, setRostersOpen] = useState(false);
  // Leaderboard team-name tap → a STANDALONE identity editor (owner / captain-of-
  // that-team), NOT the overlay; non-permitted taps fall to the read-only overlay.
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // GameSheet (add-game modal) needs the type catalog. Format definitions live in
  // CODE (W-PERF-01) — read synchronously, no fetch — so the modal's top half is
  // present the instant it opens, even on the bad signal organizers hit on-site.
  const gameTypes = GAME_TYPES;

  // ── Game panel (Spec 2) — the persistent-board game layer ───────────────────
  // A tapped panel-capable game (match play + rack + non-golf — Phase 1 & 2) opens
  // as a slide-in panel OVER this still-mounted board (no route teardown), driven
  // by `?game=<id>` in the URL. Open state is DERIVED from the searchParam (like
  // the settings deep-link) — the game view's own inner history (settings/score)
  // pushes entries ABOVE `?game=`, so those pop first and only a back at the root
  // pops `?game=` → the panel closes. The board already holds games.listByTrip
  // (faceBootstrap-seeded), so a game's format is known synchronously — no fetch
  // just to decide whether (and which view) to panel. ONE host for all formats.
  const search = useSearchParams();
  const openGameId = search.get("game");
  const gamesForPanel = trpc.games.listByTrip.useQuery({ tripId }, STRUCTURE_QUERY).data ?? [];
  const openGame = openGameId
    ? (gamesForPanel as { id: string; game_type_id: string | null }[]).find((g) => g.id === openGameId)
    : undefined;
  const openType = openGame?.game_type_id ?? null;
  const panelOpen = !!openGame && opensAsPanel(openType);
  // Pick the format's view — each reads its own tripId + `?game=`, so the host just
  // selects which component to mount. Explicit per format (non-golf is the only
  // fall-through, and only after opensAsPanel already vetted the type).
  const panelView = !panelOpen
    ? null
    : isMatchPlayFormat(openType)
      ? <MatchGameView />
      : isRackFormat(openType)
        ? <RackGameView />
        : isStrokeFormat(openType)
          ? <StrokeGameView />
          : <NonGolfGameView />;

  // Warm-cache seed (Task 4) — so the panel renders INSTANTLY instead of
  // spinner-gating on a cold getById. For match/rack/non-golf, seed getById from
  // the warm list row (its EXACT shape: game row + empty participants — those views
  // read their real participants from matches/playGroups, never from getById),
  // only-if-absent so a real getById is never clobbered. STROKE is the exception:
  // it reads its ROSTER from getById.participants, so an empty-participants seed
  // would flash the pick-players screen — prefetch the real row instead (already
  // warm from the pointer-intent prefetch; this covers a cold deep-link too). Then
  // head-start each format's genuinely-cold child (match → matches, rack →
  // playGroups; non-golf/stroke read only getById + already-warm data) + scores.
  useEffect(() => {
    if (!openGame) return;
    const gameId = openGame.id;
    if (utils.games.getById.getData({ tripId, gameId }) === undefined) {
      if (isStrokeFormat(openType)) {
        void utils.games.getById.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
      } else {
        utils.games.getById.setData({ tripId, gameId }, { ...openGame, participants: [] } as never);
      }
    }
    void utils.scores.listByGame.prefetch({ tripId, gameId });
    if (isMatchPlayFormat(openType)) {
      void utils.matches.listByGame.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
    } else if (isRackFormat(openType)) {
      void utils.playGroups.listByGame.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGame?.id, tripId]);

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
      onSettings={canEdit ? openSettings : undefined}
    />
  );

  // ── Sub-surface: the consolidated Settings page — a history-pushed overlay ───
  // over the board. Back (in-page arrow OR OS/browser button) returns to the
  // leaderboard via useGameSettingsOverlay, never past it to the trip home.
  if (settingsOpen) {
    return (
      <div className="space-y-4">
        {header}
        <button
          type="button"
          onClick={closeSettings}
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
  // The merged hero (identity + gear + scores) lives INSIDE the leaderboard now,
  // so the old CompetitionHeader is gone from the board — it survives only on the
  // Settings sub-surface above.
  const scoringModel = competition.scoring_model ?? "match_play";
  return (
    <div className="space-y-4">
      {/* Rosters entry point (W-TEAMSURFACE-01), gated on scoring_model (R3): a
          match_play cup is locked at 2 teams — add/delete-team is hidden and
          per-team roster editing lives in the Edit Team modal (tap a team name),
          so the button is redundant and removed. POINTS cups (2–N) KEEP it: it's
          still the only path to add/delete a team (relocating that into
          competition settings is deferred to Phase B — a known temporary). */}
      {scoringModel === "points" && (
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
      )}

      <CompetitionLeaderboard
        competitionId={competition.id}
        tripId={tripId}
        // Identity + gear for the merged hero (Task 1); the gear opens settings via
        // the #522 history-back overlay — same handler, so back-nav is unchanged.
        cupName={competition.name}
        tagline={competition.tagline}
        onSettings={canEdit ? openSettings : undefined}
        canEdit={canEdit}
        // The board layout is selected by the FROZEN scoring_model, not team
        // count (PR 2): match_play → Ryder hero, points → standings + matrix.
        scoringModel={scoringModel}
        onAddGame={() => setAddingGame(true)}
        // A hero team-name tap → the consolidated Edit Team modal (the team-
        // management home). It self-gates by role: owner edits everything, captain
        // edits identity (roster read-only), a plain member sees it read-only.
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
          scoringModel={scoringModel}
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
          // Team-COUNT lock keys on the frozen scoring_model: head-to-head is
          // exactly 2 teams (no add / no delete), so structure is locked; points
          // is 2–N, so adds/deletes stay open. (The go-live freeze this replaced
          // was retired with GO LIVE; player-removal protection once scoring
          // starts is a separate SCORE-based lock, teamAssignments.rosterLocked.)
          structureLocked={scoringModel === "match_play"}
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

      {/* Game panel (Spec 2) — the format's scoreboard as a slide-in layer over the
          persistent board. Each view reads its own tripId + `?game=`, so the host
          just mounts the right one; the board stays MOUNTED underneath (warm cache,
          no route teardown). The view's own back arrow (→ router.back) pops the
          `?game=` history entry, closing the panel and revealing the board. */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto game-panel-in"
          style={{ background: "var(--color-bt-base)" }}
          data-testid="game-panel"
        >
          {panelView}
        </div>
      )}
    </div>
  );
}
