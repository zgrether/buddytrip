"use client";

import { useMemo } from "react";
import { ChevronLeft, Settings } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { NonGolfConfigurationView } from "@/components/games/NonGolfConfigurationView";
import { NonGolfScoreboard } from "@/components/games/NonGolfScoreboard";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { GAME_TYPES, type ScoringModel } from "@/lib/gameTypes";
import type { GameRow, LBTeamLite } from "@/components/competition/CompetitionGamesPanel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
      <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
    </div>
  );
}

/**
 * The non-golf (manual) game scoreboard page (W-NONGOLF lifecycle surface) — the
 * non-golf twin of golf's per-format game pages. A game tap on the leaderboard
 * lands here (the old post-results modal is promoted to this page). Same
 * mode-driven structure as golf:
 *  - **Setup mode** (pending): member → `SetupPlaceholder`; owner/delegate →
 *    pass-through (placeholder + "Set up this game" + corner gear → settings).
 *  - **Scoring mode** (active/complete): the scoreboard (`NonGolfScoreboard`).
 *
 * The interim header is deliberately simple/functional — the consistent
 * projected-points header (a logged follow-on) replaces it across all game types.
 */
export default function ManualGamePage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const urlGameId = search.get("game");

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery(
    { slugOrId: param },
    { ...STRUCTURE_QUERY, enabled: !isId, retry: false }
  );
  const tripId = isId ? param : resolved.data?.id;
  const utils = trpc.useUtils();
  // #501 Part 1: delegate-aware — a game-delegate (even a plain Member) edits this
  // game, mirroring the server's `canEditGame`. `isOwner` stays trip-Owner-only.
  const { canEdit, isOwner } = useGameEditAccess(tripId, urlGameId);

  const gameQ = trpc.games.getById.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId }
  );
  const compQ = trpc.competitions.getByTrip.useQuery(
    { tripId: tripId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId }
  );

  const game = gameQ.data as unknown as GameRow | undefined;
  const competitionId = game?.competition_id ?? (compQ.data?.id as string | undefined) ?? null;
  const scoringModel = ((compQ.data?.scoring_model as ScoringModel | undefined) ?? "match_play") as ScoringModel;

  const lbQ = trpc.competitions.leaderboard.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { enabled: !!tripId && !!competitionId }
  );
  const teams = useMemo(() => ((lbQ.data?.teams ?? []) as LBTeamLite[]), [lbQ.data]);
  const gameCells = useMemo(
    () => ((lbQ.data?.cells ?? []) as { gameId: string; teamId: string; place: number }[])
      .filter((c) => c.gameId === urlGameId)
      .sort((a, b) => a.place - b.place),
    [lbQ.data, urlGameId]
  );
  const initialOrder = useMemo(
    () => (gameCells.length ? gameCells.map((c) => c.teamId) : teams.map((t) => t.id)),
    [gameCells, teams]
  );
  // Seed the match control's declared outcome from the posted cells — a draw is
  // both sides at place 1 (the win/lose/tie post writes both → position 1).
  const initialResult = useMemo(() => {
    if (gameCells.length === 2 && gameCells.every((c) => c.place === 1)) return "tie";
    return gameCells[0]?.teamId;
  }, [gameCells]);

  const scoringEnabled = (game as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  // Non-golf is "ready" to score once points are configured (mirrors the server
  // `assertGameReady` manual branch: a distribution shape or an owner-set total).
  const ready = !!game && (game.points_total != null || game.points_distribution != null);
  const typeDef = GAME_TYPES.find((t) => t.id === game?.game_type_id);
  const typeName = typeDef?.name ?? "Game";

  const enableScoring = trpc.games.enableScoring.useMutation();
  const disableScoring = trpc.games.disableScoring.useMutation();

  // The ONE settings overlay — owns open/close/back + the leaderboard deep link
  // (?settings=1 → land here directly for an owner/delegate of a setup-mode game).
  const { open: showConfig, openConfig, closeConfig } = useGameSettingsOverlay({
    canEdit,
    deepLink: search.get("settings") === "1",
  });

  async function refreshGame() {
    await gameQ.refetch();
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  async function handleEnable() {
    if (!tripId || !urlGameId) return;
    try {
      await enableScoring.mutateAsync({ tripId, gameId: urlGameId });
      await refreshGame();
      // #512 correction: STAY on the settings page — the toggle flips in place. The
      // back arrow still returns to the game page via the openConfig history entry.
    } catch {
      // surfaced via the global error toast
    }
  }
  async function handleDisable() {
    if (!tripId || !urlGameId) return;
    try {
      await disableScoring.mutateAsync({ tripId, gameId: urlGameId });
      await refreshGame();
    } catch {
      // surfaced via the global error toast
    }
  }

  if (!tripId || !urlGameId) return <Spinner />;
  if (gameQ.isLoading || !game) return <Spinner />;

  const header = (title: string) => (
    <header className="flex shrink-0 items-center justify-between" style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
      <button onClick={() => router.back()} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
        <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
      </button>
      <div className="min-w-0 text-center">
        <div className="truncate" style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{typeName}</div>
      </div>
      {canEdit ? (
        <button onClick={openConfig} aria-label="Settings" className="flex h-9 w-9 items-center justify-center" data-testid="game-settings-gear">
          <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
      ) : <div className="h-9 w-9" />}
    </header>
  );

  // ── The ONE settings page — reached via the corner gear in BOTH modes. ──
  // Returned DIRECTLY (not in a `fixed inset-0` wrapper): it's a full-page view,
  // and its own `min-h-screen` root document-scrolls. Wrapping it in `fixed`
  // pinned it to the viewport, so tall content (e.g. the points panel + danger
  // zone) overflowed past the bottom with no way to scroll — the reported bug.
  // This matches the rack page, which already renders the config view directly.
  if (showConfig && canEdit && competitionId) {
    return (
      <NonGolfConfigurationView
        subtitle={typeName}
        onBack={closeConfig}
        tripId={tripId}
        competitionId={competitionId}
        game={game}
        scoringModel={scoringModel}
        canEdit={canEdit}
        isOwner={isOwner}
        onChanged={() => void refreshGame()}
        onDeleted={() => router.push(`/trips/${tripId}/leaderboard`)}
        scoringEnabled={scoringEnabled}
        ready={ready}
        onEnable={handleEnable}
        onDisable={handleDisable}
        busy={enableScoring.isPending || disableScoring.isPending}
      />
    );
  }

  const gameName = game.name?.trim() || typeName;

  // ── Setup mode (pending) — member placeholder / owner pass-through. ──
  if (!scoringEnabled) {
    return (
      <div className="flex flex-col" style={{ minHeight: "100vh", background: "var(--color-bt-base)" }}>
        {header(gameName)}
        <div className="flex-1">
          <SetupPlaceholder
            tripId={tripId}
            game={game}
            message={canEdit
              ? "Set the format, points, and rules on the settings page — the crew can’t see the game until you switch it to scoring."
              : undefined}
          >
            {canEdit && (
              <button
                type="button"
                onClick={openConfig}
                data-testid="setup-go-to-settings"
                className="mx-auto flex items-center justify-center gap-2"
                style={{ height: 48, padding: "0 22px", borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 15, fontWeight: 600 }}
              >
                <Settings size={17} /> Set up this game
              </button>
            )}
          </SetupPlaceholder>
        </div>
      </div>
    );
  }

  // ── Scoring mode (active/complete) — the scoreboard. ──
  return (
    <div className="flex flex-col" style={{ minHeight: "100vh", background: "var(--color-bt-base)" }}>
      {header(gameName)}
      {competitionId && (
        <NonGolfScoreboard
          tripId={tripId}
          competitionId={competitionId}
          game={game}
          teams={teams}
          scoringModel={scoringModel}
          initialOrder={initialOrder}
          initialResult={initialResult}
          canEdit={canEdit}
          onPosted={() => router.back()}
        />
      )}
    </div>
  );
}
