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
  isDraftMatchFilled,
  type NonGolfConfigDraft,
  type CompetitionFormat,
  type DraftMatchConfig,
  type DraftMatchInput,
} from "@/lib/configDraft";
import type { PointsMatch } from "@/components/games/MatchPointsRow";
import { isPlacement, effectiveDistribution, liveMatchPointsPerMatch, type PointsDistribution } from "@/lib/pointsDistribution";
import { tallyMatchAwards, type SideRef as MatchSideRef } from "@/lib/matchAwards";
import { BracketSettingsRows, ClearPairingsPrompt } from "@/components/games/bracket/BracketSettingsRows";
import { type BracketEntrantMeta } from "@/components/games/bracket/BracketBoard";
import { BracketScoringSurface } from "@/components/games/bracket/BracketScoringSurface";
import { resolveDraw, matchKey, type WinnerBySeed } from "@/lib/bracketAdvance";
import type { BracketSide } from "@/lib/bracket";
import { resolveDoubleDraw, lossesBySeed, isMustWin } from "@/lib/bracketDoubleAdvance";
import { doubleBracketPlacements, doublePositionsAwarded, doubleSettledPlaces } from "@/lib/bracketDoublePlacements";
import { stakesFromPositions } from "@/lib/bracketStakes";
import { DEFAULT_BRACKET_CONFIG, isDefaultBracketConfig, bracketFieldReady, type BracketConfig } from "@/lib/bracketDraft";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { placeCapacityFor } from "@/lib/placeCapacity";
import { validatePlacement, placementRefusalMessage } from "@/lib/gameConfig";
import { pointsReady, sideMemberIds, type ServerSide } from "@/lib/matchDraft";
import { MatchesBuilder } from "@/components/games/MatchesBuilder";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import { placementsFrom, pointsForPlacements } from "@/lib/placementGroups";
import { reconcileOrderDraft } from "@/lib/teamDraft";
import { bracketPlacements, teamPointsFromEntrants } from "@/lib/bracketPlacements";
import { gameLockState } from "@/lib/gameLifecycle";
import type { GameRow, LBTeamLite } from "@/components/competition/CompetitionGamesPanel";


/** Shared empty tie-set, so the untouched case keeps a stable identity across
 *  renders and doesn't retrigger the memos that depend on it. */
const EMPTY_TIES: ReadonlySet<string> = new Set<string>();

/**
 * The bracket's two reads, refreshed together — ONE invalidator, not two lists
 * that happen to match (CLAUDE.md #22).
 *
 * The pool and the draw are both hashed config (migration 115) and both are
 * written by the same `save_game_config` call, but they are separate queries from
 * the game row and from each other. Both convergence paths — the config-hash /
 * realtime push, and this page's own post-save refresh — listed only the POOL, so
 * a field rebuilt on another device converged the entrants while the board kept
 * rendering the tree they used to be in. Nothing errored; the draw was simply
 * one save behind, which is the failure mode #22 exists for.
 */
