"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy, CloudOff, RefreshCw, Plus, ArrowUpDown } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/router";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY, LEADERBOARD_QUERY } from "@/lib/queryConfig";
import { useRealtimeScoreEvents } from "@/hooks/useRealtimeScoreEvents";
import { useFirstClinchView } from "@/hooks/useFirstClinchView";
import { useMyTeamId } from "@/hooks/useMyTeamColor";
import { isCupComplete } from "@/lib/cupCompletion";
import type { ScoringModel } from "@/lib/gameTypes";
import { GameRow, CompletedRow, GridColumnHeader, sectionOf, fmtPts, type GameSection } from "./GameRow";
import { StickyCollapseHero } from "./CompetitionHero";
import { PointsMatrix } from "./PointsMatrix";
import { ReorderableSection } from "./ReorderableGames";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LBTeam {
  id: string;
  name: string;
  short_name: string;
  color: string;
}

export interface LBGame {
  id: string;
  name: string;
  distribution: number[] | null;
  status: string;
  gameTypeId: string | null;
  /** Points configured (scoring-ready). Kept for the games-panel/test consumers. */
  ready?: boolean;
  /** The §A readiness gate: the format's required roster is assigned (match-play
   *  pairings / stroke-rack participants / manual points). Drives BOTH the
   *  Setting-up↔Ready lifecycle and the `N PTS`/`—` column — one signal. */
  configured?: boolean;
  /** A course is applied to this game — drives the scorecard chip's button vs
   *  muted-status three-way (course is optional, never an error). */
  hasCourse?: boolean;
  /** Scoring is enabled (Phase 2B.1) — the real arming signal the format-icon
   *  color reads (§A4). False until the owner enables; first score → Live. */
  scoringEnabled?: boolean;
  /** ≥1 score entry exists (R1) — splits `active` into On Tap (started) vs Ready
   *  for Play (enabled, not started) for the board's game sections. */
  started?: boolean;
  /** Re-opened for a score correction — the game is complete but its result is
   *  being looked at again. Drives the board's `IN REVIEW` badge. Only meaningful
   *  alongside `status === "complete"`; `gameLockState` is the shared reading of
   *  the pair. Optional so existing fixtures/tests that build an `LBGame` by hand
   *  stay valid — absent reads as "not in review", which is the safe default. */
  correctionsOpen?: boolean;
  /** Points in play for this game — the §A5 outer-column `N PTS` value. Carries
   *  the match-play total too (whose `distribution` is null pre-decision). */
  pointsTotal?: number | null;
}

export interface LBCell {
  gameId: string;
  teamId: string;
  place: number;
  points: number;
}

/** The viewer's identity, threaded to GameRow for the delegate marker (§10).
 *  `teamColor` paints the marker in the viewer's competition-team color. */
export interface LBViewer {
  name: string | null;
  avatarIcon: string | null;
  teamColor: string | null;
}

/** The cached `competitions.leaderboard` row, taken from the ROUTER rather than
 *  the local `LeaderboardData` interface below (CLAUDE.md #2 — cache writes
 *  carry their own type). The two are not interchangeable: the router's real
 *  output additionally carries `scoringModel`, which `LeaderboardData` omits —
 *  a `setData` updater typed against the narrower local shape does not satisfy
 *  tRPC's cache type, and widening `LeaderboardData` to match would duplicate a
 *  shape the router already owns. */
type LeaderboardQueryData = inferRouterOutputs<AppRouter>["competitions"]["leaderboard"];

interface LeaderboardData {
  teams: LBTeam[];
  games: LBGame[];
  cells: LBCell[];
  /** gameId → teamId → projected points, for LIVE match/rack games only (the
   *  ▲ projected-points pill). Absent games have no live projection. */
  projections: Record<string, Record<string, number>>;
  teamTotals: Record<string, number>;
  /** Per-team projected total ("if today holds") = banked + Σ live-game projections
   *  (server-summed). The hero's projected tier reads it; delta = this − teamTotals. */
  projectedTeamTotals: Record<string, number>;
  /** ≥1 game live → show the hero's projected tier at all (independent of any delta). */
  hasLiveProjection: boolean;
  pointsAvailable: number;
  winNumber: number;
  pointsToClinch: Record<string, number>;
  defendingTeamId: string | null;
}

// ── Root component ────────────────────────────────────────────────────────────

