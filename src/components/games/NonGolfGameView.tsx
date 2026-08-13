"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";
import {useRouter, useSearchParams } from "next/navigation";
import { useTripId } from "@/components/TripIdProvider";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY, LEADERBOARD_QUERY } from "@/lib/queryConfig";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameSettingsPage } from "@/components/games/GameSettingsPage";
import { NonGolfTotalPointsRow, NonGolfSettingsRows } from "@/components/games/NonGolfSettingsRows";
import { NonGolfScoreboard } from "@/components/games/NonGolfScoreboard";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { GamePageHeader } from "@/components/competition/GamePageHeader";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useConfigDraft } from "@/hooks/useConfigDraft";
import { useInGamePanel, useGameSurfaceChrome } from "@/components/games/GameChrome";
import { GameStandaloneHeader } from "@/components/games/GameStandaloneHeader";
import { useConfigSync } from "@/hooks/useConfigSync";
import { useRealtimeGame } from "@/hooks/useRealtimeGame";
import { useExitToBoard } from "@/hooks/useExitToBoard";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { useRealtimeScoreEvents } from "@/hooks/useRealtimeScoreEvents";
import { GAME_TYPES, isManualGameType, type ScoringModel } from "@/lib/gameTypes";
import {
  configToNonGolfDraft,
  nonGolfDraftToPayload,
  nonGolfDraftsEqual,
  type NonGolfConfigDraft,
  type CompetitionFormat,
} from "@/lib/configDraft";
import { isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { BracketSettingsRows, ClearPairingsPrompt } from "@/components/games/bracket/BracketSettingsRows";
import { BracketBoard, type BracketEntrantMeta } from "@/components/games/bracket/BracketBoard";
import { resolveDraw, matchKey, type WinnerBySeed } from "@/lib/bracketAdvance";
import { DEFAULT_BRACKET_CONFIG, bracketFieldReady, type BracketConfig } from "@/lib/bracketDraft";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { placeCapacityFor } from "@/lib/placeCapacity";
import { validatePlacement, placementRefusalMessage } from "@/lib/gameConfig";
import { pointsReady } from "@/lib/matchDraft";
import { placementsFrom, pointsForPlacements } from "@/lib/placementGroups";
import { gameLockState } from "@/lib/gameLifecycle";
import type { GameRow, LBTeamLite } from "@/components/competition/CompetitionGamesPanel";


/** Shared empty tie-set, so the untouched case keeps a stable identity across
 *  renders and doesn't retrigger the memos that depend on it. */
const EMPTY_TIES: ReadonlySet<string> = new Set<string>();

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
 *
 * Spec 2 Phase 2: a persistence-BOUND composed view, re-HOSTED by both its route
 * wrapper AND the leaderboard's game PANEL (CompetitionFace) — same recipe as
 * MatchGameView. Reads its OWN tripId + gameId (?game=); the back arrow closes
 * the panel for free.
 */
export function NonGolfGameView() {
  const { tripId } = useTripId();
  const router = useRouter();
  const search = useSearchParams();
  const urlGameId = search.get("game");

  const utils = trpc.useUtils();
  // #501 Part 1: delegate-aware — a game-delegate (even a plain Member) edits this
  // game, mirroring the server's `canEditGame`. `isOwner` stays trip-Owner-only.
  const { canEdit, isOwner, canManageGame } = useGameEditAccess(tripId, urlGameId);

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
  // Where posting a result leaves you. The three golf formats adopted this in
  // #806; non-golf kept a bare `router.back()` and so kept the cold-deep-link
  // exposure the hook exists to close (#808).
  const exitToBoard = useExitToBoard(tripId, competitionId);

  // Live standings. useRealtimeGame (below) covers this game's CONFIG; this
  // covers score/lifecycle events across the whole competition, which is what
  // moves the standings shown here. LEADERBOARD_QUERY is now just the backstop.
  useRealtimeScoreEvents(tripId, competitionId);

  // STATE query — LEADERBOARD_QUERY is the shared policy for this key
  // (queryConfig.ts); this observer previously had no freshness mechanism at
  // all (no poll, and useRealtimeGame doesn't invalidate this key).
  const lbQ = trpc.competitions.leaderboard.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...LEADERBOARD_QUERY, enabled: !!tripId && !!competitionId }
  );

  // Config sync: on a config change from another device (modifiers/rules, run
  // config, name, go-live, finish) silently refetch this game's config so members
  // converge. Non-golf "scores" are posted RESULTS (score-derived, not in the
  // config hash) — those already reflect via the board's shared leaderboard poll,
  // so here we invalidate the config (getById) + the leaderboard read.
  const onConfigChanged = useCallback(() => {
    if (tripId && urlGameId) {
      void utils.games.getById.invalidate({ tripId, gameId: urlGameId });
      // The pool + draw are hashed config (migration 115) but live in their own
      // tables and their own read, so the hash moving has to refresh this too —
      // invalidating only `getById` would converge every bracket setting EXCEPT
      // the field itself.
      void utils.games.bracketPool.invalidate({ tripId, gameId: urlGameId });
    }
    if (tripId && competitionId) void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
  }, [utils, tripId, urlGameId, competitionId]);
  useConfigSync(tripId, urlGameId, !!urlGameId, onConfigChanged);
  // Realtime config push (migration 084): the INSTANT half — another browser sees a
  // settings change without waiting out the poll above (which is also paused on a
  // hidden tab). Pure invalidate; composes with `draftTouched` — a clean page
  // re-seeds live, a dirty page holds its edits and gets its honest CONFLICT at Save.
  // Non-golf had NO freshness mechanism before this (no score poll — results post via
  // games.finish's manual arm, not per-hole entries — and its own leaderboard read has no
  // refetchInterval, DATA_FRESHNESS_AUDIT.md §8-F9), so this is its first one.
  useRealtimeGame(tripId, urlGameId);

  // Membership realtime (#791). These four views also render as STANDALONE
  // routes (`/trips/{id}/games/...`), where neither the trip page nor
  // `LiveFaceClient` is mounted above them — so nothing was invalidating
  // `tripMembers.list`, and `useTripRole` (via `useGameEditAccess`) had NO
  // refetch trigger at all: `refetchOnMount` only fires on mount, and
  // `refetchOnWindowFocus` is globally false. A role change while this view sat
  // open was therefore not "stale for 60s" but frozen for the life of the
  // mount, so a newly-promoted Organizer never saw their settings gear appear.
  //
  // Safe to add even though this component ALSO renders as a panel over the
  // board (where two other subscribers already exist): the hook is ref-counted
  // per topic since #791, so N subscribers share one join.
  useRealtimeMembers(tripId);
  const teams = useMemo(() => ((lbQ.data?.teams ?? []) as LBTeamLite[]), [lbQ.data]);
  const gameCells = useMemo(
    () => ((lbQ.data?.cells ?? []) as { gameId: string; teamId: string; place: number; points: number }[])
      .filter((c) => c.gameId === urlGameId)
      .sort((a, b) => a.place - b.place),
    [lbQ.data, urlGameId]
  );
  // #533 projection (non-golf) — the POSTED per-team points for THIS game (the
  // leaderboard cells). This is the committed picture; the live preview below is
  // what moves before a save.
  const postedPerTeam = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of gameCells) out[c.teamId] = (out[c.teamId] ?? 0) + c.points;
    return out;
  }, [gameCells]);
  const serverOrder = useMemo(
    () => (gameCells.length ? gameCells.map((c) => c.teamId) : teams.map((t) => t.id)),
    [gameCells, teams]
  );
  // Seed the match control's declared outcome from the posted cells — a draw is
  // both sides at place 1 (the win/lose/tie post writes both → position 1).
  const serverResult = useMemo(() => {
    if (gameCells.length === 2 && gameCells.every((c) => c.place === 1)) return "tie";
    return gameCells[0]?.teamId;
  }, [gameCells]);

  // ── Result entry, lifted (the projection fix) ───────────────────────────────
  // The outcome selection used to live inside `NonGolfScoreboard` while the
  // header projection was computed HERE off the posted leaderboard cells. Two
  // places, no connection — so picking a winner moved the buttons and nothing
  // else, because the number was reading committed server state that by
  // definition cannot move until you save. Golf does not work this way: its
  // projection is a `useMemo` over the SAME unsaved entry state the scorecard
  // renders (MatchGameView's `projectionPerTeam` → `rollupMatchPlay`). Lifting
  // the selection to the component that draws the projection is what lets
  // non-golf use that identical mechanism instead of a second one.
  //
  // Null sentinel = "untouched, read the server mirror", the draft idiom this
  // file already uses for config (CLAUDE.md #18). Two things fall out of it for
  // free that a `useState(initialX)` seed does not give:
  //   - the seed is not captured on first render. `initialOrder`/`initialResult`
  //     derive from `lbQ`, which this view does NOT gate rendering on (only
  //     `gameQ`), so a scoreboard that mounted before the leaderboard resolved
  //     kept an empty seed forever — a correcting game silently lost its
  //     recorded outcome.
  //   - `!== null` IS the "has the user expressed an intent yet" signal the
  //     resting state needs (see `hasDeclaredOutcome`).
  const [resultDraft, setResultDraft] = useState<string | null>(null);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [tiedDraft, setTiedDraft] = useState<ReadonlySet<string> | null>(null);

  const result = resultDraft ?? serverResult ?? "";
  const order = orderDraft ?? serverOrder;
  const tiedWithPrev = tiedDraft ?? EMPTY_TIES;
  const toggleTie = useCallback((teamId: string) => {
    setTiedDraft((prev) => {
      const next = new Set(prev ?? EMPTY_TIES);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }, []);

  // Head-to-head win/lose/tie vs the finishing-order editor — the same split
  // `NonGolfScoreboard` branches its control on, needed here too because the two
  // shapes build different placements. Derived from the same inputs, so they
  // cannot disagree.
  const winLoseTie = scoringModel === "match_play" && teams.length === 2;

  /**
   * The EXACT payload `games.finish` will be given — built here, previewed here,
   * and handed to the scoreboard to post unchanged. One array, two consumers, so
   * a preview that disagrees with the committed result is not expressible.
   * `null` = nothing declared yet (win/lose/tie with no pick).
   */
  const draftPlacements = useMemo(() => {
    if (winLoseTie) {
      if (!result) return null;
      return result === "tie"
        ? teams.map((t) => ({ entityId: t.id, position: 1 }))
        : teams.map((t) => ({ entityId: t.id, position: t.id === result ? 1 : 2 }));
    }
    return placementsFrom(order, tiedWithPrev);
  }, [winLoseTie, result, teams, order, tiedWithPrev]);

  /**
   * Which payout array scores this game — chosen the SAME way the server chooses
   * it (competitionLeaderboard.ts), which is what makes the preview match:
   *   - manual match-play → `[points_total, 0]`, winner-take-all, tie averages
   *   - placement        → the configured `points_distribution.values`
   */
  const draftDistribution = useMemo<number[]>(() => {
    if (winLoseTie) {
      const total = Number(game?.points_total ?? 0);
      return total > 0 ? [total, 0] : [];
    }
    const d = game?.points_distribution as PointsDistribution | null | undefined;
    return isPlacement(d) ? d.values : [];
  }, [winLoseTie, game?.points_total, game?.points_distribution]);

  /**
   * Has anyone actually declared an outcome? Guards the resting state: an
   * untouched game must NOT start claiming a result.
   *
   * The two shapes answer it differently and genuinely so. Win/lose/tie has a
   * real unselected state (`result === ""`). A finishing order does not — `order`
   * always holds SOMETHING, falling back to roster order — so for that shape the
   * question is whether the user has touched it, or whether a result is already
   * posted.
   */
  const hasDeclaredOutcome = winLoseTie
    ? result !== ""
    : orderDraft !== null || tiedDraft !== null || gameCells.length > 0;

  const draftProjection = useMemo(() => {
    if (!hasDeclaredOutcome || !draftPlacements) return null;
    const pts = pointsForPlacements(draftPlacements, draftDistribution);
    const out: Record<string, number> = {};
    for (const [teamId, v] of pts) out[teamId] = v;
    return out;
  }, [hasDeclaredOutcome, draftPlacements, draftDistribution]);

  // The same shared predicate the scoreboard's controls read (CLAUDE.md #24), so
  // "are the buttons live?" and "is the header previewing?" cannot disagree.
  const { isFinal: resultFinal, isLocked: resultLocked } = gameLockState({
    status: game?.status,
    correctionsOpen: !!game?.corrections_open,
  });

  // SERVER scoring state — drives which PAGE renders (setup placeholder vs scoreboard):
  // the game's actual visibility follows the server, not a staged toggle. The settings
  // toggle reads the DRAFT (configDraft.scoringEnabled) + `staged` instead (below).
  const scoringEnabled = (game as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  const typeDef = GAME_TYPES.find((t) => t.id === game?.game_type_id);
  const typeName = typeDef?.name ?? "Game";

  // ── Draft-then-save (P2 non-golf flip) ──────────────────────────────────────
  // The WHOLE settings page is ONE composite draft (name / delegate / rules / format /
  // points / the scoring flag), committed atomically via save_game_config on Save —
  // NOTHING self-persists. A LEAN variant (NonGolfConfigDraft: no matches / course /
  // groupings), mirroring the match page's model. There are NO locks: non-golf has no
  // destroys-tier setting (the thesis), so the page is fully editable even while live —
  // an edit stages, Save commits it.
  const orgQ = trpc.games.listOrganizers.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { enabled: !!tripId && !!urlGameId },
  );
  const serverDelegates = useMemo(
    () => ((orgQ.data as { user_id: string }[] | undefined) ?? []).map((d) => d.user_id),
    [orgQ.data],
  );

  // ── The bracket's three reads ───────────────────────────────────────────────
  // The POOL (seed-ordered) is what the draft baseline seeds from, so an
  // untouched settings page for a bracket that already has a field is not dirty.
  // Enabled for EVERY non-golf game, not just a bracket: `serverConfigDraft` has
  // to be built before anything has decided which format this is, and a
  // non-bracket simply reads back an empty pool.
  const poolQ = trpc.games.bracketPool.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId },
  );
  // The picker's sections: the crew, grouped by their cup team. Team-scoped, so
  // both are gated on a resolved competition — a standalone game has neither.
  const assignQ = trpc.teamAssignments.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId },
  );
  const crewQ = trpc.tripMembers.list.useQuery(
    { tripId: tripId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId },
  );

  const serverEntrants = useMemo(
    () => ((poolQ.data as { userIds: string[] }[] | undefined) ?? []).map((e) => [...e.userIds]),
    [poolQ.data],
  );

  /** user id → cup team. The payload reads an entrant's team from its FIRST
   *  member (`nonGolfDraftToPayload`); this is the map it reads it out of. */
  const teamByUser = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const a of ((assignQ.data ?? []) as { user_id: string; team_id: string }[])) out[a.user_id] = a.team_id;
    return out;
  }, [assignQ.data]);

  /**
   * The pool builder's team sections — the crew grouped by cup team.
   *
   * Teams come from the leaderboard read this view already holds (id / name /
   * color), so there is no second teams query to keep in step with the one the
   * scoreboard renders from.
   *
   * A player on NO team is deliberately absent, unlike the stroke picker's
   * "Crew" bucket. A bracket entrant's team is where its points land, and the
   * server refuses a null-team entrant outright ("a bracket needs a cup to score
   * into") — so offering an unassigned player would be offering a pick that
   * cannot be saved. Same posture as `sameTeamOnly`: shape the options rather
   * than refuse the tap.
   */
  const pickerTeams = useMemo<GroupBuilderTeam[]>(() => {
    const crewList = ((crewQ.data ?? []) as { user_id: string; displayName?: string | null; user?: { name?: string | null } | null }[])
      .map((c) => ({ id: c.user_id, name: c.displayName ?? c.user?.name ?? "Player", avatarIcon: null as string | null }));
    const sections: GroupBuilderTeam[] = [];
    for (const t of teams) {
      const players = crewList.filter((c) => teamByUser[c.id] === t.id);
      if (players.length) sections.push({ id: t.id, name: t.name, color: t.color, players });
    }
    return sections;
  }, [teams, teamByUser, crewQ.data]);

  // Draft slices — a scalar sentinel means "untouched, read the server mirror". name/
  // rules/scoring/delegates use null; format/points can BE null, so they use undefined.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [scoringDraft, setScoringDraft] = useState<boolean | null>(null);
  const [formatDraft, setFormatDraft] = useState<CompetitionFormat | null | undefined>(undefined);
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null | undefined>(undefined);
  const [pointsDistDraft, setPointsDistDraft] = useState<PointsDistribution | null | undefined>(undefined);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);
  // The bracket's two slices. Entrants is a list, so null is a clean sentinel;
  // the config can legitimately BE null (every non-bracket game), so it needs
  // undefined — the same reason format/points above do.
  const [entrantsDraft, setEntrantsDraft] = useState<string[][] | null>(null);
  const [bracketConfigDraft, setBracketConfigDraft] = useState<BracketConfig | null | undefined>(undefined);

  const serverConfigDraft = useMemo<NonGolfConfigDraft>(
    () => configToNonGolfDraft((game ?? {}) as Parameters<typeof configToNonGolfDraft>[0], serverDelegates, serverEntrants),
    [game, serverDelegates, serverEntrants],
  );
  const anyTouched =
    nameDraft !== null || rulesDraft !== null || scoringDraft !== null ||
    formatDraft !== undefined || pointsTotalDraft !== undefined || pointsDistDraft !== undefined ||
    delegatesDraft !== null || entrantsDraft !== null || bracketConfigDraft !== undefined;

  const configDraft = useMemo<NonGolfConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      scoringEnabled: scoringDraft ?? serverConfigDraft.scoringEnabled,
      competitionFormat: formatDraft !== undefined ? formatDraft : serverConfigDraft.competitionFormat,
      pointsTotal: pointsTotalDraft !== undefined ? pointsTotalDraft : serverConfigDraft.pointsTotal,
      pointsDistribution: pointsDistDraft !== undefined ? pointsDistDraft : serverConfigDraft.pointsDistribution,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
      bracketConfig: bracketConfigDraft !== undefined ? bracketConfigDraft : serverConfigDraft.bracketConfig,
      bracketEntrants: entrantsDraft ?? serverConfigDraft.bracketEntrants,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, scoringDraft, formatDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft, entrantsDraft, bracketConfigDraft],
  );

  // ── The bracket's derived shape, read by everything below ───────────────────
  // `isBracket` and the entrant count both come off the DRAFT, so the rows, the
  // place ceiling and the payload all answer from the same state — a staged
  // format switch takes effect everywhere at once rather than in the one place
  // that happened to be repointed (CLAUDE.md #18).
  const isBracket = configDraft.competitionFormat === "bracket";

  // ── The bracket's play surface (phase 3) ────────────────────────────────────
  // The DRAW as stored, resolved into occupants HERE. The server returns the
  // stored rows and leaves advancement to the reader on purpose, so this runs
  // the same `resolveDraw` the pick mutation validates against — one answer to
  // "who is in this match", not two that agree by luck.
  const drawQ = trpc.games.bracketDraw.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId && isBracket },
  );
  const resolvedDraw = useMemo(() => {
    const rows = (drawQ.data ?? []) as { bracket: "main" | "consolation"; round: number; slot: number; aSeed: number | null; bSeed: number | null; winnerSeed: number | null }[];
    const winners: WinnerBySeed = {};
    for (const r of rows) winners[matchKey(r)] = r.winnerSeed;
    return resolveDraw(
      rows.map((r) => ({ bracket: r.bracket, round: r.round, slot: r.slot, aSeed: r.aSeed, bSeed: r.bSeed })),
      winners,
    );
  }, [drawQ.data]);

  /**
   * Seed → who that is, for the board's rows.
   *
   * Names and team colour come from `pickerTeams`, which the settings picker
   * already builds from the crew grouped by cup team — so a bracket row and the
   * picker that filled it read the same roster. The entrant's team is taken from
   * its FIRST member, the same rule the payload uses when it writes `team_id`.
   */
  const bracketEntrantMeta = useMemo<BracketEntrantMeta[]>(() => {
    const meta = new Map<string, { name: string; color: string }>();
    for (const t of pickerTeams) for (const p of t.players) meta.set(p.id, { name: p.name, color: t.color });
    return ((poolQ.data ?? []) as { seed: number; userIds: string[] }[]).map((e) => {
      const first = meta.get(e.userIds[0]);
      const second = e.userIds[1] ? meta.get(e.userIds[1]) : undefined;
      return {
        seed: e.seed,
        name: first?.name ?? "Player",
        partner: e.userIds[1] ? second?.name ?? "Player" : null,
        teamColor: first?.color ?? null,
      };
    });
  }, [poolQ.data, pickerTeams]);

  const [pickError, setPickError] = useState<string | null>(null);
  const pickMutation = trpc.games.pickWinner.useMutation({
    // Server truth on both paths — a pick changes what the WHOLE tree derives,
    // so there is nothing useful to patch optimistically and a wrong local
    // guess would be visible three rounds up. The refetch is one small query.
    onSuccess: () => {
      setPickError(null);
      void utils.games.bracketDraw.invalidate({ tripId: tripId!, gameId: urlGameId! });
    },
    onError: (e) => setPickError(e.message),
  });
  const handlePick = useCallback(
    (ref: { bracket: "main" | "consolation"; round: number; slot: number }, seed: number | null) => {
      if (!tripId || !urlGameId) return;
      setPickError(null);
      pickMutation.mutate({ tripId, gameId: urlGameId, ...ref, winnerSeed: seed });
    },
    [pickMutation, tripId, urlGameId],
  );

  const filledEntrants = useMemo(
    () => configDraft.bracketEntrants.filter((e) => e.length > 0),
    [configDraft.bracketEntrants],
  );
  /**
   * How many finishing places this game HAS — the ceiling the placement split is
   * validated against.
   *
   * A bracket's is its FIELD (#916); every other non-golf format's is the team
   * count. Derived ONCE here and read by both consumers — the Save block and the
   * inline warning in the distribution editor — because two derivations of one
   * number is how the save bar and the editor come to disagree about whether a
   * split fits. The server applies the same rule to the same incoming pool.
   */
  const capacity = useMemo(
    () => placeCapacityFor({
      entrantCount: isBracket ? filledEntrants.length : null,
      teamCount: teams.length || null,
    }),
    [isBracket, filledEntrants.length, teams.length],
  );

  // C1: block Save when a STARTED placement split no longer sums to the total (owner
  // changed Total Points after distributing). Re-derived from the draft, not snapshotted.
  // null = fine (undistributed / per_match / exact). Server refine is the authority.
  const distSaveBlock = useMemo(() => {
    const d = configDraft.pointsDistribution;
    if (!isPlacement(d)) return null;
    // A null total blocks the SUM check (nothing to sum against) but NOT the
    // places-vs-entities one, which never reads the total — #819 nested both
    // under this guard, so a no-total game could save an unappliable split.
    if (configDraft.pointsTotal == null) {
      const noTotal = validatePlacement(0, d.values, capacity);
      return noTotal.state === "too_many_places" ? placementRefusalMessage(noTotal) : null;
    }
    // The ceiling is `capacity` — a bracket's field, otherwise the teams the
    // leaderboard ranks. Unknown while a read is in flight, which never refuses.
    const v = validatePlacement(configDraft.pointsTotal, d.values, capacity);
    return v.saveable ? null : placementRefusalMessage(v);
  }, [configDraft.pointsDistribution, configDraft.pointsTotal, capacity]);

  // Outbox bundle + slice reset/recover (format-specific; the shared hook below drives
  // the whole lifecycle off these).
  const draftBundle = useMemo(
    () => ({ name: nameDraft, rules: rulesDraft, scoring: scoringDraft, format: formatDraft, pointsTotal: pointsTotalDraft, pointsDist: pointsDistDraft, delegates: delegatesDraft, entrants: entrantsDraft, bracketConfig: bracketConfigDraft }),
    [nameDraft, rulesDraft, scoringDraft, formatDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft, entrantsDraft, bracketConfigDraft],
  );
  function resetSlices() {
    setNameDraft(null); setRulesDraft(null); setScoringDraft(null);
    setFormatDraft(undefined); setPointsTotalDraft(undefined); setPointsDistDraft(undefined);
    setDelegatesDraft(null); setEntrantsDraft(null); setBracketConfigDraft(undefined);
  }
  const applyBundle = useCallback((b: typeof draftBundle) => {
    if (b.name !== null) setNameDraft(b.name);
    if (b.rules !== null) setRulesDraft(b.rules);
    if (b.scoring !== null) setScoringDraft(b.scoring);
    if (b.format !== undefined) setFormatDraft(b.format);
    if (b.pointsTotal !== undefined) setPointsTotalDraft(b.pointsTotal);
    if (b.pointsDist !== undefined) setPointsDistDraft(b.pointsDist);
    if (b.delegates !== null) setDelegatesDraft(b.delegates);
    if (b.entrants !== null) setEntrantsDraft(b.entrants);
    if (b.bracketConfig !== undefined) setBracketConfigDraft(b.bracketConfig);
  }, []);

  // The settings overlay stays here (confirm-on-leave refs the shared hook writes below).
  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});
  const {
    open: showConfig, openConfig, closeConfig, confirmingClose, confirmDiscard, cancelClose, leave,
  } = useGameSettingsOverlay({
    canEdit,
    deepLink: search.get("settings") === "1",
    isDirty: () => dirtyRef.current,
    onDiscard: () => discardRef.current(),
  });

  // The shared draft-then-save lifecycle (#626): baseline + hash + dirty + outbox +
  // confirm-on-leave sync + the atomic Save. Format-specific pieces (slices →
  // serverConfigDraft / configDraft / anyTouched, the pure equal/payload fns, the bundle,
  // the overlay refs) are passed in.
  const {
    dirty, saveError, saving, handleSave: handleSaveConfig,
    stayOpenOnSave,
  } = useConfigDraft<NonGolfConfigDraft, typeof draftBundle>({
    tripId, gameId: urlGameId, view: "nongolf", canEdit,
    showConfig, dirtyRef, discardRef,
    // EVERY query feeding serverConfigDraft (see StrokeGameView's call): the game row,
    // orgQ (the delegates slice), poolQ (the entrants slice) — plus assignQ, which
    // feeds no draft field but resolves every entrant's TEAM at payload time. A save
    // that ran before it landed would send `teamId: null` for the whole field and be
    // refused server-side ("a bracket needs a cup to score into") on a page the user
    // filled in correctly, so it gates the baseline like the rest.
    ready: !!game && !!orgQ.data && !!poolQ.data && (!competitionId || !!assignQ.data),
    serverConfigDraft, configDraft, anyTouched,
    draftsEqual: nonGolfDraftsEqual,
    toPayload: (draft, base) => nonGolfDraftToPayload(draft, base, { teamByUser }),
    bundle: draftBundle, applyRecovered: applyBundle, reset: resetSlices,
    onSaved: async () => { await refreshGame(); utils.games.listOrganizers.invalidate({ tripId: tripId!, gameId: urlGameId! }); },
  });

  async function refreshGame() {
    await gameQ.refetch();
    // The pool is a separate read from the game row, so a save that rebuilt the
    // field would otherwise leave the baseline seeded from the old one — the page
    // would report itself dirty against a pool it just persisted.
    utils.games.bracketPool.invalidate({ tripId, gameId: urlGameId! });
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  // ── The format switch, and the pool it can destroy ──────────────────────────
  // Wrapped in an object so a pending switch to the null (unset → Head-to-Head)
  // format is distinguishable from "nothing pending".
  const [pendingFormat, setPendingFormat] = useState<{ next: CompetitionFormat | null } | null>(null);

  /**
   * Stage a format change — with the two side effects that make the bracket's
   * rows and its payload consistent with it.
   *
   * INTO a bracket: stage a config if the game has none. `bracket_config`
   * defaults to `{}`, which decodes to null, so a game switched to Bracket has
   * no settings for the rows to render or for the payload to emit — the format
   * would save and the bracket would come back unconfigured. Only when it has
   * none: switching away and back must not discard settings the user made.
   *
   * OUT of a bracket: empty the pool. The payload sends that emptied pool as an
   * explicit clear, which is what makes the confirm below tell the truth.
   */
  function applyFormat(next: CompetitionFormat | null) {
    setFormatDraft(next);
    if (next === "bracket") {
      if (!configDraft.bracketConfig) setBracketConfigDraft(DEFAULT_BRACKET_CONFIG);
    } else {
      setEntrantsDraft([]);
    }
  }
  /** Leaving Bracket with a field built costs that field, so it asks first —
   *  through the SAME prompt the partners → singles change uses, because it is
   *  the same event from the user's side. Nothing else about a format change
   *  destroys anything, so nothing else asks. */
  function requestFormat(next: CompetitionFormat | null) {
    if (next === configDraft.competitionFormat) return;
    if (isBracket && filledEntrants.length > 0) {
      setPendingFormat({ next });
      return;
    }
    applyFormat(next);
  }

  // The Setup/Scoring toggle is now a DRAFT edit — staging scoring_enabled; Save commits
  // it WITH the config in one atomic RPC (go-live readiness is re-asserted server-side
  // inside the tx, so the client gate can't be bypassed).
  function handleEnable() { setScoringDraft(true); }
  function handleDisable() { setScoringDraft(false); }

  // #550: as a PANEL, publish chrome to the app bar (back/title + owner gear)
  // instead of a second header. Non-golf has no focused entry surface (posted
  // results), so the bottom nav stays. Standalone route keeps its own header.
  const inPanel = useInGamePanel();
  const standaloneChrome = useGameSurfaceChrome(
    game
      ? {
          title: (game?.name as string | undefined)?.trim() || typeName,
          onSettings: game && !showConfig && canEdit ? openConfig : undefined,
          // Rules reachable at every depth — see GameChrome's `rules` note.
          rules:
            game && tripId && !showConfig
              ? {
                  tripId,
                  gameId: game.id as string,
                  gameTypeId: (game as unknown as GameRow).game_type_id,
                  text: (game.rules_for_today as string | null) ?? null,
                  canEdit,
                }
              : undefined,
        }
      : null,
  );

  if (!tripId || !urlGameId) return <Spinner />;
  if (gameQ.isLoading || !game) return <Spinner />;

  // As a panel the app bar carries back/title/gear (published above) → no own
  // header. Standalone route (no bar) keeps it.
  // The SHARED route header — actions come from the same chrome object the panel
  // publishes, so the two hosts cannot show different ones. Null chrome = panel
  // mode, where `GameActionRow` is already drawing them.
  const header = (title: string) =>
    standaloneChrome ? (
      <GameStandaloneHeader
        title={title}
        subtitle={typeName}
        onBack={() => router.back()}
        chrome={standaloneChrome}
      />
    ) : null;

  // ── The ONE settings page — reached via the corner gear in BOTH modes. ──
  // Returned DIRECTLY (not in a `fixed inset-0` wrapper): it's a full-page view,
  // and its own `min-h-screen` root document-scrolls. Wrapping it in `fixed`
  // pinned it to the viewport, so tall content (e.g. the points panel + danger
  // zone) overflowed past the bottom with no way to scroll — the reported bug.
  // This matches the rack page, which already renders the config view directly.
  if (showConfig && canEdit && competitionId) {
    return (
      <>
      <GameSettingsPage
        surface="nongolf"
        onClose={closeConfig}
        tripId={tripId}
        competitionId={competitionId}
        game={game}
        canEdit={canEdit}
        isOwner={isOwner}
        canManageGame={canManageGame}
        onChanged={() => void refreshGame()}
        onDeleted={() => router.push(`/trips/${tripId}/leaderboard`)}
        // Scores wiped server-side → drop the local outcome the picker is
        // holding. Non-golf's counterpart to the golf formats' `clearScores`.
        //
        // Without this the reset LOOKED like it failed: the three drafts below
        // are null-sentinels that read the server mirror only while untouched,
        // so once someone had picked a winner the local value won permanently
        // over the emptied server response, and the old outcome stayed on
        // screen until the view remounted. Same symptom #807 fixed for the
        // golf formats (`reconcileScores` overlays and so ignores absence),
        // reached by a different mechanism — which is exactly why the handler
        // is now required rather than optional.
        onScoresReset={() => {
          setResultDraft(null);
          setOrderDraft(null);
          setTiedDraft(null);
        }}
        // Draft-then-save: the whole page is controlled off configDraft; Save commits.
        nameValue={configDraft.name}
        onNameChange={setNameDraft}
        delegateValue={configDraft.delegates[0] ?? null}
        onDelegateChange={(next) => setDelegatesDraft(next ? [next] : [])}
        rulesValue={configDraft.rulesForToday}
        onRulesChange={setRulesDraft}
        totalPointsRow={
          <NonGolfTotalPointsRow
            scoringModel={scoringModel}
            distribution={configDraft.pointsDistribution}
            value={configDraft.pointsTotal}
            canEdit={canEdit}
            onChange={setPointsTotalDraft}
          />
        }
        settingsRows={
          <NonGolfSettingsRows
            game={game}
            scoringModel={scoringModel}
            draft={configDraft}
            canEdit={canEdit}
            capacity={capacity}
            onFormatChange={requestFormat}
            onPointsTotalChange={setPointsTotalDraft}
            onPointsDistChange={setPointsDistDraft}
            // The bracket's own rows, directly under the format that turns them
            // on. Rendered only for a bracket WITH a config — `applyFormat`
            // stages one on the switch, so the gap is a render apart, not a
            // state a user can sit in.
            bracketRows={
              isBracket && configDraft.bracketConfig ? (
                <BracketSettingsRows
                  config={configDraft.bracketConfig}
                  pool={configDraft.bracketEntrants}
                  teams={pickerTeams}
                  canEdit={canEdit}
                  onConfigChange={setBracketConfigDraft}
                  onPoolChange={setEntrantsDraft}
                />
              ) : null
            }
          />
        }
        // The toggle reads the DRAFT; `staged` = draft ≠ the live server flag.
        // `ready` was "configured" (non-null) — a 0-point game satisfied that. Now
        // "nonzero", mirroring Match's C3 gate: a 0-point competition game can be
        // scored end-to-end and finalized without moving the standings.
        // `!competitionId ||` for shape-parity with the other three formats, though
        // this view's settings panel only ever renders when competitionId is set.
        management={{
          scoringEnabled: configDraft.scoringEnabled,
          // TWO readiness axes now. Points is the existing one; the FIELD is
          // #917's — phase 2c made Bracket selectable without requiring the
          // setup to have happened, so scoring could be enabled on an empty
          // draw and the crew would arrive at a game with nothing to play.
          //
          // The server refuses this too (migration 117), and that ordering is
          // the point: this gate is the second opinion, never the only one. A
          // client-only refusal would be a rule the RPC doesn't share — the
          // same two-answers-to-one-question shape, pointed the other way.
          // Reads the DRAFT pool, so it moves as the field is built and agrees
          // with the server's read of the pool this Save is about to write.
          ready:
            (!competitionId || pointsReady(configDraft.pointsTotal ?? 0)) &&
            bracketFieldReady(isBracket, configDraft.bracketEntrants),
          // Points first, so the existing reason is unchanged when both are
          // unmet — the field is the newer and more specific complaint, and
          // naming it while the game has no points would be answering second.
          blockedReason:
            competitionId && !pointsReady(configDraft.pointsTotal ?? 0)
              ? "Set a point value before enabling scoring"
              : !bracketFieldReady(isBracket, configDraft.bracketEntrants)
                // The same SENTENCE the RPC raises, minus its closing "in this
                // game's settings" — which is real guidance for any other caller
                // and redundant here, where the Field row is a few inches up the
                // page. The rule is what must not drift; the navigation clause is
                // context, and this surface already has the context.
                ? "A bracket needs at least two entrants before it can go live"
                : null,
          onEnable: handleEnable,
          onDisable: handleDisable,
          pending: saving,
          staged: configDraft.scoringEnabled !== scoringEnabled,
        }}
        saveBar={
          <SettingsSaveBar
            dirty={dirty}
            saving={saving}
            error={saveError}
            onSave={handleSaveConfig}
            onDiscard={confirmDiscard}
            onLeave={leave}
            stayOpenOnSave={stayOpenOnSave}
            saveDisabledReason={distSaveBlock}
          />
        }
      />
      {pendingFormat && (
        <ClearPairingsPrompt
          onCancel={() => setPendingFormat(null)}
          onConfirm={() => {
            applyFormat(pendingFormat.next);
            setPendingFormat(null);
          }}
        />
      )}
      {confirmingClose && (
        <DiscardChangesPrompt
          onDiscard={confirmDiscard}
          onKeepEditing={cancelClose}
          onSave={() => { cancelClose(); void handleSaveConfig().then((ok) => { if (ok) leave(); }); }}
          saving={saving}
        />
      )}
      </>
    );
  }

  const gameName = game.name?.trim() || typeName;

  // ── Setup mode (pending) — member placeholder / owner pass-through. ──
  if (!scoringEnabled) {
    return (
      <div className="flex flex-col" style={{ minHeight: inPanel ? "100%" : "100vh", background: "var(--color-bt-base)" }}>
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
    <div className="flex flex-col" style={{ minHeight: inPanel ? "100%" : "100vh", background: "var(--color-bt-base)" }}>
      {header(gameName)}
      {/* Standard game header — row 1 (the collapsed cup hero) + optional row 2
          (this game's projected/final per-team contribution), sticky over the
          scoreboard. Competition games only.

          Row 2 is OMITTED for manual (direct-submit) formats: the result is
          entered and posted in one action, so there's nothing to "project" —
          the row would only ever mirror what was just submitted. A future
          non-golf format with incremental/engine scoring (resultStrategy set)
          keeps the projection. */}
      <GamePageHeader
        tripId={tripId}
        competitionId={competitionId}
        projection={
          // Three states, in order of precedence.
          //
          // 1. EDITABLE with an outcome declared → preview the DRAFT. This is the
          //    fix: the number now answers "what does the selection I am looking
          //    at pay?" instead of "what did the last save pay?". Covers active
          //    AND correcting — correcting seeds from the posted cells, so
          //    entering a correction shows the posted values and then moves as
          //    you change the pick, with no jump on entry.
          // 2. Nothing declared and nothing posted → OMITTED, unchanged. The
          //    empty rollup renders 0–0, which is a claim about a game nobody has
          //    played. `hasDeclaredOutcome` is what keeps that hidden.
          // 3. Otherwise → the posted cells, as before. A LOCKED game keeps
          //    reading committed server state rather than a recomputation, so the
          //    final record stays the record.
          //
          // `final` drives the label only ("FINAL / this game" vs "PROJECTED / if
          // today holds"). It now requires corrections to be CLOSED: a reopened
          // game previously announced FINAL while its result was being edited.
          !resultLocked && draftProjection
            ? { perTeam: draftProjection, gameName, final: false }
            : isManualGameType(game.game_type_id) && !resultFinal
              ? undefined
              : {
                  perTeam: postedPerTeam,
                  gameName,
                  final: resultLocked,
                }
        }
      />
      {/* THE BRACKET'S SCORING SURFACE — a branch, not a fifth game view.
          A bracket is a manual game whose placements are DERIVED rather than
          typed, so the lifecycle around it (chrome, locks, exit, realtime,
          settings, go-live) is non-golf's unchanged and only the surface swaps.
          Everything above and below this line is shared. */}
      {competitionId && isBracket ? (
        <div style={{ padding: "12px 12px 24px" }}>
          <div
            style={{
              fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
              color: "var(--color-bt-text-dim)", fontWeight: 700, margin: "6px 0 9px",
            }}
          >
            {canEdit ? "Tap a competitor to advance them" : "Bracket"}
          </div>
          <BracketBoard
            matches={resolvedDraw}
            entrants={bracketEntrantMeta}
            canPick={canEdit && !resultLocked}
            onPick={handlePick}
          />
          {pickError && (
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-bt-danger)" }} data-testid="bracket-pick-error">
              {pickError}
            </p>
          )}
        </div>
      ) : competitionId && (
        <NonGolfScoreboard
          tripId={tripId}
          competitionId={competitionId}
          game={game}
          teams={teams}
          scoringModel={scoringModel}
          // Entry state is owned HERE now (see the lift above) so the header
          // projection can be derived from it. The scoreboard renders the
          // controls and posts; it no longer holds the answer.
          order={order}
          onReorder={setOrderDraft}
          tiedWithPrev={tiedWithPrev}
          onToggleTie={toggleTie}
          result={result}
          onPick={setResultDraft}
          placements={draftPlacements}
          canEdit={canEdit}
          // #808 — was a bare `router.back()`. Correct from a panel, wrong
          // everywhere else: on a standalone route or a cold deep-link from a
          // push notification there is no `?game=` entry to pop, so `back()`
          // went wherever the user came from — out of the app entirely. The
          // shared hook branches on `useInGamePanel()` and gives the non-panel
          // case an explicit destination.
          onPosted={exitToBoard}
        />
      )}
    </div>
  );
}
