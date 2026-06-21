"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Users, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionHeader } from "./CompetitionHeader";
import { CompetitionLeaderboard } from "./CompetitionLeaderboard";
import { CompetitionSettings } from "./CompetitionSettings";
import { GameSheet, RunSheet, type GameType, type GameRow, type LBTeamLite } from "./CompetitionGamesPanel";

interface Competition {
  id: string;
  name: string;
  tagline: string | null;
  status: "upcoming" | "active" | "completed";
  /** Roster-setup progression (building → saved → dismissed) — drives the
   *  Team Rosters button + the "moved to Settings" signpost on the board. */
  roster_setup?: "building" | "saved" | "dismissed";
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

  // GameSheet (add-game modal) needs the type catalog — fetched once here so the
  // modal opens without its own waterfall. Only editors ever open it.
  const { data: gameTypes = [] } = trpc.games.listTypes.useQuery(undefined, { enabled: canEdit });

  // ── Non-golf (manual) game scoring + config-reopen, routed from the board ───
  // Golf games open via their per-format route (the GameRow links). Non-golf
  // games have no route, so an editor taps the row → the manual run sheet (the
  // orphaned RunSheet, re-attached here), and its pencil reopens config in the
  // GameSheet. This restores the entry points the retired CompetitionGamesPanel
  // wired; the board only re-attaches them. Both queries are seeded by
  // faceBootstrap (cache hit — no extra waterfall) and editor-only.
  const { data: allGames = [] } = trpc.games.listByTrip.useQuery({ tripId }, { enabled: canEdit });
  const { data: lb } = trpc.competitions.leaderboard.useQuery(
    { tripId, competitionId: competition.id },
    { enabled: canEdit }
  );
  const compGames = useMemo(
    () => (allGames as GameRow[]).filter((g) => g.competition_id === competition.id),
    [allGames, competition.id]
  );
  const [running, setRunning] = useState<GameRow | null>(null); // manual game being posted
  const [editing, setEditing] = useState<GameRow | null>(null); // game whose config is reopened
  // Seed the run sheet's finishing order from the posted leaderboard cells (when
  // correcting), else the roster order — mirrors the retired panel.
  const runningOrder = useMemo(() => {
    if (!running) return [];
    const teams = (lb?.teams ?? []) as LBTeamLite[];
    const cells = ((lb?.cells ?? []) as { gameId: string; teamId: string; place: number }[])
      .filter((c) => c.gameId === running.id)
      .sort((a, b) => a.place - b.place);
    return cells.length ? cells.map((c) => c.teamId) : teams.map((t) => t.id);
  }, [running, lb]);
  const openManualGame = (gameId: string) => {
    const g = compGames.find((x) => x.id === gameId);
    if (g) setRunning(g);
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
          isLive={isLive}
          rosterBuilding={rosterSetup === "building"}
          // "Save rosters" (setup phase only) commits the roster build one-way:
          // the board's Team Rosters button gives way to the moved-to-Settings
          // signpost. Returns to the board so the transition is visible.
          onSaveRosters={() => { setRosterSetup("saved"); setView("board"); }}
          onDeleted={onCompetitionDeleted}
        />
      </div>
    );
  }

  // ── Board (the home, setup + live) ──────────────────────────────────────────
  return (
    <div className="space-y-4">
      {header}

      {/* Setup-phase roster affordance: the Team Rosters button (building) gives
          way to a dismissable "moved to Settings" signpost (saved) → clean
          (dismissed). Editors only — the crew never sees management chrome. */}
      {canEdit && rosterSetup === "building" && (
        <button
          type="button"
          onClick={() => setView("settings")}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}
          data-testid="comp-team-rosters-btn"
        >
          <Users size={15} style={{ color: "var(--color-bt-accent)" }} /> Team Rosters
        </button>
      )}
      {canEdit && rosterSetup === "saved" && (
        <div
          className="flex items-start gap-3 rounded-lg px-3 py-2.5"
          style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}
          data-testid="comp-rosters-moved-signpost"
        >
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            Roster management has moved to Settings —{" "}
            <button type="button" onClick={() => setView("settings")} className="font-semibold underline" style={{ color: "var(--color-bt-accent)" }}>
              Open Settings
            </button>
            . Manage a team by tapping its name.
          </p>
          <button
            type="button"
            onClick={() => setRosterSetup("dismissed")}
            aria-label="Dismiss"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="comp-rosters-signpost-dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <CompetitionLeaderboard
        competitionId={competition.id}
        tripId={tripId}
        canEdit={canEdit}
        onAddGame={() => setAddingGame(true)}
        onEditTeam={canEdit ? () => setView("settings") : undefined}
        onOpenGame={canEdit ? openManualGame : undefined}
      />

      {/* Add a game opens the GameSheet modal directly over the board (the
          aggregate games panel was retired). It persists on its own Save and
          invalidates the board's leaderboard; we also re-resolve faceBootstrap
          so the board's GAMES list refreshes without a hard reload (#10). */}
      {(addingGame || editing) && canEdit && (
        <GameSheet
          tripId={tripId}
          competitionId={competition.id}
          game={editing}
          types={gameTypes as GameType[]}
          canEdit={canEdit}
          onClose={() => {
            setAddingGame(false);
            setEditing(null);
            utils.competitions.faceBootstrap.invalidate({ tripId });
          }}
        />
      )}

      {/* Manual (non-golf) scoring — the orphaned RunSheet re-attached to the
          board. Tapping a non-golf row opens it (winner/loser/tie via the
          finishing order → games.post → leaderboard); its pencil reopens config.
          faceBootstrap is invalidated on close so the board reflects the posted
          result without a hard reload (pattern #10 — the board seeds from it). */}
      {running && canEdit && (
        <RunSheet
          tripId={tripId}
          competitionId={competition.id}
          game={running}
          teams={(lb?.teams ?? []) as LBTeamLite[]}
          initialOrder={runningOrder}
          isEngine={!!(gameTypes as GameType[]).find((t) => t.id === running.game_type_id)?.isEngine}
          onClose={() => {
            setRunning(null);
            utils.competitions.faceBootstrap.invalidate({ tripId });
          }}
          onEditConfig={() => { setEditing(running); setRunning(null); }}
        />
      )}
    </div>
  );
}