interface Props {
  competitionId: string;
  tripId: string;
  /** Cup identity for the merged hero (Task 1) — the hero replaced the separate
   *  CompetitionHeader, so identity + gear are threaded in here. */
  cupName: string;
  tagline: string | null;
  /** Opens competition settings (the #522 history-back overlay). Gear shows only
   *  for editors; passing it keeps the SAME handler so back-nav is unchanged. */
  onSettings?: () => void;
  /** The competition's FROZEN scoring model — selects the board layout (PR 2):
   *  `match_play` → the Ryder head-to-head hero; `points` → the standings glance
   *  + collapsible games×teams matrix. NOT team count — a 2-team points cup is
   *  still a points cup and gets the matrix. Defaults to match_play. */
  scoringModel?: ScoringModel;
  /** Editor affordances on the board (the setup guide was retired — the board is
   *  the home now). Crew (non-editors) get none of these. */
  canEdit?: boolean;
  onAddGame?: () => void;
  /** Tap a team name on the hero/list → opens Rosters focused on that team's
   *  identity editor (captain-scoped; routed by the face). Member-visible. */
  onEditTeam?: (teamId: string) => void;
}

export function CompetitionLeaderboard({ competitionId, tripId, cupName, tagline, onSettings, scoringModel = "match_play", canEdit = false, onAddGame, onEditTeam }: Props) {
  // Live standings: migration 096's trigger broadcasts on every score /
  // lifecycle write and this invalidates within a tick. LEADERBOARD_QUERY's
  // interval is now only the dead-socket backstop behind it (5 min), not the
  // freshness mechanism — see queryConfig.ts.
  useRealtimeScoreEvents(tripId, competitionId);

  const { data: lb, isLoading, isError, refetch } = trpc.competitions.leaderboard.useQuery(
    { tripId, competitionId },
    { ...LEADERBOARD_QUERY, enabled: !!competitionId }
  );

  const data = lb as LeaderboardData | undefined;

  // Games THIS user delegates (§10) — marked on the same normal board everyone
  // sees (no filtered view). Empty for non-delegates, so the badge never shows.
  const { data: myDelegateIds = [] } = trpc.games.myDelegateGameIds.useQuery(
    { tripId },
    { ...STRUCTURE_QUERY, enabled: !!tripId }
  );
  const mineSet = useMemo(
    () => new Set(myDelegateIds as string[]),
    [myDelegateIds]
  );

  // The viewer's identity for the delegate marker (§10). The marker is the
  // viewer's avatar in THEIR TEAM color (competition identity); only the rows the
  // viewer delegates render it. `getMe` + the team assignment list are both cheap
  // + cached. teamColor is null when the viewer isn't on a team → Avatar falls
  // back to its accent ("you") treatment.
  const { data: me } = trpc.users.getMe.useQuery(undefined, STRUCTURE_QUERY);
  const { data: assignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, competitionId },
    { ...STRUCTURE_QUERY, enabled: !!competitionId }
  );
  const viewer = useMemo<LBViewer>(() => {
    const myTeamId =
      (assignments as { user_id: string; team_id: string }[]).find((a) => a.user_id === me?.id)?.team_id ?? null;
    const teamColor = myTeamId ? (data?.teams.find((t) => t.id === myTeamId)?.color ?? null) : null;
    return {
      name: (me?.name as string | null) ?? null,
      avatarIcon: (me?.avatar_icon as string | null) ?? null,
      teamColor,
    };
  }, [me, assignments, data?.teams]);

  const liveGames = useMemo(
    () => data?.games ?? [],
    [data]
  );

  const cellsByGame = useMemo(() => {
    const m = new Map<string, Map<string, LBCell>>();
    for (const c of data?.cells ?? []) {
      if (!m.has(c.gameId)) m.set(c.gameId, new Map());
      m.get(c.gameId)!.set(c.teamId, c);
    }
    return m;
  }, [data?.cells]);

  // ── Warm the game-entry path (perf) ───────────────────────────────────────
  // Tapping a game row lands on a fully client-rendered game page whose data
  // (game / matches / scores / organizers / crew) is NOT in the faceBootstrap
  // snapshot — so today it fetches COLD only after the route mounts (the 2–3s
  // wait). tripMembers is trip-wide (same for every game) so warm it once on
  // mount; each game's own data we warm on pointer intent. On desktop that's a
  // generous hover lead; on touch it's the short pointerdown→navigation window,
  // which still lets the batch start and overlap the route's JS mount instead
  // of starting strictly after it. (Server-rendering the game page — Stage B
  // pattern — is the real mobile fix; logged in DEFERRED.md.)
  const utils = trpc.useUtils();
  useEffect(() => {
    void utils.tripMembers.list.prefetch({ tripId }, STRUCTURE_QUERY);
  }, [utils, tripId]);
  // The STRUCTURE prefetches carry STRUCTURE_QUERY (staleTime Infinity) so they
  // NO-OP when the structure is already cached at any age — without it the
  // prefetch's own default 60s staleTime would re-fetch fresh structure in the
  // background on every >60s reopen, defeating the kept-structure cut on the
  // consuming page. (Invalidation still overrides Infinity, so a structural
  // mutation re-warms them.) Only `scores` (STATE) stays on the short default so
  // a reopen warms fresh scores.
  const prefetchGame = useCallback(
    (gameId: string) => {
      void utils.games.getById.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
      void utils.scores.listByGame.prefetch({ tripId, gameId });
      void utils.matches.listByGame.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
      void utils.games.listOrganizers.prefetch({ tripId, gameId }, STRUCTURE_QUERY);
    },
    [utils, tripId],
  );

  // The clincher's team id, derived ABOVE the early returns because
  // `useFirstClinchView` is a hook and hook order has to be stable across every
  // render — including the loading and no-teams branches below, which return
  // before `clincher` exists. Same predicate as the real `clincher` further
  // down (which stays the single source used for rendering); this is only the
  // id, only for the storage key.
  const clincherTeamId =
    data?.teams.find((t) => (data.pointsToClinch[t.id] ?? 1) <= 0)?.id ?? null;
  const { isFirstView: isFirstClinchView, markSeen: markClinchSeen } = useFirstClinchView(
    competitionId,
    clincherTeamId,
  );
  // The viewer's own team — "did the person looking at this actually win?".
  // Shares `competitions.myTeamColor`'s cache entry with the app-bar avatar, so
  // this is a cache read, not a second request.
  const myTeamId = useMyTeamId(tripId);

  // Never blank-on-error (Connectivity Layer 1). TanStack keeps the last `data`
  // through a failed refetch, so a flaky poll keeps showing the board. Only when
  // there's NO data yet do we branch: a spinner while the first load is in
  // flight, or a clear retryable card if it failed — never a confusing blank.
  if (!data) {
    if (isError) return <LeaderboardLoadError onRetry={() => void refetch()} />;
    if (isLoading) return <LeaderboardLoading />;
    return null;
  }

  const { teams, teamTotals, pointsAvailable, winNumber, pointsToClinch, defendingTeamId } = data;

  if (teams.length === 0) {
    return <NoTeamsState />;
  }

  const clincher = teams.find((t) => (pointsToClinch[t.id] ?? 1) <= 0) ?? null;

  // Decided vs FINISHED — the distinction the celebration turns on. Clinch
  // itself is not re-derived: `isCupComplete` takes the existing `clincher`
  // above as its input and only adds "is anything still in play" on top.
  //
  // Match-play only, matching the hero's own `showScores`. The trophy, the glow
  // and the two-score treatment are all match-play constructs — a points cup has
  // no hero centrepiece to celebrate on, so lighting one there would mean
  // inventing the surface first.
  const isMatchPlay = scoringModel === "match_play";
  const cupComplete = isMatchPlay && isCupComplete(data.games, !!clincher);

  /**
   * ── Who gets the burst ──────────────────────────────────────────────────
   *
   * The line is drawn between the RESULT and the CELEBRATION, not between
   * winners and everyone else wholesale:
   *
   *   - The still treatment — lit trophy, winner-colour wash, "Final · X wins"
   *     — renders for EVERYONE. It is the trophy ceremony, and the losing team
   *     stands there for that. It is also just the result, which nobody should
   *     be shown a lesser version of.
   *   - The spark BURST fires only for someone on the winning team. Sparks are
   *     the app cheering *with you*; firing them at the team that just lost is
   *     the app cheering *at* them.
   *
   * A viewer on no team at all (an organiser who isn't playing) gets the still
   * state — the result, without the confetti that isn't theirs.
   */
  const viewerWon = cupComplete && clincher != null && myTeamId === clincher.id;

  return (
    <div className="space-y-3" data-testid="competition-leaderboard">
      {/* Win banner — the RESTRAINED state, and only that.

          Two gates, both new:

          1. `!cupComplete` — once the cup is finished the hero below carries the
             result as a lit trophy, and a second trophy strip stacked above it is
             worse than either alone. The banner gives way.
          2. `isMatchPlay` — this rendered unconditionally before, so a POINTS cup
             showed a clinch strip with a hero behind it that has no trophy, no
             glow and no two-score treatment (all gated on `showScores`). That
             was a pre-existing inconsistency: a clinch announcement floating
             above a surface that never acknowledges clinch. Points cups accrue
             open-endedly and the board deliberately strips every match-play
             clinch construct (no "first to X", no ceiling); the banner was the
             one that got missed. */}
      {clincher && isMatchPlay && !cupComplete && (
        <ClinchedBanner
          clincher={clincher}
          isDefender={clincher.id === defendingTeamId}
          teams={teams}
          teamTotals={teamTotals}
        />
      )}

      {/* The merged hero (Task 1) — identity + gear + (match_play) team names,
          scores, clinch bar, win target. Now with the sticky-collapse swap (Spec
          Piece 1): the expanded hero scrolls away and the compact score bar pins
          just below the TopNav (56px). Same data, a restyle. */}
      <StickyCollapseHero
        stickyTop={56}
        cupName={cupName}
        tagline={tagline}
        teams={teams}
        teamTotals={teamTotals}
        projectedTeamTotals={data.projectedTeamTotals}
        hasLiveProjection={data.hasLiveProjection}
        pointsAvailable={pointsAvailable}
        winNumber={winNumber}
        clincher={clincher}
        cupComplete={cupComplete}
        // First view of THIS cup's THIS winner, on this device, BY SOMEONE WHO
        // WON. Gated on `cupComplete` so a clinched-but-unfinished cup never
        // burns the one showing — the flag must still be unspent when the cup
        // actually ends. A non-winner never fires and so never marks it seen,
        // which costs nothing: they have no burst to spend.
        celebrateFirstView={viewerWon && isFirstClinchView}
        onCelebrated={markClinchSeen}
        // The re-fire button — winners only, for the same reason the burst is.
        canReplayCelebration={viewerWon}
        scoringModel={scoringModel}
        canEdit={canEdit}
        onSettings={onSettings}
        onEditTeam={onEditTeam}
      />

      {/* POINTS body (board-body branching, left untouched): the standings glance
          + the collapsible games×teams matrix, below the identity hero. match_play
          needs neither — the hero's two-score head-to-head is the whole story. */}
      {scoringModel === "points" && (
        <>
          <div
            className="overflow-hidden rounded-xl"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            <div className="px-4 pt-3 pb-1">
              {/* Factual subtitle only — no "first to X" (not calculable in points: the
                  score accrues open-endedly, there's no clinch ceiling). */}
              <p
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                {teams.length} {teams.length === 1 ? "team" : "teams"}
              </p>
            </div>
            <NTeamRankedList teams={teams} teamTotals={teamTotals} onEditTeam={onEditTeam} />
          </div>
          <PointsMatrix games={liveGames} teams={teams} cellsByGame={cellsByGame} teamTotals={teamTotals} />
        </>
      )}

      {/* Bones copy — the calm setup voice, only while the board is empty and
          editable (nothing's required to start). */}
      {canEdit && liveGames.length === 0 && (
        <p className="px-1 text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
          This is your scoreboard. Name the teams, add the games — it fills in as you go. Nothing&rsquo;s required to start.
        </p>
      )}

      {/* Games — the session list once games exist, the empty prompt before. */}
      <GamesSection
        games={liveGames}
        competitionId={competitionId}
        teams={teams}
        cellsByGame={cellsByGame}
        projections={data.projections ?? {}}
        scoringModel={scoringModel}
        tripId={tripId}
        mineSet={mineSet}
        viewer={viewer}
        onPrefetch={prefetchGame}
        canEdit={canEdit}
        onAddGame={onAddGame}
      />
    </div>
  );
}

