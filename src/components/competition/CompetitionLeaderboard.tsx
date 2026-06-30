"use client";

import { useCallback, useEffect, useMemo } from "react";
import { Trophy, CloudOff, RefreshCw, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { GameRow, fmtPts } from "./GameRow";

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

interface LeaderboardData {
  teams: LBTeam[];
  games: LBGame[];
  cells: LBCell[];
  teamTotals: Record<string, number>;
  pointsAvailable: number;
  winNumber: number;
  pointsToClinch: Record<string, number>;
  defendingTeamId: string | null;
}

// ── Root component ────────────────────────────────────────────────────────────

interface Props {
  competitionId: string;
  tripId: string;
  /** Editor affordances on the board (the setup guide was retired — the board is
   *  the home now). Crew (non-editors) get none of these. */
  canEdit?: boolean;
  onAddGame?: () => void;
  /** Tap a team name on the hero/list → opens Rosters focused on that team's
   *  identity editor (captain-scoped; routed by the face). Member-visible. */
  onEditTeam?: (teamId: string) => void;
}

export function CompetitionLeaderboard({ competitionId, tripId, canEdit = false, onAddGame, onEditTeam }: Props) {
  const { data: lb, isLoading, isError, refetch } = trpc.competitions.leaderboard.useQuery(
    { tripId, competitionId },
    {
      enabled: !!competitionId,
      // No realtime subscription (D2 scope): refresh on a 30-second interval
      // so the board updates without a manual reload. A future realtime
      // invalidation can drop in by cancelling this interval.
      refetchInterval: 30_000,
    }
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

  const sessionsDone = liveGames.filter((g) => g.status === "complete").length;
  const allZero = teams.every((t) => (teamTotals[t.id] ?? 0) === 0);
  const nothingPlayed = liveGames.every((g) => g.status === "pending");
  const isEarly = allZero && nothingPlayed && liveGames.length > 0;
  const clincher = teams.find((t) => (pointsToClinch[t.id] ?? 1) <= 0) ?? null;

  if (isEarly) {
    return (
      <EarlyState
        teams={teams}
        liveGames={liveGames}
        winNumber={winNumber}
        tripId={tripId}
        mineSet={mineSet}
        viewer={viewer}
        onPrefetch={prefetchGame}
        canEdit={canEdit}
        onAddGame={onAddGame}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="competition-leaderboard">
      {/* Win banner */}
      {clincher && (
        <ClinchedBanner
          clincher={clincher}
          isDefender={clincher.id === defendingTeamId}
          teams={teams}
          teamTotals={teamTotals}
        />
      )}

      {/* Main standings panel */}
      <div
        className="overflow-hidden rounded-xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {/* Magic-number subtitle */}
        <div className="px-4 pt-3 pb-2">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {clincher
              ? "Final"
              : pointsAvailable > 0
              ? `First to ${fmtPts(winNumber)} wins`
              : "Competition standings"}
          </p>
        </div>

        {teams.length === 2 ? (
          <TwoTeamHero
            teams={teams}
            teamTotals={teamTotals}
            pointsAvailable={pointsAvailable}
            winNumber={winNumber}
            pointsToClinch={pointsToClinch}
            clincher={clincher}
            onEditTeam={onEditTeam}
          />
        ) : (
          <NTeamRankedList
            teams={teams}
            teamTotals={teamTotals}
            pointsAvailable={pointsAvailable}
            winNumber={winNumber}
            pointsToClinch={pointsToClinch}
            clincher={clincher}
            onEditTeam={onEditTeam}
          />
        )}
      </div>

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
        teams={teams}
        cellsByGame={cellsByGame}
        sessionsDone={sessionsDone}
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
  games, teams, cellsByGame, sessionsDone, tripId, mineSet, viewer, onPrefetch, canEdit, onAddGame,
}: {
  games: LBGame[];
  teams: LBTeam[];
  cellsByGame: Map<string, Map<string, LBCell>>;
  sessionsDone: number;
  tripId: string;
  mineSet: Set<string>;
  viewer: LBViewer;
  onPrefetch: (gameId: string) => void;
  canEdit: boolean;
  onAddGame?: () => void;
}) {
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
          {addBtn && <div className="mt-3">{addBtn}</div>}
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
        sessionsDone={sessionsDone}
        tripId={tripId}
        mineSet={mineSet}
        viewer={viewer}
        onPrefetch={onPrefetch}
      />
      {addBtn}
    </div>
  );
}

// ── TwoTeamHero ──────────────────────────────────────────────────────────────

function TwoTeamHero({
  teams,
  teamTotals,
  pointsAvailable,
  winNumber,
  pointsToClinch,
  clincher,
  onEditTeam,
}: {
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  pointsAvailable: number;
  winNumber: number;
  pointsToClinch: Record<string, number>;
  clincher: LBTeam | null;
  /** Tap a team name → that team's identity editor (owner / its captain). */
  onEditTeam?: (teamId: string) => void;
}) {
  const [a, b] = teams;
  const aTotal = teamTotals[a.id] ?? 0;
  const bTotal = teamTotals[b.id] ?? 0;
  const aToGo = pointsToClinch[a.id] ?? winNumber;
  const bToGo = pointsToClinch[b.id] ?? winNumber;

  // Progress bar proportions — each team's share of pointsAvailable.
  const aWidth = pointsAvailable > 0 ? Math.min(100, (aTotal / pointsAvailable) * 100) : 0;
  const bWidth = pointsAvailable > 0 ? Math.min(100, (bTotal / pointsAvailable) * 100) : 0;

  return (
    <div className="px-4 pb-4">
      {/* Team name row — tap a name → Rosters focused on that team (its identity
          editor opens for the owner / that team's captain; read-only otherwise). */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onEditTeam?.(a.id)}
          disabled={!onEditTeam}
          className="text-[11px] font-bold uppercase tracking-widest disabled:cursor-default"
          style={{ color: a.color }}
          data-testid="comp-team-name-a"
        >
          {a.short_name}
        </button>
        <button
          type="button"
          onClick={() => onEditTeam?.(b.id)}
          disabled={!onEditTeam}
          className="text-[11px] font-bold uppercase tracking-widest disabled:cursor-default"
          style={{ color: b.color }}
          data-testid="comp-team-name-b"
        >
          {b.short_name}
        </button>
      </div>

      {/* Big totals */}
      <div className="flex items-baseline justify-between">
        <span
          className="text-5xl font-black tabular-nums leading-none"
          style={{ color: a.color }}
        >
          {fmtPts(aTotal)}
        </span>
        <span
          className="mx-3 text-2xl font-light"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          –
        </span>
        <span
          className="text-5xl font-black tabular-nums leading-none"
          style={{ color: b.color }}
        >
          {fmtPts(bTotal)}
        </span>
      </div>

      {/* "X to clinch" sub-labels */}
      {!clincher && (
        <div className="mt-1 flex items-start justify-between">
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {aToGo > 0 ? `${fmtPts(aToGo)} to clinch` : "Clinched"}
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {bToGo > 0 ? `${fmtPts(bToGo)} to clinch` : "Clinched"}
          </p>
        </div>
      )}

      {/* Progress bar */}
      <div
        className="mt-3 flex h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        <div
          className="h-full rounded-l-full transition-all duration-500"
          style={{ width: `${aWidth}%`, background: a.color }}
        />
        <div
          className="h-full rounded-r-full transition-all duration-500 ml-auto"
          style={{ width: `${bWidth}%`, background: b.color }}
        />
      </div>

      {/* Footer row */}
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {pointsAvailable > 0 ? `${fmtPts(pointsAvailable)} pts in play` : "No pts yet"}
        </p>
        {!clincher && pointsAvailable > 0 && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            clinch {fmtPts(winNumber)}
          </p>
        )}
        {clincher && (
          <p className="text-[11px] font-semibold" style={{ color: "var(--color-bt-accent)" }}>
            Final
          </p>
        )}
      </div>
    </div>
  );
}

// ── NTeamRankedList ───────────────────────────────────────────────────────────

function NTeamRankedList({
  teams,
  teamTotals,
  pointsAvailable,
  winNumber,
  pointsToClinch,
  clincher,
  onEditTeam,
}: {
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  pointsAvailable: number;
  winNumber: number;
  pointsToClinch: Record<string, number>;
  clincher: LBTeam | null;
  /** Tap a team name → that team's identity editor (owner / its captain). */
  onEditTeam?: (teamId: string) => void;
}) {
  const sorted = [...teams].sort(
    (a, b) => (teamTotals[b.id] ?? 0) - (teamTotals[a.id] ?? 0)
  );

  return (
    <div className="px-4 pb-3">
      {!clincher && pointsAvailable > 0 && (
        <p
          className="mb-3 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {fmtPts(pointsAvailable)} pts in play
        </p>
      )}
      <div className="space-y-2">
        {sorted.map((team, idx) => {
          const total = teamTotals[team.id] ?? 0;
          const barWidth =
            pointsAvailable > 0
              ? Math.min(100, (total / pointsAvailable) * 100)
              : 0;
          const toGo = pointsToClinch[team.id] ?? winNumber;
          const hasClinched = toGo <= 0;

          return (
            <div key={team.id} className="flex items-center gap-3">
              {/* Rank */}
              <span
                className="w-4 shrink-0 text-[12px] font-semibold tabular-nums"
                style={{ color: hasClinched ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
              >
                {idx + 1}
              </span>

              {/* Dot + name — tappable → that team's Rosters/identity editor. */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  {onEditTeam ? (
                    <button
                      type="button"
                      onClick={() => onEditTeam(team.id)}
                      className="flex min-w-0 items-center gap-1.5 text-left"
                      data-testid={`comp-team-name-${team.id}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: team.color }} />
                      <span className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                        {team.name}
                      </span>
                    </button>
                  ) : (
                    <>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: team.color }} />
                      <span className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                        {team.name}
                      </span>
                    </>
                  )}
                  {hasClinched && (
                    <Trophy
                      size={12}
                      style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
                    />
                  )}
                </div>
                {/* Bar */}
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ background: "var(--color-bt-card-raised)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${barWidth}%`, background: team.color }}
                  />
                </div>
              </div>

              {/* Points */}
              <span
                className="shrink-0 text-base font-bold tabular-nums"
                style={{ color: hasClinched ? team.color : "var(--color-bt-text)" }}
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

function SessionBreakdown({
  games,
  teams,
  cellsByGame,
  sessionsDone,
  tripId,
  mineSet,
  viewer,
  onPrefetch,
}: {
  games: LBGame[];
  teams: LBTeam[];
  cellsByGame: Map<string, Map<string, LBCell>>;
  sessionsDone: number;
  tripId: string;
  mineSet: Set<string>;
  viewer: LBViewer;
  onPrefetch: (gameId: string) => void;
}) {
  return (
    <div>
      <p
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Sessions{" "}
        <span style={{ color: "var(--color-bt-text)" }}>
          · {sessionsDone} of {games.length} done
        </span>
      </p>
      <div className="flex flex-col gap-2">
        {games.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            teams={teams}
            cells={cellsByGame.get(game.id)}
            tripId={tripId}
            mine={mineSet.has(game.id)}
            viewerName={viewer.name}
            viewerAvatarIcon={viewer.avatarIcon}
            viewerTeamColor={viewer.teamColor}
            onPrefetch={onPrefetch}
          />
        ))}
      </div>
    </div>
  );
}

// ── EarlyState ────────────────────────────────────────────────────────────────

function EarlyState({
  teams,
  liveGames,
  winNumber,
  tripId,
  mineSet,
  viewer,
  onPrefetch,
  canEdit,
  onAddGame,
}: {
  teams: LBTeam[];
  liveGames: LBGame[];
  winNumber: number;
  tripId: string;
  mineSet: Set<string>;
  viewer: LBViewer;
  onPrefetch: (gameId: string) => void;
  canEdit: boolean;
  onAddGame?: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="competition-leaderboard">
      {/* Team dots row */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-4"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {teams.map((team) => (
          <div key={team.id} className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: team.color }}
            />
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {team.name}
            </span>
          </div>
        ))}

        <div
          className="mt-3 w-full"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        />
        <div className="w-full pt-1">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            The cup hasn&rsquo;t started
          </p>
          <p
            className="mt-1 text-[12px] leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {liveGames.length} session{liveGames.length !== 1 ? "s" : ""} ·{" "}
            first to {fmtPts(winNumber)} wins. Standings appear as games finish.
          </p>
        </div>
      </div>

      {/* Schedule */}
      {liveGames.length > 0 && (
        <div>
          <p
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            The Schedule
          </p>
          <div className="flex flex-col gap-2">
            {liveGames.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                teams={teams}
                cells={undefined}
                tripId={tripId}
                mine={mineSet.has(game.id)}
                viewerName={viewer.name}
                viewerAvatarIcon={viewer.avatarIcon}
                viewerTeamColor={viewer.teamColor}
                onPrefetch={onPrefetch}
              />
            ))}
          </div>
        </div>
      )}

      {/* Keep "Add a game" reachable in the setup/early phase — this is the
          prime time to build the schedule, and it's the board's sole entry to
          the add-game modal now that the aggregate panel is retired. */}
      {canEdit && onAddGame && (
        <button
          type="button"
          onClick={onAddGame}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-3"
          style={{ background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
          data-testid="comp-add-game"
        >
          <Plus size={16} /> Add a game
        </button>
      )}
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

  const verb = isDefender ? "retains" : "wins the cup";

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