function invalidateBracketReads(
  utils: ReturnType<typeof trpc.useUtils>,
  tripId: string,
  gameId: string,
) {
  void utils.games.bracketPool.invalidate({ tripId, gameId });
  void utils.games.bracketDraw.invalidate({ tripId, gameId });
}

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
  // game, mirroring the server's `canEditGame`.
  const { canEdit, canManageGame } = useGameEditAccess(tripId, urlGameId);

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
      invalidateBracketReads(utils, tripId, urlGameId);
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
  /**
   * The drafted finishing order PROJECTED onto the teams that exist now — never
   * the raw draft.
   *
   * `orderDraft` is a snapshot taken on the first drag, and `serverOrder` follows
   * the live team set. Read raw, a team added to the competition after that drag
   * is absent from `order` — so it does not render in the finishing-order editor
   * AND it is absent from `draftPlacements`, which is the exact payload
   * `games.finish` commits. That arm validates only that placements are present,
   * never that they cover the field, so the game finalizes with a team scoring
   * nothing and no error anywhere.
   *
   * Same defect as the team-roster order (see `reconcileOrderDraft`), failing
   * SILENTLY instead of loudly: `teamAssignments.reorder` enforces a permutation
   * and refuses a stale set, which is the only reason that instance was visible.
   */
  const order = reconcileOrderDraft(orderDraft, serverOrder) ?? serverOrder;
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

  // ── Matches (170) — the pairing grid, read through the SAME query golf's
  // MatchGameView uses (`matches.listByGame`). Enabled unconditionally (like
  // `poolQ` above): `serverConfigDraft` builds before anything has decided the
  // format, and a non-Matches game simply reads back an empty pairing.
  const matchesQ = trpc.matches.listByGame.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId },
  );
  const serverMatchRows = useMemo(() => matchesQ.data?.matches ?? [], [matchesQ.data]);
  const serverMatchParticipants = useMemo(() => matchesQ.data?.participants ?? [], [matchesQ.data]);
  // 2v2 sides (play_groups) resolve to their members via participants.play_group_id —
  // the SAME reconstruction golf's own MatchGameView does, verbatim, because a
  // second spelling of "which side is who" is how the two would drift.
  const membersOfSide = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of serverMatchParticipants) {
      const pg = (p as { play_group_id?: string | null }).play_group_id;
      if (!pg) continue;
      if (!m.has(pg)) m.set(pg, []);
      m.get(pg)!.push(p.user_id as string);
    }
    return m;
  }, [serverMatchParticipants]);
  const serverMatchInputs = useMemo<DraftMatchInput[]>(
    () =>
      (serverMatchRows as {
        match_number: number | null;
        side_a: ServerSide;
        side_b: ServerSide;
        point_value: number | null;
      }[]).map((mm, i) => ({
        matchNumber: mm.match_number ?? i + 1,
        playersPerSide: mm.side_a?.type === "play_group" || mm.side_b?.type === "play_group" ? 2 : 1,
        a: sideMemberIds(mm.side_a, membersOfSide),
        b: sideMemberIds(mm.side_b, membersOfSide),
        // No handicap UI for Matches (§5 — carried as null/0, never surfaced).
        handicap: 0,
        pointValue: mm.point_value ?? null,
      })),
    [serverMatchRows, membersOfSide],
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

  // ── Matches (170) — the lookups MatchesBuilder/MatchSetup take. Derived off
  // `pickerTeams` rather than a second crew read, so the pairing grid and the
  // team roll-up can't disagree about who is on which team. Mirrors
  // PickemGameView's own derivation of the same maps for the same component.
  const rosterByTeam = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of pickerTeams) m.set(t.id, t.players.map((p) => p.id));
    return m;
  }, [pickerTeams]);
  const matchesNameMap = useMemo(
    () => new Map(pickerTeams.flatMap((t) => t.players.map((p) => [p.id, p.name] as const))),
    [pickerTeams],
  );
  const matchesAvatarIconMap = useMemo(
    () => new Map(pickerTeams.flatMap((t) => t.players.map((p) => [p.id, p.avatarIcon] as const))),
    [pickerTeams],
  );
  // A player's TEAM color from their roster assignment — team identity is the
  // person, never the slot (the rule `MatchSetup`'s own `teamColorOf` prop
  // documents).
  const matchesTeamColorOf = useCallback(
    (userId: string) => pickerTeams.find((t) => t.players.some((p) => p.id === userId))?.color,
    [pickerTeams],
  );
  // `MatchSetup` also wants a per-player fallback color (`colorOf`) for when
  // `teamColorOf` comes back undefined (a player dropped from their team) —
  // stable per user via a fixed palette index, same recipe PickemGameView uses.
  const matchesColorMap = useMemo(() => {
    const ids = pickerTeams.flatMap((t) => t.players.map((p) => p.id));
    return new Map(ids.map((id, i) => [id, PLAYER_COLORS[i % PLAYER_COLORS.length]]));
  }, [pickerTeams]);
  const [matchesSelector, setMatchesSelector] = useState<{ matchIdx: number; slot: "a" | "b"; memberIdx: number } | null>(null);
  // The Matches accordion's own expand state — independent of Point
  // Distribution's, mirroring golf's `openRows` (a Set, so its sections
  // expand/collapse independently rather than mutually excluding each other).
  const [matchesRowExpanded, setMatchesRowExpanded] = useState(false);
  // Point Distribution's own expand state under Matches lives INSIDE
  // `NonGolfSettingsRows` (its existing `openAccordion`) — no state needed
  // here, unlike the pairing row above (`matchesRowExpanded`), which this
  // view owns because it's rendered through the `matchRows` slot rather than
  // internally to that component.

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
  // Matches' one slice (170) — a list, same sentinel shape as entrants above.
  const [matchesDraft, setMatchesDraft] = useState<DraftMatchConfig[] | null>(null);

  const serverConfigDraft = useMemo<NonGolfConfigDraft>(
    () => configToNonGolfDraft((game ?? {}) as Parameters<typeof configToNonGolfDraft>[0], serverDelegates, serverEntrants, serverMatchInputs),
    [game, serverDelegates, serverEntrants, serverMatchInputs],
  );
  const anyTouched =
    nameDraft !== null || rulesDraft !== null || scoringDraft !== null ||
    formatDraft !== undefined || pointsTotalDraft !== undefined || pointsDistDraft !== undefined ||
    delegatesDraft !== null || entrantsDraft !== null || bracketConfigDraft !== undefined ||
    matchesDraft !== null;

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
      matches: matchesDraft ?? serverConfigDraft.matches,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, scoringDraft, formatDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft, entrantsDraft, bracketConfigDraft, matchesDraft],
  );

  // Settings-parity §1/§2 — the paired DRAFT matches resolved to display
  // players + each match's override, the SAME derivation golf's own
  // `pointsMatches` useMemo builds (`MatchGameView.tsx`), off the SAME maps
  // `MatchesBuilder` already gets. Paired-only (`isDraftMatchFilled`), so it's
  // the same denominator the award/leaderboard use. `id` is the DRAFT INDEX,
  // never a server match id — an unsaved match has none, and the override
  // travels ON its match (`pointValue`), so add/remove/reorder can't
  // mis-attribute it — identical reasoning to golf's version.
  const matchesPointsMatches = useMemo<PointsMatch[]>(() => {
    const toPlayers = (ids: string[]) =>
      ids.map((u) => ({ id: u, name: matchesNameMap.get(u) ?? "Player", teamColor: matchesTeamColorOf(u) ?? matchesColorMap.get(u) }));
    return configDraft.matches
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => isDraftMatchFilled(m))
      .map(({ m, i }) => ({
        id: String(i),
        number: i + 1,
        aPlayers: toPlayers(m.a),
        bPlayers: toPlayers(m.b),
        pointValue: m.pointValue,
      }));
  }, [configDraft.matches, matchesNameMap, matchesColorMap, matchesTeamColorOf]);
  const onMatchesPointsOverrideChange = (draftIdx: string, value: number | null) => {
    const idx = Number(draftIdx);
    setMatchesDraft((prev) => (prev ?? configDraft.matches).map((m, i) => (i === idx ? { ...m, pointValue: value } : m)));
  };

  // ── The SCOREBOARD's matches (170) — SERVER rows, not the draft ────────────
  // matchId → override, for the header's "what this match is worth" chip
  // (feedback: golf shows this on its own MatchCard header, Matches showed
  // nothing anywhere on the scoreboard). Same map shape as golf's own
  // `pointValueByMatch` in MatchGameView.
  const matchesPointValueByMatch = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const mm of serverMatchRows as { id: string; point_value: number | null }[]) {
      m.set(mm.id, mm.point_value ?? null);
    }
    return m;
  }, [serverMatchRows]);
  // The game's LIVE even share (#1031) — recomputed from `serverMatchRows` +
  // `points_total` via the SAME `liveMatchPointsPerMatch` golf's MatchGameView
  // calls, never read from the persisted `points_distribution.value` snapshot,
  // for the exact reason golf's own comment gives: a match dropping out of
  // the pairing outside a settings Save must not leave this stale.
  const matchesPointsPerMatch = useMemo(() => {
    const dist = game?.points_distribution as PointsDistribution | null | undefined;
    if (dist?.type !== "per_match") return 0;
    return liveMatchPointsPerMatch(
      (game?.points_total as number | null) ?? null,
      (serverMatchRows as { side_a: ServerSide; side_b: ServerSide; point_value: number | null }[]).map((mm) => ({
        sideAId: mm.side_a?.id ?? null,
        sideBId: mm.side_b?.id ?? null,
        pointValue: mm.point_value ?? null,
      })),
      dist.value
    );
  }, [game?.points_distribution, game?.points_total, serverMatchRows]);

  // The settings-side `matchesPointsMatches` above is keyed by DRAFT INDEX
  // because a not-yet-saved match has no server id; declaring a result is the
  // opposite case — a match MUST already be persisted to have a result
  // declared against it, so this reads `serverMatchRows` directly and keys by
  // the REAL `game_matches.id`. Same name/color/avatar maps as the pairing
  // grid and the override panel, so a player reads identically on all three
  // surfaces of this one game.
  const matchesScoreRows = useMemo(
    () =>
      (serverMatchRows as {
        id: string;
        match_number: number | null;
        side_a: ServerSide;
        side_b: ServerSide;
        result: "a_win" | "b_win" | "halve" | null;
        point_value: number | null;
      }[])
        .map((mm, i) => ({
          id: mm.id,
          number: mm.match_number ?? i + 1,
          aPlayers: sideMemberIds(mm.side_a, membersOfSide).map((u) => ({
            id: u,
            name: matchesNameMap.get(u) ?? "Player",
            teamColor: matchesTeamColorOf(u) ?? matchesColorMap.get(u),
          })),
          bPlayers: sideMemberIds(mm.side_b, membersOfSide).map((u) => ({
            id: u,
            name: matchesNameMap.get(u) ?? "Player",
            teamColor: matchesTeamColorOf(u) ?? matchesColorMap.get(u),
          })),
          result: mm.result,
          pointValue: matchesPointValueByMatch.get(mm.id) ?? matchesPointsPerMatch,
        }))
        // Same rule as everywhere else in this format (§3): an unpaired match
        // isn't there to resolve, so it doesn't reach the entry surface at all
        // — no refusal to write because there's nothing to tap in the first
        // place.
        .filter((m) => m.aPlayers.length > 0 && m.bPlayers.length > 0),
    [serverMatchRows, membersOfSide, matchesNameMap, matchesColorMap, matchesTeamColorOf, matchesPointValueByMatch, matchesPointsPerMatch],
  );
  const setMatchResult = trpc.matches.setResult.useMutation({
    onSuccess: () => {
      // The SAME query the pairing grid reads (`matches.listByGame`) — one
      // invalidate refreshes both surfaces of this one game. Realtime
      // (`useRealtimeGame`, CLAUDE.md #19) covers OTHER devices; this is for
      // the tab that just wrote, which cannot rely on its own broadcast
      // round-tripping back to itself promptly. Also the RECONCILE step for
      // the optimistic patch below — the refetch it triggers is what pulls
      // real server truth back over the optimistic guess.
      utils.matches.listByGame.invalidate({ tripId: tripId!, gameId: urlGameId! });
    },
    // Feedback: "slow to update after pressing it" — this mutation had no
    // optimistic patch, so every tap waited a full round trip before the row
    // moved. Rolled back the same way (CLAUDE.md Enforced Pattern #1 for this
    // directory): invalidate/refetch to pull real server truth over the wrong
    // guess, not a snapshot-restore.
    onError: () => {
      utils.matches.listByGame.invalidate({ tripId: tripId!, gameId: urlGameId! });
    },
  });
  const onMatchResultPick = (matchId: string, result: "a_win" | "b_win" | "halve" | null) => {
    const key = { tripId: tripId!, gameId: urlGameId! };
    const prev = utils.matches.listByGame.getData(key);
    if (prev) {
      utils.matches.listByGame.setData(key, {
        ...prev,
        matches: (prev.matches as { id: string }[]).map((mm) =>
          mm.id === matchId ? { ...mm, result } : mm
        ),
      });
    }
    setMatchResult.mutate({ tripId: tripId!, gameId: urlGameId!, matchId, result });
  };

  // ── The bracket's derived shape, read by everything below ───────────────────
  // `isBracket` and the entrant count both come off the DRAFT, so the rows, the
  // place ceiling and the payload all answer from the same state — a staged
  // format switch takes effect everywhere at once rather than in the one place
  // that happened to be repointed (CLAUDE.md #18).
  const isBracket = configDraft.competitionFormat === "bracket";
  const isMatches = configDraft.competitionFormat === MATCHES_COMPETITION_FORMAT;

  // #533 header projection (row 2), Matches' counterpart to golf's own
  // `projectionPerTeam` (MatchGameView.tsx: "a presentation rollup of the
  // match strips ALREADY on this page... No engine call, no fetch"). This was
  // MISSING entirely — `GamePageHeader`'s `projection` prop only ever read
  // `draftProjection` (win/lose/tie or placement) or `bracketProjection`, and
  // Matches has neither: it declares each match's result directly, with no
  // staged draft to preview. Same shape as `projectGame` (`liveProjection.ts`)
  // originally missing a Matches arm — a format allowlist that predated the
  // format (feedback, and the same root cause as #1120).
  //
  // Reads `serverMatchRows` — already reflecting the optimistic patch a tap
  // applies (`onMatchResultPick`) — through the SAME pure `tallyMatchAwards`
  // the persisted write and the board's own live projection call, so this
  // row, the board pill, and the eventual saved result can't disagree about
  // the award rule itself (CLAUDE.md #8). `sideTeam`'s 2v2 resolution (a
  // side's team via its play_group's first member) mirrors the server-side
  // version in `matchAwards.ts`/`liveProjection.ts` exactly.
  const matchesProjection = useMemo(() => {
    if (!isMatches) return null;
    const pgTeam = new Map<string, string>();
    for (const [pg, members] of membersOfSide) {
      const first = members[0];
      const t = first ? teamByUser[first] : null;
      if (t) pgTeam.set(pg, t);
    }
    const sideTeam = (s: MatchSideRef): string | undefined =>
      (s.type === "play_group" ? pgTeam.get(s.id) : teamByUser[s.id]) ?? undefined;
    return tallyMatchAwards(
      serverMatchRows as {
        side_a: ServerSide;
        side_b: ServerSide;
        result: "a_win" | "b_win" | "halve" | null;
        point_value: number | null;
      }[],
      sideTeam,
      matchesPointsPerMatch
    );
  }, [isMatches, serverMatchRows, membersOfSide, teamByUser, matchesPointsPerMatch]);

  // ── The bracket's play surface (phase 3) ────────────────────────────────────
  // The DRAW as stored, resolved into occupants HERE. The server returns the
  // stored rows and leaves advancement to the reader on purpose, so this runs
  // the same `resolveDraw` the pick mutation validates against — one answer to
  // "who is in this match", not two that agree by luck.
  const drawQ = trpc.games.bracketDraw.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId && isBracket },
  );
  /**
   * Single or double elimination, chosen HERE rather than inside either resolver.
   *
   * This is the composition root, and picking a strategy is what it is for. The rule
   * the spec sets is that a MODULE must not have to ask which format it is in — so
   * `resolveDraw`, `resolveDoubleDraw`, and the two placement rules each know only
   * their own format, and this line is the one place that knows both exist.
   */
  const isDouble = (configDraft.bracketConfig?.elimination ?? "single") === "double";
  const resolvedDraw = useMemo(() => {
    const rows = (drawQ.data ?? []) as { bracket: BracketSide; round: number; slot: number; aSeed: number | null; bSeed: number | null; winnerSeed: number | null }[];
    const winners: WinnerBySeed = {};
    for (const r of rows) winners[matchKey(r)] = r.winnerSeed;
    const draw = rows.map((r) => ({ bracket: r.bracket, round: r.round, slot: r.slot, aSeed: r.aSeed, bSeed: r.bSeed }));
    return isDouble ? resolveDoubleDraw(draw, winners) : resolveDraw(draw, winners);
  }, [drawQ.data, isDouble]);

  /** Lives per seed, for the board's per-side must-win marker. Bracket-local — this
   *  must not travel to the competition layer (glossary). */
  const bracketLosses = useMemo(
    () => (isDouble ? lossesBySeed(resolvedDraw) : new Map<number, number>()),
    [isDouble, resolvedDraw],
  );

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

  /**
   * Seed → cup team, taken from the pool the server already returns.
   *
   * `bracket_entrants.team_id` is the roll-up key — the same column
   * `computeCompetitionLeaderboard` sums by — so the preview below and the
   * posted record answer "whose points are these?" from one field rather than
   * two rules that agree by luck.
   */
  const teamBySeed = useMemo(
    () =>
      new Map<string, string | null>(
        ((poolQ.data ?? []) as { seed: number; teamId: string | null }[]).map((e) => [String(e.seed), e.teamId]),
      ),
    [poolQ.data],
  );

  /**
   * What the draw as it stands would pay each team — the bracket's answer to the
   * header's projection row.
   *
   * ── Why this exists rather than reusing `draftProjection` ──────────────────
   * `draftProjection` reads `order`, which for a non-bracket is the finishing
   * order someone dragged and for a bracket is the ROSTER order nobody touched.
   * Once a bracket posted, `hasDeclaredOutcome` went true off the posted cells
   * and the header started previewing a per-team split derived from roster
   * order — a number with no relationship to the tree on screen. It was only
   * visible while active or correcting, which is exactly when someone is
   * looking at it.
   *
   * This runs the SAME three functions the server runs (`bracketPlacements` →
   * `placementPoints` → `teamPointsFromEntrants`), so the preview and the record
   * cannot diverge — CLAUDE.md #8, and the reason the roll-up is a shared pure
   * helper rather than server-only code.
   *
   * Null until the draw is finished, which is also when `games.finish` would
   * refuse it: a half-played bracket has no placements to value, and showing a
   * partial one would claim a result nobody has.
   */
  const bracketProjection = useMemo<Record<string, number> | null>(() => {
    if (!isBracket) return null;
    const placements = isDouble ? doubleBracketPlacements(resolvedDraw) : bracketPlacements(resolvedDraw);
    if (placements.length === 0) return null;
    // Shared with the SERVER roll-up (`effectiveDistribution`) — a null split
    // pays the total to first place, so the projection and the board agree.
    const perEntrant = pointsForPlacements(
      placements.map((p) => ({ entityId: String(p.seed), position: p.position })),
      effectiveDistribution(
        game?.points_distribution as PointsDistribution | null | undefined,
        game?.points_total as number | null | undefined,
      ),
    );
    const out: Record<string, number> = {};
    for (const [teamId, v] of teamPointsFromEntrants(perEntrant, teamBySeed)) out[teamId] = v;
    return out;
  // `points_total` is in the trigger set because the projection now derives from
  // it via `effectiveDistribution` (CLAUDE.md #9 — enumerate the FULL set, not
  // the obvious one). Caught by the React Compiler lint, not by me.
  }, [isBracket, isDouble, resolvedDraw, game?.points_distribution, game?.points_total, teamBySeed]);

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
    () => ({ name: nameDraft, rules: rulesDraft, scoring: scoringDraft, format: formatDraft, pointsTotal: pointsTotalDraft, pointsDist: pointsDistDraft, delegates: delegatesDraft, entrants: entrantsDraft, bracketConfig: bracketConfigDraft, matches: matchesDraft }),
    [nameDraft, rulesDraft, scoringDraft, formatDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft, entrantsDraft, bracketConfigDraft, matchesDraft],
  );
  function resetSlices() {
    setNameDraft(null); setRulesDraft(null); setScoringDraft(null);
    setFormatDraft(undefined); setPointsTotalDraft(undefined); setPointsDistDraft(undefined);
    setDelegatesDraft(null); setEntrantsDraft(null); setBracketConfigDraft(undefined);
    setMatchesDraft(null);
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
    if (b.matches !== null) setMatchesDraft(b.matches);
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
    saveState, saveError, saving, handleSave: handleSaveConfig,
  } = useConfigDraft<NonGolfConfigDraft, typeof draftBundle>({
    tripId, gameId: urlGameId, view: "nongolf", canEdit,
    showConfig, dirtyRef, discardRef,
    // EVERY query feeding serverConfigDraft (see StrokeGameView's call): the game row,
    // orgQ (the delegates slice), poolQ (the entrants slice), matchesQ (the Matches
    // pairing slice) — plus assignQ, which feeds no draft field but resolves every
    // entrant's TEAM at payload time. A save that ran before it landed would send
    // `teamId: null` for the whole field and be refused server-side ("a bracket
    // needs a cup to score into") on a page the user filled in correctly, so it
    // gates the baseline like the rest.
    ready: !!game && !!orgQ.data && !!poolQ.data && !!matchesQ.data && (!competitionId || !!assignQ.data),
    serverConfigDraft, configDraft, anyTouched,
    draftsEqual: nonGolfDraftsEqual,
    toPayload: (draft, base) => nonGolfDraftToPayload(draft, base, { teamByUser }),
    bundle: draftBundle, applyRecovered: applyBundle, reset: resetSlices,
    onSaved: async () => { await refreshGame(); utils.games.listOrganizers.invalidate({ tripId: tripId!, gameId: urlGameId! }); },
  });

  async function refreshGame() {
    await gameQ.refetch();
    // The pool and draw are separate reads from the game row, so a save that
    // rebuilt the field would otherwise leave the baseline seeded from the old
    // one — the page would report itself dirty against a pool it just persisted,
    // and the board would render the tree those entrants used to be in.
    invalidateBracketReads(utils, tripId!, urlGameId!);
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
    // Leaving Bracket for anything else: an UNTOUCHED auto-staged default
    // must not survive the switch — only a config the user actually edited
    // gets to (see the "OUT of a bracket" comment above for why a REAL one
    // does). Comparing against `DEFAULT_BRACKET_CONFIG` is what tells the two
    // apart. Without this, tapping Bracket then back to Simple (or Matches)
    // left `bracketConfig` a real, non-null object while the server's
    // baseline has none — `nonGolfDraftsEqual` then reported dirty forever,
    // even though `competitionFormat` and everything else had round-tripped
    // back to exactly what was on the server (feedback: "there should be no
    // changes to save or discard").
    if (next !== "bracket" && isDefaultBracketConfig(configDraft.bracketConfig)) {
      setBracketConfigDraft(null);
    }
    if (next === "bracket") {
      if (!configDraft.bracketConfig) setBracketConfigDraft(DEFAULT_BRACKET_CONFIG);
      // A game is never both formats (one `competitionFormat` value) — clear
      // the OTHER structural slice, mirroring the bracket-pool clear below.
      setMatchesDraft([]);
    } else if (next === MATCHES_COMPETITION_FORMAT) {
      // No scalar config to stage the way `bracketConfig` needs (Matches has
      // no settings beyond the pairing grid itself), so this arm only clears
      // the slice Matches does NOT own.
      setEntrantsDraft([]);
    } else {
      setEntrantsDraft([]);
      setMatchesDraft([]);
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
        canDelegate={canManageGame}
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
          // Settings-parity §2 — `NonGolfTotalPointsRow` decides Matches vs
          // Simple internally now (the same place it already decided pool vs
          // match-value), so this call site just supplies every input.
          <NonGolfTotalPointsRow
            scoringModel={scoringModel}
            competitionFormat={configDraft.competitionFormat}
            distribution={configDraft.pointsDistribution}
            value={configDraft.pointsTotal}
            matches={matchesPointsMatches}
            canEdit={canEdit}
            onChange={setPointsTotalDraft}
            onOverrideChange={onMatchesPointsOverrideChange}
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
                  // Is there a 3rd-place RESULT to lose? Turning the match off is
                  // permitted server-side (migration 121) precisely so an
                  // accidental toggle is undoable — so the confirm is here, and
                  // only when there is something to discard.
                  consolationHasResult={resolvedDraw.some(
                    (m) => m.bracket === "consolation" && m.winnerSeed !== null,
                  )}
                />
              ) : null
            }
            // Matches' pairing grid (170) — same slot pattern as bracketRows,
            // rendered only once the format is chosen. No staged default to
            // wait a render for (Matches has no scalar config), so there is no
            // gap analogous to bracket's "config lands next render".
            matchRows={
              isMatches ? (
                <MatchesBuilder
                  draft={configDraft.matches}
                  setDraft={(fn) => setMatchesDraft(fn(configDraft.matches))}
                  teams={teams}
                  rosterByTeam={rosterByTeam}
                  nameMap={matchesNameMap}
                  colorMap={matchesColorMap}
                  avatarIconMap={matchesAvatarIconMap}
                  teamColorOf={matchesTeamColorOf}
                  canEdit={canEdit}
                  expanded={matchesRowExpanded}
                  onToggle={() => setMatchesRowExpanded((o) => !o)}
                  selector={matchesSelector}
                  setSelector={setMatchesSelector}
                />
              ) : null
            }
            // Settings-parity §1 — `NonGolfSettingsRows` decides Matches vs
            // placement internally now, same as the Total Points row above;
            // this just supplies the resolved matches + the override handler.
            // Same `matchesPointsMatches` / `onMatchesPointsOverrideChange`
            // the Total Points row above uses, so an override can't disagree
            // between the two rows that show it.
            pointsMatches={matchesPointsMatches}
            onPointsOverrideChange={onMatchesPointsOverrideChange}
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
            saveState={saveState}
            saving={saving}
            error={saveError}
            onSave={handleSaveConfig}
            onDiscard={confirmDiscard}
            onLeave={leave}
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
          //
          // A BRACKET substitutes its own preview for the draft one. Both are
          // "what does the state I am looking at pay?"; they differ only in what
          // that state IS — a typed order there, the resolved draw here. Reading
          // `draftProjection` for a bracket meant reading a per-team split
          // derived from ROSTER order, which is what this replaces.
          //
          // MATCHES substitutes ITS OWN live preview too, the same way — no
          // staged draft, no resolved draw, just the current `game_matches.result`
          // set (already reflecting an optimistic tap). Unlike bracket/win-tie,
          // this one is intentionally shown even at all-zero: like golf's own
          // `projectionPerTeam`, a Matches game only reaches this screen once
          // it's live and paired, so "0–0 so far" is a true statement about an
          // in-progress cup, not a claim about a game nobody has played.
          !resultLocked && (isBracket ? bracketProjection : isMatches ? matchesProjection : draftProjection)
            ? { perTeam: (isBracket ? bracketProjection : isMatches ? matchesProjection : draftProjection)!, gameName, final: false }
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
          Everything above and below this line is shared.

          It is a COMPONENT rather than inline JSX because the branch had to grow
          the finalize/correct/re-lock CTAs (#917 part 2 — the board alone left a
          played-out bracket with no way to finish). Given the same shape as
          `NonGolfScoreboard` beside it, a missing lifecycle behaviour is visible
          rather than merely absent. */}
      {competitionId && isBracket ? (
        <BracketScoringSurface
          tripId={tripId}
          gameId={game.id}
          competitionId={competitionId}
          game={{
            status: game.status as string,
            corrections_open: game.corrections_open === true,
            points_total: (game.points_total as number | null) ?? null,
          }}
          matches={resolvedDraw}
          entrants={bracketEntrantMeta}
          // Double elim supplies its own stakes and its own must-win predicate; single
          // elim passes neither and the board falls back to its defaults.
          stakesFor={isDouble
            ? (m) => {
                const places = doubleSettledPlaces(m);
                return places ? stakesFromPositions(doublePositionsAwarded(resolvedDraw), places, effectiveDistribution(game.points_distribution as PointsDistribution | null, game.points_total as number | null)) : null;
              }
            : undefined}
          mustWin={isDouble ? (seed: number) => isMustWin(bracketLosses, seed) : undefined}
          resolve={isDouble ? resolveDoubleDraw : undefined}
          // What each match is worth. The game's own placement split, or empty when
          // it pays no per-place values — the header then quotes nothing rather than
          // inventing zeroes.
          // Same helper as the projection and the server roll-up: with no authored
          // split the final is worth the game's total, so the header says so.
          pointsDistribution={effectiveDistribution(
            game.points_distribution as PointsDistribution | null,
            game.points_total as number | null,
          )}
          canEdit={canEdit}
          onPosted={exitToBoard}
        />
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
          matches={matchesScoreRows}
          onMatchResultPick={onMatchResultPick}
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