// ── GamesSection ─────────────────────────────────────────────────────────────
// The board's GAMES home (retired the setup guide's games panel as the sole
// entry). Empty → the bones prompt + "Add a game"; populated → the session
// breakdown + "Add a game". Editor-gated; the crew sees the list only.
function GamesSection({
  games, competitionId, teams, cellsByGame, projections, scoringModel, tripId, mineSet, viewer, onPrefetch, canEdit, onAddGame,
}: {
  games: LBGame[];
  competitionId: string;
  teams: LBTeam[];
  cellsByGame: Map<string, Map<string, LBCell>>;
  projections: Record<string, Record<string, number>>;
  scoringModel: ScoringModel;
  tripId: string;
  mineSet: Set<string>;
  viewer: LBViewer;
  onPrefetch: (gameId: string) => void;
  canEdit: boolean;
  onAddGame?: () => void;
}) {
  /**
   * SESSION-ONLY, deliberately: plain `useState`, no localStorage, no URL param.
   * Reordering is a once-before-the-trip act, and a mode that survived a revisit
   * would leave handles in front of everyone who came back to read the board.
   * It also resets whenever this unmounts, which is the behaviour we want.
   */
  const [reorderMode, setReorderMode] = useState(false);
  // Nothing to reorder against with zero or one game — the toggle is hidden
  // rather than shown-and-inert, per the same "don't render a control that does
  // nothing" instinct as #833's placement buttons. `games` here is the WHOLE
  // competition's list (this component's own prop), not one section's — the
  // question is "is there more than one game on the board at all", not
  // "does this section have more than one".
  const canReorder = games.length > 1;
  const utils = trpc.useUtils();
  const reorder = trpc.games.reorder.useMutation();

  /**
   * A drag inside one section, folded into the ONE board-wide sequence.
   *
   * The section's rows are a subsequence of the global order, so applying the
   * section's new order back onto the positions those games occupy globally
   * moves the dragged game past its section neighbours and leaves every other
   * game exactly where it was. That is what keeps a game's place when it later
   * changes state: nothing else is renumbered relative to it.
   */
  const handleReorderSection = useCallback(
    (_key: GameSection, nextIds: string[]) => {
      const positions: number[] = [];
      games.forEach((g, i) => {
        if (nextIds.includes(g.id)) positions.push(i);
      });
      const next = games.map((g) => g.id);
      positions.forEach((pos, i) => {
        next[pos] = nextIds[i];
      });
      if (!competitionId) return;
      const input = { tripId, competitionId };

      // Optimistic: reorder the cached `games` ARRAY to the new sequence before
      // the round trip. Without this the drop was worse than a plain wait — the
      // row snapped BACK to its pre-drag slot on release (nothing in the cache
      // had changed yet) and only jumped to the right place 3-5s later once the
      // mutation answered, which read as the drag having failed and then
      // un-failing. `GameRow`/`CompletedRow` render unchanged; only the order of
      // the array they're mapped over does, so a plain reorder is the whole fix
      // — unlike `useOpenCorrection`'s single-boolean flip, this patches a list.
      const byId = new Map(games.map((g) => [g.id, g]));
      utils.competitions.leaderboard.setData(input, (prev: LeaderboardQueryData | undefined) =>
        prev
          ? {
              ...prev,
              games: next.map((id) => byId.get(id)).filter((g): g is LBGame => !!g) as LeaderboardQueryData["games"],
            }
          : prev
      );

      reorder.mutate(
        { ...input, gameIds: next },
        {
          onSuccess: () => {
            // Server truth, un-awaited — the optimistic order is already on
            // screen; this only reconciles it. CLAUDE.md #10 — NEVER the child
            // alone: the Live face re-seeds `competitions.leaderboard` FROM
            // `faceBootstrap` on mount, so invalidating only the child is
            // silently undone.
            void utils.competitions.leaderboard.invalidate(input);
            void utils.competitions.faceBootstrap.invalidate({ tripId });
            void utils.games.listByTrip.invalidate({ tripId });
          },
          onError: () => {
            // Rollback = re-pull server truth (CLAUDE.md #1), not a snapshot
            // restore. By the time a rejection lands, migration 109's UPDATE
            // broadcast (or another client's own reorder) may already have
            // moved the cache, and restoring a snapshot would put back a value
            // that is stale in a second, unrelated way.
            void utils.competitions.leaderboard.invalidate(input);
          },
        }
      );
    },
    [games, competitionId, tripId, reorder, utils]
  );

  const addBtn = canEdit && onAddGame && (
    <button
      type="button"
      onClick={onAddGame}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-3"
      style={{ background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
      data-testid="comp-add-game"
    >
      <Plus size={16} /> Add a game
    </button>
  );

  if (games.length === 0) {
    // Owner/editor with a fresh, empty board → the whole panel is an invitation
    // to begin (§4 invitation styling: dashed border + surface-invitation), and
    // tapping anywhere routes to the setup entry point (add the first game).
    // Non-editors can't set up, so they get a calm read-only note instead.
    if (canEdit && onAddGame) {
      return (
        <button
          type="button"
          onClick={onAddGame}
          data-testid="comp-games-empty-cta"
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-8 text-center transition-opacity hover:opacity-80"
          style={{
            background: "var(--color-bt-surface-invitation)",
            border: "1.5px dashed var(--color-bt-border)",
          }}
        >
          <Plus size={20} style={{ color: "var(--color-bt-accent)" }} />
          <span style={{ color: "var(--color-bt-text)", fontSize: 15, fontWeight: 600 }}>
            Tap to start setting up
          </span>
          <span style={{ color: "var(--color-bt-text-dim)", fontSize: 12 }}>
            Add the first game to start the board.
          </span>
        </button>
      );
    }
    return (
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        data-testid="comp-games-empty"
      >
        <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Games</p>
        </div>
        <div className="px-4 py-5">
          <p className="text-sm" style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>No games yet.</p>
          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            Add the first one to start the board.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SessionBreakdown
        games={games}
        teams={teams}
        cellsByGame={cellsByGame}
        projections={projections}
        scoringModel={scoringModel}
        tripId={tripId}
        mineSet={mineSet}
        viewer={viewer}
        onPrefetch={onPrefetch}
        canEdit={canEdit}
        reorderMode={reorderMode && canReorder}
        onReorderSection={handleReorderSection}
      />
      {/* ASYMMETRIC on purpose: adding a game is the frequent action and keeps
          the full-width invitation; reordering happens roughly once, before the
          trip, so it gets a compact button beside it rather than equal billing. */}
      {addBtn && (
        <div className="flex items-stretch gap-2">
          {canReorder && (
            <button
              type="button"
              onClick={() => setReorderMode((v) => !v)}
              aria-pressed={reorderMode}
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-3"
              style={{
                background: reorderMode ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1.5px ${reorderMode ? "solid var(--color-bt-accent-border)" : "dashed var(--color-bt-border)"}`,
                color: reorderMode ? "var(--color-bt-accent)" : "var(--color-bt-text)",
                fontSize: 14,
                fontWeight: 600,
                WebkitTapHighlightColor: "transparent",
              }}
              data-testid="comp-reorder-toggle"
            >
              <ArrowUpDown size={16} /> Reorder
            </button>
          )}
          <div className="min-w-0 flex-1">{addBtn}</div>
        </div>
      )}
    </div>
  );
}

// ── NTeamRankedList ───────────────────────────────────────────────────────────
// The POINTS standings glance (PR 2): "are we winning?" at a glance. Ordered by
// total desc, the leader emphasized (larger total), trailing teams present but
// quieter. Reached only by points cups now — match_play renders the Ryder hero.

function NTeamRankedList({
  teams,
  teamTotals,
  onEditTeam,
}: {
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  /** Tap a team name → that team's identity editor (owner / its captain). */
  onEditTeam?: (teamId: string) => void;
}) {
  const sorted = [...teams].sort(
    (a, b) => (teamTotals[b.id] ?? 0) - (teamTotals[a.id] ?? 0)
  );
  // Bars are proportional to the LEADER, not a fixed ceiling — points has no clinch total,
  // so the top team fills the bar and the rest read relative to it (all-zero → empty bars).
  const leaderTotal = Math.max(0, ...sorted.map((t) => teamTotals[t.id] ?? 0));

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="space-y-2.5">
        {sorted.map((team, idx) => {
          const total = teamTotals[team.id] ?? 0;
          const barWidth = leaderTotal > 0 ? Math.min(100, (total / leaderTotal) * 100) : 0;
          const isLeader = idx === 0 && total > 0;
          const dotName = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: team.color }} />
              <span className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                {team.name}
              </span>
            </>
          );

          // One aligned row: rank · dot + name (fixed width so every bar starts at the same
          // x) · proportional bar (fills the middle) · score (right-aligned, leader colored).
          return (
            <div key={team.id} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                {idx + 1}
              </span>
              {onEditTeam ? (
                <button
                  type="button"
                  onClick={() => onEditTeam(team.id)}
                  className="flex w-[34%] min-w-0 shrink-0 items-center gap-2 text-left"
                  data-testid={`comp-team-name-${team.id}`}
                >
                  {dotName}
                </button>
              ) : (
                <div className="flex w-[34%] min-w-0 shrink-0 items-center gap-2">{dotName}</div>
              )}
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--color-bt-card-raised)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barWidth}%`, background: team.color }} />
              </div>
              <span
                className="w-10 shrink-0 text-right font-bold tabular-nums"
                style={{ fontSize: isLeader ? 19 : 15, color: isLeader ? team.color : "var(--color-bt-text)" }}
              >
                {fmtPts(total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── SessionBreakdown ─────────────────────────────────────────────────────────

// Section order + labels (leaderboard-grid pass §1.3): single-word lifecycle
// names. Render order stays Completed-first, descending to New (unchanged from
// before this pass) — only the label strings + LIVE's teal treatment changed.
// The Completed section renders compressed single-line rows; the rest use the
// full GameRow.
const SECTION_ORDER: { key: GameSection; label: string }[] = [
  { key: "completed", label: "Completed" },
  { key: "on-tap", label: "Live" },
  { key: "ready", label: "Ready" },
  { key: "preparing", label: "Configuring" },
  { key: "skeleton", label: "New" },
];

function SessionBreakdown({
  games,
  teams,
  cellsByGame,
  projections,
  scoringModel,
  tripId,
  mineSet,
  viewer,
  onPrefetch,
  canEdit,
  reorderMode,
  onReorderSection,
}: {
  games: LBGame[];
  teams: LBTeam[];
  cellsByGame: Map<string, Map<string, LBCell>>;
  projections: Record<string, Record<string, number>>;
  scoringModel: ScoringModel;
  tripId: string;
  mineSet: Set<string>;
  viewer: LBViewer;
  onPrefetch: (gameId: string) => void;
  canEdit: boolean;
  reorderMode: boolean;
  /** The section's ids in their new order. The caller folds that into the
   *  board-wide sequence — the order is GLOBAL, and only it knows the rest. */
  onReorderSection: (key: GameSection, nextIds: string[]) => void;
}) {
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  /**
   * One row, rendered the same way for the list, the sortable wrapper and the
   * drag overlay — so the floating copy can't drift from the real row.
   *
   * `isLast` drives the completed list's between-rows hairline, and is computed
   * against the SECTION rather than passed down, so the reorder path and the
   * plain path agree.
   */
  const renderGameRow = useCallback(
    (game: LBGame, sectionGames: LBGame[], key: GameSection) => {
      const isLast = sectionGames[sectionGames.length - 1]?.id === game.id;
      return key === "completed" ? (
        <CompletedRow
          key={game.id}
          game={game}
          teams={teams}
          cells={cellsByGame.get(game.id)}
          scoringModel={scoringModel}
          tripId={tripId}
          isLast={isLast}
          onPrefetch={onPrefetch}
        />
      ) : (
        <GameRow
          key={game.id}
          game={game}
          teams={teams}
          cells={cellsByGame.get(game.id)}
          projection={projections[game.id]}
          scoringModel={scoringModel}
          tripId={tripId}
          mine={mineSet.has(game.id)}
          canEdit={canEdit}
          viewerName={viewer.name}
          viewerAvatarIcon={viewer.avatarIcon}
          viewerTeamColor={viewer.teamColor}
          onPrefetch={onPrefetch}
        />
      );
    },
    [teams, cellsByGame, scoringModel, tripId, projections, mineSet, canEdit, viewer, onPrefetch]
  );

  // Group games by board section (single source: sectionOf) — every game lands
  // in exactly one bucket (R1 clean partition). The server's global
  // `display_order` sort is preserved within each section.
  const bySection = useMemo(() => {
    const m = new Map<GameSection, LBGame[]>();
    for (const g of games) {
      const s = sectionOf(g);
      const arr = m.get(s);
      if (arr) arr.push(g);
      else m.set(s, [g]);
    }
    return m;
  }, [games]);

  return (
    <div className="flex flex-col gap-4">
      {SECTION_ORDER.map(({ key, label }) => {
        const sectionGames = bySection.get(key);
        if (!sectionGames || sectionGames.length === 0) return null; // empty sections hidden
        // LIVE (on-tap) is the one section that carries the liveness signal —
        // teal label + dot (§1.3/§1.4). The per-row LIVE badge was removed in
        // favor of this single section-level tell.
        const isLive = key === "on-tap";
        const labelColor = isLive ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)";
        return (
          <div key={key} data-testid={`games-section-${key}`}>
            <p
              className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: labelColor }}
            >
              {isLive && (
                <span
                  className="inline-block h-1 w-1 rounded-full"
                  style={{ background: "currentColor", boxShadow: "0 0 0 3px var(--color-bt-accent-faint)" }}
                />
              )}
              {label}
              {/* Inline, right after the label — "COMPLETED 9". It was
                  right-justified to the section's right edge (W3-LB2), which read
                  fine on a sparse board and turned into a column of numbers
                  floating away from their headings once the board filled up. */}
              <span className="tabular-nums" style={{ color: "var(--color-bt-text)" }}>{sectionGames.length}</span>
            </p>
            {/* Team short-name column header — sits directly above COMPLETED
                only (§1.2), match_play only (points cups get their own
                team-column header inside PointsMatrix). */}
            {key === "completed" && scoringModel === "match_play" && (
              <GridColumnHeader teams={teams} />
            )}
            {/* ONE className, read by both paths below, so squish and no-squish
                can't disagree about row spacing the way they used to (reordering
                hardcoded "flex flex-col" and silently dropped the gap on every
                non-Completed section). */}
            {(() => {
              const listClassName = key === "completed" ? "flex flex-col" : "flex flex-col gap-2";
              return (
                /* Reordering wraps the section's rows in its OWN drag context, so
                   a cross-section drag is structurally impossible rather than
                   rejected: a Ready row has no droppable target in Completed to
                   begin with. A game's section IS its lifecycle state, and
                   dragging can't change state. Off (the default) this renders
                   the identical list with no context and no handles. */
                <ReorderableSection
                  enabled={reorderMode}
                  ids={sectionGames.map((g) => g.id)}
                  labelOf={(id) => gameById.get(id)?.name ?? "game"}
                  renderRow={(id) => {
                    const g = gameById.get(id);
                    return g ? renderGameRow(g, sectionGames, key) : null;
                  }}
                  onReorder={(nextIds) => onReorderSection(key, nextIds)}
                  listClassName={listClassName}
                >
                  <div className={listClassName}>
                    {sectionGames.map((game) => renderGameRow(game, sectionGames, key))}
                  </div>
                </ReorderableSection>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// ── ClinchedBanner ────────────────────────────────────────────────────────────

function ClinchedBanner({
  clincher,
  isDefender,
  teams,
  teamTotals,
}: {
  clincher: LBTeam;
  isDefender: boolean;
  teams: LBTeam[];
  teamTotals: Record<string, number>;
}) {
  const sorted = [...teams].sort(
    (a, b) => (teamTotals[b.id] ?? 0) - (teamTotals[a.id] ?? 0)
  );
  const scoreLabel = sorted
    .map((t) => fmtPts(teamTotals[t.id] ?? 0))
    .join("–");

  // Present perfect, not the simple present. This banner now renders in exactly
  // ONE state — decided, still being played — and "wins the cup" sat directly
  // above the hero's own "games remain", contradicting it on a single screen.
  // "has clinched" is the thing that is actually true: the result is settled,
  // the golf isn't over. The defender keeps its own verb, for the same reason it
  // always had one — retaining and winning are different achievements.
  const verb = isDefender ? "has retained the cup" : "has clinched the cup";

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
      data-testid="clinch-banner"
    >
      <Trophy size={18} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-accent)" }}>
        {clincher.name} {verb} · {scoreLabel}
      </p>
    </div>
  );
}

// ── NoTeamsState ──────────────────────────────────────────────────────────────

function NoTeamsState() {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-xl px-4 py-10 text-center"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="competition-leaderboard"
    >
      <Trophy size={24} style={{ color: "var(--color-bt-text-dim)" }} />
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        No teams yet
      </p>
      <p
        className="max-w-xs text-[12px] leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Add teams and games in the Competition tab to see standings here.
      </p>
    </div>
  );
}

/** First-load spinner — only shown when there's NO cached board yet (a warm
 *  board keeps rendering through refetches). Never a blank. */
function LeaderboardLoading() {
  return (
    <div
      className="flex min-h-[30vh] items-center justify-center"
      data-testid="competition-leaderboard"
    >
      <div
        className="h-7 w-7 animate-spin rounded-full border-2"
        style={{
          borderColor: "var(--color-bt-accent)",
          borderTopColor: "transparent",
        }}
      />
    </div>
  );
}

/** Couldn't load the board AND nothing cached to fall back to — a clear,
 *  retryable card instead of a confusing blank (Connectivity Layer 1). */
function LeaderboardLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl px-4 py-10 text-center"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="competition-leaderboard"
    >
      <CloudOff size={24} style={{ color: "var(--color-bt-text-dim)" }} />
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        Couldn&apos;t load the leaderboard
      </p>
      <p
        className="max-w-xs text-[12px] leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Check your connection — the board will be here when you&apos;re back.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5"
        style={{
          marginTop: 4,
          padding: "6px 14px",
          borderRadius: 9999,
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <RefreshCw size={13} strokeWidth={2.5} />
        Try again
      </button>
    </div>
  );
}
