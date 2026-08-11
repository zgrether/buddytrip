"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scale, Settings, SlidersHorizontal, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTripId } from "@/components/TripIdProvider";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { useConfigSync, GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { useRealtimeGame } from "@/hooks/useRealtimeGame";
import { useRealtimeScoreEvents } from "@/hooks/useRealtimeScoreEvents";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { useInGamePanel, useGameSurfaceChrome } from "@/components/games/GameChrome";
import { GameStandaloneHeader } from "@/components/games/GameStandaloneHeader";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameSettingsPage } from "@/components/games/GameSettingsPage";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { HandicapList, type HandicapPlayer } from "@/components/games/HandicapRoster";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { RackGroupBuilder, type GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { configToStrokeDraft, strokeDraftToPayload, strokeDraftsEqual, isWinnerTakesAll, type StrokeConfigDraft } from "@/lib/configDraft";
import { buildComposedCourseSnapshot, buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import type { ScorecardSchema } from "@/lib/courseIndex";
import { useConfigDraft } from "@/hooks/useConfigDraft";
import { fmtValue, type GameRow } from "@/components/competition/CompetitionGamesPanel";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { type ModifiersMap } from "@/lib/modifiers";
import { isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { validatePlacement, placementRefusalMessage } from "@/lib/gameConfig";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useScreenHistory } from "@/hooks/useScreenHistory";
import { computeStrokeLeaderboard } from "@/lib/strokePlay";
import { allUnitsComplete } from "@/lib/gameCompleteness";
import { StrokeLeaderboard } from "@/components/games/StrokeLeaderboard";
import { FoursomeEntry, type FoursomeGroupView } from "@/components/games/rack/FoursomeEntry";
import { PLAYER_COLORS, unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import { strokeHoles } from "@/lib/matchPlay";
import { pointsReady } from "@/lib/matchDraft";
import { unconfirmedCount, type Participant, type ScoreValues } from "@/components/games/types";
import { GameLifecycleActions } from "@/components/games/GameLifecycleActions";
import { ScoringStateBanner } from "@/components/games/ScoringStateBanner";
import { useExitToBoard } from "@/hooks/useExitToBoard";
import { useGameFinalize } from "@/hooks/useGameFinalize";
import { gameLockState } from "@/lib/gameLifecycle";
import { useOpenCorrection } from "@/hooks/useGameCorrection";
import { showToast } from "@/lib/toast";

const STROKE_PLAY = "gtt_stroke_play";

/**
 * StrokeGameView — the stroke-play game surface. Pick 2–4 crew → create game +
 * participants → hole-by-hole entry → Finish/Final + review grid.
 *
 * Spec 2 Phase 3: a persistence-BOUND composed view, re-HOSTED by both its route
 * wrapper AND the leaderboard's game PANEL (CompetitionFace) — same recipe as
 * MatchGameView/RackGameView/NonGolfGameView. Reads its OWN tripId (useTripId) +
 * gameId (?game=); the back arrow (router.back) pops the ?game= entry and closes
 * the panel. Its scoring "Play" view is a `fixed inset-0` overlay (like match's
 * score sub-screen) — appropriate for focused entry; the setup/settings screens
 * are normal-flow panels.
 */
export function StrokeGameView() {
  const { tripId, rawParam: param } = useTripId();
  const router = useRouter();
  const search = useSearchParams();
  // Resume an existing game when the leaderboard (or a refresh) lands here with
  // ?game=<id>. Without reading this, the page always fell back to pick-players
  // and created a NEW game every time — the picked roster + scores never came
  // back, because they live on the original game id this page never loaded.
  const urlGameId = search.get("game");

  const utils = trpc.useUtils();
  // #501 Part 1: delegate-aware — a game-delegate (even a plain Member) edits this
  // game, mirroring the server's `canEditGame`. `isOwner` stays trip-Owner-only.
  const { canEdit, isOwner, canManageGame } = useGameEditAccess(tripId, urlGameId);
  const me = useCurrentUser();

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });

  // The game-to-resume (its roster) + its saved scores. Enabled only when we
  // arrived with ?game — the standalone "new game" flow leaves these idle.
  // The game (config/roster) is STRUCTURE — kept; the scores are STATE — they
  // keep the default short staleTime so a reopen refreshes them (the cut: reopen
  // a game and the structure is instant, only the scores re-fetch).
  const gameQ = trpc.games.getById.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId }
  );
  // Multi-tee scorecard yardage rows (Spec 5b) — reads the persisted course record.
  const { rows: teeRows, courseName } = useScorecardTeeRows(tripId, gameQ.data);
  // Scores are STATE — poll them (~20s) so a remote device's entries reflect on
  // this open board (game-state sync). refetchIntervalInBackground:false pauses
  // the poll when the tab is hidden. The reconcile below merges fresh server
  // scores in without clobbering the active enterer.
  const scoresQ = trpc.scores.listByGame.useQuery(
    { tripId: tripId!, gameId: urlGameId! },
    {
      enabled: !!tripId && !!urlGameId,
      refetchInterval: GAME_SYNC_INTERVAL_MS,
      refetchIntervalInBackground: false,
    }
  );

  const [selected, setSelected] = useState<string[]>([]);
  // A game created or joined in THIS session (the standalone new flow, or after
  // adding players to a competition game we opened with ?game).
  const [createdGame, setCreatedGame] = useState<{ id: string; participants: Participant[] } | null>(null);
  // The scorecard is an OVERLAY over the base view, not a third base view — so
  // the caller stays mounted underneath and dismiss returns to it with score
  // state intact (#543).
  const [gridOpen, setGridOpen] = useState(false);
  // The SURFACE→entry drill (mandatory groupings): null = on the surface (leaderboard +
  // groupings list); a group id = scoring THAT grouping (one level down). Mirrors rack's
  // `entryGroupId`. Score entry is no longer the default game tap — you land on the surface.
  const [entryGroupId, setEntryGroupId] = useState<string | null>(null);
  // Two history-tracked sub-screens over the surface: group entry (depth 1) and the
  // scorecard grid over it (depth 2). OS/browser back pops one level at a time — grid →
  // group → surface — instead of leaving the game (mirrors rack's useScreenHistory).
  const entryDepth = entryGroupId ? (gridOpen ? 2 : 1) : 0;
  // `back()` is the ONE path every in-app breadcrumb/finish/close uses, same as
  // rack's `back` — captures the hook's returned function rather than mutating
  // `gridOpen`/`entryGroupId` directly. Mutating state directly (this file's own
  // prior shape) leaves the pushed history entry un-popped: `useScreenHistory`'s
  // depth-shrink branch just re-syncs its OWN counter down on the next render, it
  // does not call `history.back()` for you — so the browser's real stack keeps an
  // orphaned entry nothing claims. The next hardware back then silently eats that
  // phantom instead of doing what the user expects (one back press short, every
  // time an in-app control was used instead of the OS button).
  const back = useScreenHistory(entryDepth, () => {
    if (gridOpen) setGridOpen(false);
    else if (entryGroupId) setEntryGroupId(null);
  });
  const [currentHole, setCurrentHole] = useState(1);
  // The ONE settings overlay — owns open/close/back + the leaderboard deep link
  // (?settings=1). Confirm-on-leave: the whole page is ONE draft (commits on Save), so a
  // dirty back-press is guarded via latest-refs (guardDirty reads showConfig, which this
  // hook returns). Deep-link path shares the #619 gap (outbox recovers the draft).
  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});
  const {
    open: showConfig,
    openConfig,
    closeConfig,
    confirmingClose,
    confirmDiscard,
    cancelClose,
    leave,
  } = useGameSettingsOverlay({
    canEdit,
    deepLink: search.get("settings") === "1",
    isDirty: () => dirtyRef.current,
    onDiscard: () => discardRef.current(),
  });
  // GROUP SETTINGS single-open accordion (P3): Point Distribution / Groupings / Handicaps /
  // Modifiers — all inline panels now (3.3 removed the full-page drill-downs).
  const [openAccordion, setOpenAccordion] = useState<null | "distribution" | "groupings" | "handicaps" | "modifiers">(null);
  // ── Composite draft SLICES (null/undefined = untouched → tracks the server) ──
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [scoringDraft, setScoringDraft] = useState<boolean | null>(null);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null | undefined>(undefined);
  const [pointsDistDraft, setPointsDistDraft] = useState<PointsDistribution | null | undefined>(undefined);
  const [courseDraft, setCourseDraft] = useState<StrokeConfigDraft["course"] | null>(null);
  const [strokesDraft, setStrokesDraft] = useState<Record<string, number> | null>(null);
  const [groupsDraft, setGroupsDraft] = useState<string[][] | null>(null); // P3 3.2 groupings slice
  const [modifiersDraft, setModifiersDraft] = useState<ModifiersMap | null>(null);

  const createGame = trpc.games.create.useMutation();
  // Auto-group the picked players into a default "Group 1" on Start (mandatory groupings,
  // 089): the game needs a grouping to go live AND the surface needs a tappable group.
  // setFoursomes upserts the roster + creates the group atomically (reused from rack).
  const seedFoursome = trpc.playGroups.setFoursomes.useMutation();

  const memberById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const c of crew.data ?? []) m.set(c.user_id, { id: c.user_id, name: c.displayName ?? c.user?.name ?? "Player" });
    return m;
  }, [crew.data]);

  const toParticipants = (userIds: string[]): Participant[] =>
    userIds.map((uid, i) => {
      const name = memberById.get(uid)?.name ?? "Player";
      return { id: uid, name, color: PLAYER_COLORS[i % PLAYER_COLORS.length] };
    });

  // The roster already saved on the resumed game (empty until players are added).
  const resumeRoster = useMemo(
    () => ((gameQ.data?.participants ?? []) as { user_id: string }[]).map((p) => p.user_id),
    [gameQ.data]
  );

  // The game we're configuring/scoring: one created this session, or the ?game we opened.
  // An EXISTING game (urlGameId) resolves even with an EMPTY roster — players are added via
  // the grouping builder in settings now (mandatory groupings), so a rosterless competition
  // game lands on setup/settings, NOT the old pick-2–4-players screen. That pre-screen is
  // kept ONLY for the standalone /games/new flow (no urlGameId, no competition/teams to build
  // groups from — its quick-start auto-groups the picked players).
  const game = useMemo<{ id: string; participants: Participant[] } | null>(() => {
    if (createdGame) return createdGame;
    if (urlGameId) {
      const participants = resumeRoster.map((uid, i) => {
        const name = memberById.get(uid)?.name ?? "Player";
        return { id: uid, name, color: PLAYER_COLORS[i % PLAYER_COLORS.length] };
      });
      return { id: urlGameId, participants };
    }
    return null;
  }, [createdGame, urlGameId, resumeRoster, memberById]);

  // Score-entry access (Task 2 — reflect the server rule). Stroke's unit is the
  // individual player, so a plain member scores only if they're a participant
  // (their own row); owner/delegate score everyone. A non-participant lands on the
  // read-only scorecard, never a dead entry screen. The SERVER (canWriteScore +
  // RLS) is the real gate; this is UX. (Finer per-row gating so a member can't tap
  // a co-player's cell in the shared card is a follow-up — the server rejects it.)
  const canScoreStroke = canEdit || (!!me && resumeRoster.includes(me.id));

  // §3: the COURSE-aware scorecard — par + stroke index from the applied course
  // snapshot (falls back to the 18-hole template default when no course). The
  // live strip MUST use this same index the server final (computeStrokePlayResults)
  // nets against, so net can't diverge (CLAUDE.md #8).
  const scUnits = useMemo(
    () => unitsFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0]),
    [gameQ.data]
  );
  const scIndex = useMemo(() => strokeIndexOf(scUnits), [scUnits]);
  // Per-player handicap strokes (read from game_participants), and the stroked
  // holes each one allocates against the course index — drives the pips + net.
  const strokesOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of (gameQ.data?.participants ?? []) as { user_id: string; handicap_strokes: number | null }[]) {
      m.set(p.user_id, effectiveStrokes(p));
    }
    return m;
  }, [gameQ.data]);
  const entryPips = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const [uid, n] of strokesOf) m[uid] = new Set([...strokeHoles(n, scIndex)].map(String));
    return m;
  }, [strokesOf, scIndex]);
  // The id the saver writes to: the resumed game, else the one created here.
  const activeGameId = urlGameId ?? createdGame?.id;
  // Phase 2B.1: a configured game must be Enabled before its score screen opens.
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  // Draft-then-save (P2) lie sweep: NO scoring_enabled lock — every settings row (incl. the
  // inline handicaps / modifiers panels) stays editable in every mode; an edit stages into
  // the draft and Save commits it (the RPC refuses only the destroys tier — a course change
  // on a scored game, COURSE_LOCKED). `canEdit` (role) is the only gate.
  const gameCompetitionId = (gameQ.data as { competition_id?: string | null } | undefined)?.competition_id ?? null;

  // Score/lifecycle events (#20) — see the note in RackGameView. `useRealtimeGame`
  // covers CONFIG; this covers SCORES, which is what moves the standings on this
  // page. Ref-counted, so sharing the topic with a mounted board costs one channel.
  useRealtimeScoreEvents(tripId, gameCompetitionId);

  // P3 3.2 GROUPINGS — teams + assignments (feed the picker's team sections) and the
  // persisted play_groups (the serverGroups baseline). Team-scoped, gated on the resolved
  // competition id. Reuses rack's play_groups mechanism (issue path in save_game_config).
  const teamsQ = trpc.teams.list.useQuery({ tripId: tripId!, competitionId: gameCompetitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gameCompetitionId });
  const assignQ = trpc.teamAssignments.list.useQuery({ tripId: tripId!, competitionId: gameCompetitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gameCompetitionId });
  const groupsQ = trpc.playGroups.listByGame.useQuery({ tripId: tripId!, gameId: urlGameId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!urlGameId });

  // ── Draft-then-save (P2) machinery ──────────────────────────────────────────
  // Per-game delegates (the draft's `delegates` slice) + the participants' strokes as a
  // { userId → strokes } map — the two inputs configToStrokeDraft folds into the baseline.
  const orgQ = trpc.games.listOrganizers.useQuery({ tripId: tripId!, gameId: activeGameId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!activeGameId });
  const serverDelegates = useMemo(
    () => ((orgQ.data ?? []) as { user_id: string }[]).map((d) => d.user_id).sort(),
    [orgQ.data],
  );
  const serverStrokes = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const p of (gameQ.data?.participants ?? []) as { user_id: string; handicap_strokes: number | null }[]) {
      m[p.user_id] = effectiveStrokes(p);
    }
    return m;
  }, [gameQ.data]);
  // The persisted play_groups as an ordered string[][] (one user-id array per group) —
  // the structural input configToStrokeDraft folds into the baseline (mirrors rack).
  const serverGroups = useMemo<string[][]>(
    () => (groupsQ.data?.groups ?? []).map((grp) =>
      (groupsQ.data?.participants ?? []).filter((p) => p.play_group_id === grp.id).map((p) => p.user_id as string)),
    [groupsQ.data],
  );
  const serverConfigDraft = useMemo<StrokeConfigDraft>(
    () => configToStrokeDraft((gameQ.data ?? {}) as Parameters<typeof configToStrokeDraft>[0], serverStrokes, serverGroups, serverDelegates),
    [gameQ.data, serverStrokes, serverGroups, serverDelegates],
  );

  const anyTouched =
    nameDraft !== null || rulesDraft !== null || scoringDraft !== null || delegatesDraft !== null ||
    pointsTotalDraft !== undefined || pointsDistDraft !== undefined || courseDraft !== null ||
    strokesDraft !== null || modifiersDraft !== null || groupsDraft !== null;

  const configDraft = useMemo<StrokeConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      scoringEnabled: scoringDraft ?? serverConfigDraft.scoringEnabled,
      pointsTotal: pointsTotalDraft !== undefined ? pointsTotalDraft : serverConfigDraft.pointsTotal,
      pointsDistribution: pointsDistDraft !== undefined ? pointsDistDraft : serverConfigDraft.pointsDistribution,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
      course: courseDraft ?? serverConfigDraft.course,
      strokes: strokesDraft ?? serverConfigDraft.strokes,
      modifiers: modifiersDraft ?? serverConfigDraft.modifiers,
      groups: groupsDraft ?? serverConfigDraft.groups,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, scoringDraft, pointsTotalDraft, pointsDistDraft, delegatesDraft, courseDraft, strokesDraft, modifiersDraft, groupsDraft],
  );

  // The game row as the DRAFT sees it — the inline course row renders course/tee
  // state from `game.course_id`/`scorecard_schema`, so it must reflect the PENDING
  // pick, not the unchanged server row (Cluster A1). Without this the selection was
  // written to `courseDraft` but the picker kept rendering the stale server course
  // and visibly "spat back". Mirrors Match's `draftGameRow` (the working reference).
  const draftGameRow = useMemo(
    () =>
      ({
        ...(gameQ.data as unknown as GameRow),
        name: configDraft.name,
        course_id: configDraft.course.id,
        back_course_id: configDraft.course.backId,
        scorecard_schema: configDraft.course.scorecardSchema,
      }) as GameRow,
    [gameQ.data, configDraft.name, configDraft.course],
  );

  // C1: block Save when a STARTED placement split no longer sums to the total (e.g.
  // the owner changed Total Points after distributing). Re-derived from the draft, not
  // snapshotted. null = fine (undistributed / per_match / exact). The server refine is
  // the authority; this is the client-side pre-block + the reason shown in the save bar.
  const distSaveBlock = useMemo(() => {
    const d = configDraft.pointsDistribution;
    if (!isPlacement(d)) return null;
    // A null total blocks the SUM check (nothing to sum against) but NOT the
    // places-vs-entities one, which never reads the total — #819 nested both
    // under this guard, so a no-total game could save an unappliable split.
    if (configDraft.pointsTotal == null) {
      const noTotal = validatePlacement(0, d.values, teamsQ.data?.length ?? null);
      return noTotal.state === "too_many_places" ? placementRefusalMessage(noTotal) : null;
    }
    // Entity count = teams in the competition (what the leaderboard ranks).
    // undefined while the query is in flight, and a standalone game has none —
    // both pass `null`, which never refuses.
    const v = validatePlacement(configDraft.pointsTotal, d.values, teamsQ.data?.length ?? null);
    return v.saveable ? null : placementRefusalMessage(v);
  }, [configDraft.pointsDistribution, configDraft.pointsTotal, teamsQ.data]);

  // The group picker's team sections: the WHOLE trip crew, grouped by their competition team
  // (via team_assignments), with a neutral bucket for anyone not on a team. This is the full
  // field to build groups from — the reach the old pick-2–4-players screen had, now that the
  // grouping builder is the only way players enter the game (the create-only roster is gone).
  // Robust to a competition with no team assignments yet (everyone falls into the crew bucket)
  // — assignQ-only would show an empty picker there. The picker filters out anyone already in
  // a group. Players key by user_id (what the groups draft + the RPC's groups[] path expect).
  const pickerTeams = useMemo<GroupBuilderTeam[]>(() => {
    const teamOfUser = new Map<string, string>();
    for (const a of (assignQ.data ?? []) as { user_id: string; team_id: string }[]) teamOfUser.set(a.user_id, a.team_id);
    const crewList = (crew.data ?? []).map((c) => ({
      id: c.user_id,
      name: c.displayName ?? c.user?.name ?? "Player",
      avatarIcon: null as string | null,
    }));
    const sections: GroupBuilderTeam[] = [];
    for (const t of (teamsQ.data ?? []) as { id: string; name: string; color: string }[]) {
      const players = crewList.filter((c) => teamOfUser.get(c.id) === t.id);
      if (players.length) sections.push({ id: t.id, name: t.name, color: t.color, players });
    }
    const unassigned = crewList.filter((c) => !teamOfUser.has(c.id));
    if (unassigned.length) sections.push({ id: "__unassigned", name: "Crew", color: "var(--color-bt-text-dim)", players: unassigned });
    return sections;
  }, [teamsQ.data, assignQ.data, crew.data]);

  // b2: the Handicaps roster is the LIVE DRAFTED FIELD — every player across the CURRENT
  // draft groups (`configDraft.groups`), NOT the stale create-time `game.participants`
  // (which capped at the ≤4 pick set and only refreshed on save-and-return). Metadata
  // (name + team color + icon) comes from `pickerTeams` (the whole crew, grouped by team),
  // so a group created in the builder populates Handicaps IMMEDIATELY, with team-colored
  // avatars, no 4-cap, no save round-trip. Strokes seed from the server; the draft overlay
  // (`draftHandicapPlayers`) shows unsaved edits.
  const handicapMeta = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null; avatarIcon: string | null }>();
    for (const t of pickerTeams) {
      const teamColor = t.id === "__unassigned" ? null : t.color;
      for (const p of t.players) m.set(p.id, { name: p.name, color: teamColor, avatarIcon: p.avatarIcon ?? null });
    }
    return m;
  }, [pickerTeams]);
  const handicapPlayers: HandicapPlayer[] = useMemo(() => {
    const seen = new Set<string>();
    const out: HandicapPlayer[] = [];
    for (const uid of configDraft.groups.flat()) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const meta = handicapMeta.get(uid);
      out.push({
        id: uid,
        name: meta?.name ?? memberById.get(uid)?.name ?? "Player",
        avatarIcon: meta?.avatarIcon ?? null,
        teamColor: meta?.color ?? null,
        strokes: strokesOf.get(uid) ?? 0,
      });
    }
    return out;
  }, [configDraft.groups, handicapMeta, strokesOf, memberById]);

  async function refreshGame() {
    await gameQ.refetch();
    if (gameCompetitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId: gameCompetitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  // Setup/Scoring toggle → the scoring draft slice; Save commits it (go-live readiness
  // re-asserted server-side inside the tx, so the client gate can't be bypassed).
  function handleEnable() { setScoringDraft(true); }
  function handleDisable() { setScoringDraft(false); }
  // §3: per-player handicap strokes → the strokes draft slice (warned/in-place; Save
  // commits + recomputes). Returns a Promise for HandicapRoster's async contract.
  const onSetStrokes = (userId: string, strokes: number) => {
    setStrokesDraft((prev) => ({ ...(prev ?? serverConfigDraft.strokes), [userId]: strokes }));
    return Promise.resolve();
  };

  // ── Course ACTIONS stage into the course draft slice (mirrors match/rack). ──
  const [courseBusy, setCourseBusy] = useState(false);
  const strokeGameTypeId = (gameQ.data?.game_type_id as string | undefined) ?? "";
  const applyFrontToDraft = (courseId: string, teeName?: string) => {
    if (!strokeGameTypeId) return;
    setCourseBusy(true);
    void (async () => {
      try {
        const course = await utils.courses.getById.fetch({ courseId });
        const snap = buildCourseSnapshot(course as unknown as CourseSnapshotInput, strokeGameTypeId, teeName);
        if (!snap.ok) {
          setSaveError(snap.reason === "bad_index"
            ? "That course's stroke index isn't a valid permutation — fix it before use."
            : "That game type has no scorecard to snapshot onto.");
          return;
        }
        setSaveError(null);
        setCourseDraft({ id: courseId, backId: null, scorecardSchema: snap.schema });
      } catch {
        setSaveError("Couldn’t load that course — try again.");
      } finally {
        setCourseBusy(false);
      }
    })();
  };
  const applyBackToDraft = (backCourseId: string, backTeeName?: string) => {
    if (!strokeGameTypeId) return;
    setCourseBusy(true);
    void (async () => {
      try {
        const back = await utils.courses.getById.fetch({ courseId: backCourseId });
        const res = buildComposedCourseSnapshot(
          {
            frontSchema: configDraft.course.scorecardSchema as ScorecardSchema | null,
            hasBackRef: !!configDraft.course.backId,
            backCourse: back as unknown as CourseSnapshotInput,
          },
          strokeGameTypeId,
          backTeeName,
        );
        if (!res.ok) {
          setSaveError(res.reason === "back_not_nine"
            ? "The back nine must be a 9-hole course."
            : res.reason === "bad_back_index"
              ? "That course's stroke index isn't a valid permutation — fix it before use."
              : "This isn’t a 9-hole front — it doesn’t take a back nine.");
          return;
        }
        setSaveError(null);
        setCourseDraft({ id: configDraft.course.id, backId: backCourseId, scorecardSchema: res.schema });
      } catch {
        setSaveError("Couldn’t load that course — try again.");
      } finally {
        setCourseBusy(false);
      }
    })();
  };
  const removeBackNineFromDraft = () => {
    const frontId = configDraft.course.id;
    if (!frontId) return;
    const teeName = ((configDraft.course.scorecardSchema as { units?: { metadata?: { tee?: { name?: string } } } } | null)
      ?.units?.metadata?.tee?.name ?? "").trim();
    applyFrontToDraft(frontId, teeName || undefined);
  };
  const clearCourseInDraft = () => {
    setSaveError(null);
    setCourseDraft({ id: null, backId: null, scorecardSchema: getGameTypeDefinition(strokeGameTypeId)?.scorecardSchema ?? null });
  };

  // ── Save / Cancel the composite draft ──
  function resetSlices() {
    setNameDraft(null); setRulesDraft(null); setScoringDraft(null); setDelegatesDraft(null);
    setPointsTotalDraft(undefined); setPointsDistDraft(undefined); setCourseDraft(null);
    setStrokesDraft(null); setModifiersDraft(null); setGroupsDraft(null);
  }
  // Draft durability (Layer 2 — hard-teardown outbox), mirroring the WHOLE composite draft.
  const draftBundle = useMemo(
    () => ({
      name: nameDraft, rules: rulesDraft, scoring: scoringDraft, delegates: delegatesDraft,
      pointsTotal: pointsTotalDraft, pointsDist: pointsDistDraft, course: courseDraft,
      strokes: strokesDraft, modifiers: modifiersDraft, groups: groupsDraft,
    }),
    [nameDraft, rulesDraft, scoringDraft, delegatesDraft, pointsTotalDraft, pointsDistDraft, courseDraft, strokesDraft, modifiersDraft, groupsDraft],
  );
  const applyBundle = useCallback((b: typeof draftBundle) => {
    if (b.name != null) setNameDraft(b.name);
    if (b.rules != null) setRulesDraft(b.rules);
    if (b.scoring != null) setScoringDraft(b.scoring);
    if (b.delegates != null) setDelegatesDraft(b.delegates);
    if (b.pointsTotal !== undefined) setPointsTotalDraft(b.pointsTotal);
    if (b.pointsDist !== undefined) setPointsDistDraft(b.pointsDist);
    if (b.course != null) setCourseDraft(b.course);
    if (b.strokes != null) setStrokesDraft(b.strokes);
    if (b.modifiers != null) setModifiersDraft(b.modifiers);
    if (b.groups != null) setGroupsDraft(b.groups);
  }, []);

  // Draft-then-save lifecycle (baseline / dirty / hash-poll / outbox / Save / Cancel /
  // confirm-on-leave) — the ONE shared hook (#626). The overlay itself stays above (opened
  // early to publish the app-bar chrome); the hook writes its dirtyRef/discardRef.
  const {
    dirty, saveError, setSaveError, saving,
    handleSave: handleSaveConfig,
    stayOpenOnSave,
  } = useConfigDraft<StrokeConfigDraft, typeof draftBundle>({
    tripId, gameId: activeGameId, view: "stroke", canEdit,
    showConfig, dirtyRef, discardRef,
    // EVERY query feeding serverConfigDraft, not just the game row: the baseline may now
    // freeze after the first edit, so a half-loaded mirror would become the diff base and
    // Save would clean-replace groupings the user never touched. groupsQ/orgQ share a tRPC
    // batch with games.configHash (games.getById is in a different one), so the gap is real.
    ready: !!gameQ.data && !!groupsQ.data && !!orgQ.data,
    serverConfigDraft, configDraft, anyTouched,
    draftsEqual: strokeDraftsEqual,
    toPayload: (draft, base) => strokeDraftToPayload(draft, base),
    bundle: draftBundle, applyRecovered: applyBundle, reset: resetSlices,
    onSaved: async () => {
      // Refetch play_groups too (P3 3.2) so the groupings baseline (serverGroups) reflects
      // a committed group change — else the dirty check would re-flag the just-saved edit.
      await Promise.all([gameQ.refetch(), orgQ.refetch(), groupsQ.refetch()]);
      if (gameCompetitionId) {
        utils.competitions.leaderboard.invalidate({ tripId, competitionId: gameCompetitionId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
        utils.games.listByTrip.invalidate({ tripId });
      }
    },
  });

  // A1 P0 — Game Modifiers, the home stroke play was missing (the match page had
  // it; stroke didn't). Same component + same games.modifiers wiring as the match
  // page. Seed the draft once from the saved game, then own it locally.
  //
  // Stroke has NO modifiers, and the wiring that used to hedge against that is gone.
  // It resolved to `[]` (its only modifier was `moving_tees`, removed as unbacked UI;
  // glorious_holes is match-play only) and was kept on the argument that it "lights up
  // the moment a stroke-applicable modifier exists". It didn't light anything up — it
  // built a row whose value was permanently `undefined` and let
  // `FORMAT_SURFACE.stroke.modifiers` claim `true` about it for a whole phase.
  //
  // The hedge is replaced by a guard rather than by more wiring: `formatSurface.test.ts`
  // pins the registry boolean to `compatibleModifiers`, so adding a stroke modifier
  // fails the suite until someone adds the row back deliberately. That is the same
  // outcome the speculative code was reaching for, except it can't be wrong in the
  // meantime.
  // Score writes go through the connectivity-resilient saver: optimistic value,
  // retry-with-backoff, per-cell save status, kept-and-flagged (never rolled
  // back) on failure. Owns `values` + `saveStatus` for this game.
  const { values, saveStatus, onChange, onClear, retryCell, reconcile, clearAll: clearScores } =
    useScoreSaver(tripId, activeGameId);
  // Finishing retries (idempotent — recomputes from the same scores); a failure
  // stays put and is surfaced by the global mutationCache.onError, which covers
  // server rejections as well as connectivity failures. That claim was untrue
  // when first written: the handler skipped server rejections, so "loud +
  // retryable" was in fact silent + retryable.
  // #769: reopen a finalized stroke round for correction (scores become editable
  // again until re-locked via handleFinish). Stroke shipped its finalize without
  // this, so `status='complete'` was a DEAD END — `scores.upsertEntry` refuses a
  // complete-and-not-correcting game (`scores.ts:53`), and no UI could clear that
  // flag. Rack has had it since #7; this is the same procedure and the same
  // invalidation set.
  // Shared with the other three formats (CLAUDE.md #24) — this view is the one
  // that had no correction arm at all until #769, which is precisely the argument
  // for the action living in one place rather than four. See `useOpenCorrection`.
  const { correct: handleCorrect, isPending: correctPending } = useOpenCorrection(
    tripId,
    game?.id,
    gameCompetitionId
  );
  // Reflect scores from OTHER devices: reconcile server truth into the view each
  // time the poll returns changed data, merged so the active enterer's unsaved
  // cells win (game-state sync). This also handles the initial load — an empty
  // local view simply takes the server's scores — so no separate seed-once is
  // needed. (Structural sharing means this only fires when scores actually
  // change.)
  useEffect(() => {
    if (!urlGameId || !scoresQ.data) return;
    const loaded: ScoreValues = {};
    for (const e of scoresQ.data as { participant_id: string; unit_label: string; value: number | null }[]) {
      if (e.value == null) continue;
      (loaded[e.participant_id] ??= {})[e.unit_label] = e.value;
    }
    reconcile(loaded);
  }, [urlGameId, scoresQ.data, reconcile]);

  // Resume at the CURRENT hole (the first hole any participant hasn't scored
  // yet) instead of always landing on hole 1 — seeded ONCE per game, right
  // after the first score load resolves. Never re-seeds afterward, so it
  // doesn't fight manual navigation once you're in the entry view (same
  // pattern as modifiersSeededRef). Mirrors the match-play board's per-group
  // currentHoleFor / rack's currentHoleForGroup — stroke has no per-group
  // selection step, so this seeds directly off the single continuous round.
  //
  // ⚠ Computes its OWN `loaded` map straight from `scoresQ.data`, deliberately
  // NOT from `values` — the reconcile effect above (same scoresQ.data trigger)
  // populates `values` via `reconcile()`, but that's a SEPARATE state update
  // that lands on a LATER render, not synchronously within this same effect
  // pass. Reading `values` here raced it: on the very first resolve, `values`
  // was still the pre-load empty map, so every hole looked incomplete, this
  // seeded hole 1, and the ref then blocked any correction once `values`
  // actually caught up one render later. Recomputing from `scoresQ.data`
  // directly removes the cross-effect ordering dependency entirely.
  const currentHoleSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!game || !scoresQ.data || currentHoleSeededRef.current === game.id) return;
    currentHoleSeededRef.current = game.id;
    const loaded: ScoreValues = {};
    for (const e of scoresQ.data as { participant_id: string; unit_label: string; value: number | null }[]) {
      if (e.value == null) continue;
      (loaded[e.participant_id] ??= {})[e.unit_label] = e.value;
    }
    for (let h = 1; h <= scUnits.length; h++) {
      const label = String(h);
      if (game.participants.some((p) => loaded[p.id]?.[label] == null)) {
        setCurrentHole(h);
        return;
      }
    }
    setCurrentHole(scUnits.length);
  }, [game, scoresQ.data, scUnits.length]);

  // Config sync: poll the cheap config hash on the same tick (batched with the
  // score poll) and, when it changes on another device, silently refetch THIS
  // game's config so groupings/modifiers/rules/course/status converge. Stroke's
  // config lives entirely on the game row → invalidate getById.
  const onConfigChanged = useCallback(() => {
    if (tripId && activeGameId) void utils.games.getById.invalidate({ tripId, gameId: activeGameId });
  }, [utils, tripId, activeGameId]);
  useConfigSync(tripId, activeGameId, !!activeGameId, onConfigChanged);
  // Realtime config push (migration 084): the INSTANT half — another browser sees a
  // settings change without waiting out the poll above (which is also paused on a
  // hidden tab). Pure invalidate; composes with `draftTouched` — a clean page
  // re-seeds live, a dirty page holds its edits and gets its honest CONFLICT at Save.
  useRealtimeGame(tripId, activeGameId);

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

  function toggle(userId: string) {
    setSelected((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length >= 4
          ? prev
          : [...prev, userId]
    );
  }

  async function start() {
    if (!tripId || selected.length < 2) return;
    // Resume target: add players to the game we opened (?game). Only create a
    // brand-new standalone game when we arrived WITHOUT one.
    const gameId =
      urlGameId ?? (await createGame.mutateAsync({ tripId, gameTypeId: STROKE_PLAY })).id;
    // Seed the picked players as "Group 1" (mandatory groupings) — creates the roster AND
    // the grouping in one call, so the game is go-live-ready and the surface has a group.
    await seedFoursome.mutateAsync({ tripId, gameId, groups: [{ name: "Group 1", userIds: selected }] });
    setCreatedGame({ id: gameId, participants: toParticipants(selected) });
    void utils.playGroups.listByGame.invalidate({ tripId, gameId });
    if (urlGameId) {
      void utils.games.getById.invalidate({ tripId, gameId });
    } else {
      // Stamp the new id into the URL so a refresh / re-entry resumes it.
      router.replace(`/trips/${param}/games/new?game=${gameId}`);
    }
  }

  // ── Surface data (mandatory groupings): whole-field leaderboard + the groupings list ──
  // Computed ABOVE the early returns (rules of hooks). The persisted groupings (id · name ·
  // tee · members); ungrouped participants aren't in the game (089), so the field = everyone
  // across these groups.
  const surfaceGroups = useMemo(
    () => (groupsQ.data?.groups ?? []).map((grp) => ({
      id: grp.id as string,
      name: (grp.display_name as string | null) ?? "Group",
      teeTime: (grp.tee_time as string | null) ?? null,
      userIds: (groupsQ.data?.participants ?? []).filter((p) => p.play_group_id === grp.id).map((p) => p.user_id as string),
    })),
    [groupsQ.data],
  );
  const nameColorOf = useMemo(() => {
    const m = new Map<string, { name: string; color: string; avatarIcon: string | null }>();
    (game?.participants ?? []).forEach((p) => m.set(p.id, { name: p.name, color: p.color, avatarIcon: p.avatarIcon ?? null }));
    return m;
  }, [game]);
  const fieldIds = useMemo(() => surfaceGroups.flatMap((g) => g.userIds), [surfaceGroups]);
  const fieldParticipants = useMemo<Participant[]>(
    () => fieldIds.map((id, i) => {
      const meta = nameColorOf.get(id);
      return {
        id,
        name: meta?.name ?? (crew.data ?? []).find((c) => c.user_id === id)?.displayName ?? "Player",
        color: meta?.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length],
        avatarIcon: meta?.avatarIcon ?? null,
      };
    }),
    [fieldIds, nameColorOf, crew.data],
  );

  // Net per-hole entries (feed to-par) + par-by-hole from the course snapshot. Nets against
  // the SAME stroked-holes the server final uses (entryPips), so the surface and the final agree.
  const parByHole = useMemo(() => Object.fromEntries(scUnits.map((u) => [u.label, u.par ?? 0])), [scUnits]);
  const netLeaderboardEntries = useMemo(() => {
    const out: { participant_id: string; unit_label: string; value: number }[] = [];
    for (const pid of fieldIds) {
      const holes = values[pid];
      if (!holes) continue;
      for (const [label, v] of Object.entries(holes)) {
        if (v == null) continue;
        out.push({ participant_id: pid, unit_label: label, value: (v as number) - (entryPips[pid]?.has(label) ? 1 : 0) });
      }
    }
    return out;
  }, [fieldIds, values, entryPips]);
  const leaderboardRows = useMemo(
    () => computeStrokeLeaderboard(fieldIds, netLeaderboardEntries, parByHole),
    [fieldIds, netLeaderboardEntries, parByHole],
  );

  // Game-level finalize gate (just like rack): every player of the LIVE whole field
  // is thru every hole. Reuses the shipped scoreboard's own rows (no parallel path) —
  // `holesPlayed` is each player's scored-hole count. Late-added groups add players to
  // `fieldIds → leaderboardRows` as thru-0 rows, so they re-block until complete.
  const allGroupsComplete = allUnitsComplete(
    leaderboardRows.map((r) => r.holesPlayed),
    scUnits.length,
  );
  const strokeCorrectionsOpen = !!(gameQ.data as { corrections_open?: boolean } | undefined)?.corrections_open;
  // Stroke had NO notion of "this game is over" anywhere in this file — zero
  // occurrences of `status === "complete"` — which is why tapping a grouping on a
  // finished round opened the editable keypad, a screen `scores.upsertEntry`
  // refuses (`scores.ts:53`). Rack and match both had `locked`/`correcting`;
  // stroke was the one format that never grew them.
  const { isLocked: strokeLocked } = gameLockState({
    status: gameQ.data?.status,
    correctionsOpen: strokeCorrectionsOpen,
  });

  // The groupings list rows (FoursomeEntry) — thru = the group's furthest hole; started = any.
  const groupViews = useMemo<FoursomeGroupView[]>(
    () => surfaceGroups.map((g) => {
      const thruVals = g.userIds.map((uid) => Object.keys(values[uid] ?? {}).length);
      const furthest = thruVals.length ? Math.max(...thruVals) : 0;
      return {
        id: g.id,
        name: g.name,
        teeLabel: g.teeTime,
        thru: furthest > 0 ? furthest : null,
        players: g.userIds.map((uid) => {
          const p = fieldParticipants.find((fp) => fp.id === uid);
          return { id: uid, name: p?.name ?? "Player", teamColor: p?.color ?? "var(--color-bt-text-dim)" };
        }),
        mine: !!me && g.userIds.includes(me.id),
        // Every member thru every hole — the SAME predicate that gates finalize.
        finished: allUnitsComplete(thruVals, scUnits.length),
      };
    }),
    [surfaceGroups, values, fieldParticipants, me, scUnits.length],
  );

  // #550: as a PANEL, publish chrome to the app bar (back/title + owner gear) instead of
  // a second header. Handicaps/modifiers are inline panels now (P3 3.3), so there's no
  // drill-down that covers the bar. Standalone route keeps its headers.
  const inPanel = useInGamePanel();
  const exitToBoard = useExitToBoard(tripId, gameCompetitionId);
  const { finalize, isPending: finalizePending } = useGameFinalize({
    tripId,
    gameId: gameQ.data?.id as string | undefined,
    competitionId: gameCompetitionId,
    refreshSelf: () =>
      void utils.games.getById.invalidate({ tripId: tripId!, gameId: gameQ.data?.id as string }),
    onExit: exitToBoard,
  });
  const standaloneChrome = useGameSurfaceChrome(
    gameQ.data
      ? {
          // The GAME's name at every depth; a group's entry appends "— Group N"
          // rather than replacing it (rack's idiom, same change there). The row
          // truncates the name and keeps the suffix whole.
          title: (gameQ.data?.name as string | undefined)?.trim() || "Stroke Play",
          titleSuffix: entryGroupId
            ? surfaceGroups.find((g) => g.id === entryGroupId)?.name
            : undefined,
          // Settings gear on the SURFACE only (not inside a group's entry — that view carries
          // its own onConfig). Absent on the final.
          onSettings: !!game && canEdit && !showConfig && !entryGroupId ? openConfig : undefined,
          // Focused scoring (in a group) hides the bottom nav.
          // Rules reachable at every depth — see GameChrome's `rules` note.
          rules:
            gameQ.data && tripId && !showConfig
              ? {
                  tripId,
                  gameId: gameQ.data.id as string,
                  gameTypeId: (gameQ.data as unknown as GameRow).game_type_id,
                  text: (gameQ.data.rules_for_today as string | null) ?? null,
                  canEdit,
                }
              : undefined,
          focusedEntry: !!game && scoringEnabled && !showConfig && !!entryGroupId && canScoreStroke,
        }
      : null,
  );

  if (!tripId) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // Resuming from ?game — wait for the roster before choosing pick-vs-score, so
  // we never flash the "pick players" screen over a game that already has them.
  if (urlGameId && !createdGame && gameQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  async function handleFinish() {
    if (!tripId || !game) return;
    // Spec 1a: never finish over unconfirmed scores — finish computes from server
    // rows, so an unsaved cell would be silently omitted. Block + say why.
    const gate = unconfirmedCount(saveStatus);
    if (gate.total > 0) {
      showToast(
        gate.errored > 0
          ? `${gate.errored} score${gate.errored > 1 ? "s" : ""} didn’t save — retry before finishing`
          : "Still saving scores — try again in a moment",
      );
      return;
    }
    // The aftermath is shared — see useGameFinalize. Stroke once invalidated
    // NOTHING here (the board stayed stale until leave-and-return); that fix
    // and the three others now live in one place.
    await finalize();
  }

  // (#769's `handleCorrect` — "mirroring rack's exactly" — is now literally the
  // same code as rack's, in `useOpenCorrection`, rather than a copy asserted to
  // match. Invalidation set unchanged, #10 included.)

  // P3 3.3 — Handicaps + Game Modifiers are now INLINE accordion panels inside the
  // settings page (built in the config-view block below), not full-page drill-downs.
  // Both edit their draft slice (strokes / modifiers) and commit on Save; nothing
  // self-persists, so the out-of-band write that moved the config hash (and produced the
  // false "modified elsewhere" on the next Save) is gone.

  // A2-ux correction: setup-mode scoreboard = PASS-THROUGH. A member gets just the
  // themed placeholder (the A2-core gate already withheld the data); the owner/delegate
  // gets the placeholder + the way into the ONE settings page (front button + corner
  // gear). NO checklist, NO toggle on this page — those live on the settings page.
  if (game && !scoringEnabled && !showConfig) {
    return (
      <div className="flex flex-col" style={{ minHeight: inPanel ? "100%" : "100vh", background: "var(--color-bt-base)" }}>
        {/* #550: as a panel the app bar carries back/title/actions. Standalone
            keeps its own header — now the SHARED one, whose actions come from
            the same chrome object the panel publishes. */}
        {standaloneChrome && (
          <GameStandaloneHeader
            title="Stroke Play"
            subtitle={`${game.participants.length} player${game.participants.length === 1 ? "" : "s"}`}
            onBack={() => router.back()}
            chrome={standaloneChrome}
          />
        )}
        <div className="flex-1">
          <SetupPlaceholder
            tripId={tripId}
            game={gameQ.data as unknown as GameRow | undefined}
            message={canEdit
              ? "Set the players, course, and handicaps on the settings page — the crew can’t see the game until you switch it to scoring."
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

  // ── The ONE settings page — reached via the corner gear in BOTH modes. The full
  // checklist (course/points/handicaps/modifiers) + the single Setup/Scoring toggle
  // + the Danger Zone, all here. ──
  // Returned DIRECTLY (not in a `fixed inset-0` wrapper): it's a full-page view
  // whose own `min-h-screen` root document-scrolls. A `fixed` wrapper pinned it to
  // the viewport so tall content overflowed past the bottom unscrollably (the same
  // class of bug reported on the non-golf settings page). Matches the rack page.
  if (game && showConfig && gameQ.data && canEdit) {
    // Stroke = PLACEMENT points: the owner sets a total pool + the placement split. Both
    // halves edit the SAME controlled draft slice (P3 3.1 split) — the bare Total renders
    // in GAME MANAGEMENT (via GameSetupRows), the placement editor in this "Point
    // Distribution" row (GROUP SETTINGS). Sharing one controlled object means the two
    // can't drift. The distribution reads its total FROM THE DRAFT (reconcile-safe).
    const placementControlled = {
      value: { total: configDraft.pointsTotal, distribution: configDraft.pointsDistribution },
      onChange: (total: number | null, distribution: PointsDistribution | null) => {
        setPointsTotalDraft(total);
        setPointsDistDraft(distribution);
      },
    };
    // Point Distribution row (GROUP SETTINGS) — the placement editor only (part="distribution").
    // Requires the total it distributes across; resolved once a pool is set.
    // Winner-takes-all (item 6) is the DEFAULT: a null / single-place distribution reads
    // "Winner takes all" (1st gets the whole total), not "Even". A real ≥2-place split
    // shows its breakdown. Both are valid configured states → always "resolved".
    const distIsWta = isWinnerTakesAll(configDraft.pointsDistribution);
    const pointDistributionRow = (
      <ChecklistRow
        icon={Scale}
        title="Point Distribution"
        subtitle={
          distIsWta
            ? "Winner takes all"
            : `${(configDraft.pointsDistribution as { values: number[] }).values.map(fmtValue).join(" · ")} pts`
        }
        state="resolved"
        expanded={openAccordion === "distribution"}
        onToggle={() => setOpenAccordion((o) => (o === "distribution" ? null : "distribution"))}
        testId="row-point-distribution"
      >
        <FormatPointsPanel
          game={gameQ.data as unknown as GameRow}
          canEdit={canEdit}
          controlled={placementControlled}
          part="distribution"
          winnerTakesAll
          entityCount={teamsQ.data?.length ?? null}
        />
      </ChecklistRow>
    );
    // Groupings row (GROUP SETTINGS, P3 3.2) — optional tee-groups over the create-only
    // roster, reusing rack's N-team RackGroupBuilder (stroke passes its roster split by
    // team). A membership change on a scored game is refused server-side (HAS_SCORES).
    const draftGroupCount = configDraft.groups.filter((g) => g.length > 0).length;
    const groupingsRow = (
      <ChecklistRow
        icon={Users}
        title="Groupings"
        subtitle={draftGroupCount > 0 ? `${draftGroupCount} group${draftGroupCount === 1 ? "" : "s"} · tap to edit tee groups` : "Required — everyone playing must be in a group"}
        state={draftGroupCount > 0 ? "resolved" : "empty"}
        expanded={openAccordion === "groupings"}
        onToggle={() => setOpenAccordion((o) => (o === "groupings" ? null : "groupings"))}
        testId="row-groupings"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Group players into tee groups — any mix across teams, up to 4 each. Everyone playing must be in a group; anyone left ungrouped isn&rsquo;t in the game.
        </p>
        <RackGroupBuilder groups={configDraft.groups} onChange={setGroupsDraft} teams={pickerTeams} />
      </ChecklistRow>
    );
    // Handicaps row (GROUP SETTINGS, P3 3.3) — INLINE per-player strokes (was a full-page
    // drill-down). Reuses the same HandicapList rack uses, editing the strokes draft slice
    // via onSetStrokes; commits on Save. The roster reads the DRAFT strokes so an unsaved
    // edit shows immediately. Stroke handicaps are per-player and don't gate on groupings.
    const draftHandicapPlayers = handicapPlayers.map((p) => ({ ...p, strokes: configDraft.strokes[p.id] ?? 0 }));
    const anyHandicap = draftHandicapPlayers.some((p) => p.strokes > 0);
    const handicapsRow = (
      <ChecklistRow
        icon={SlidersHorizontal}
        title="Handicaps"
        subtitle={anyHandicap ? "Strokes set — tap to adjust" : "Optional — set strokes per player"}
        state={anyHandicap ? "resolved" : "empty"}
        expanded={openAccordion === "handicaps"}
        onToggle={() => setOpenAccordion((o) => (o === "handicaps" ? null : "handicaps"))}
        testId="row-handicaps"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Strokes come off gross on the hardest holes — a friendly guess, not an official handicap.
        </p>
        <HandicapList players={draftHandicapPlayers} holeCount={scUnits.length} strokeIndex={scIndex} onSetStrokes={onSetStrokes} raised />
      </ChecklistRow>
    );
    // Game Modifiers row (P3 3.3) — INLINE ModifierCards panel (was a full-page drill-down
    // that self-persisted, moving the config hash and causing the false "modified
    // elsewhere" on the next Save). It now edits the modifiers DRAFT slice (persistModifiers
    // → setModifiersDraft) and commits on Save — no out-of-band write. Rendered AFTER Rules
    // via the modifiersRow slot (Match Play's canonical order).
    // NO Game Modifiers row. Stroke's `compatibleModifiers` is `[]` — match play is
    // the only format with one — so this built a row whose value was permanently
    // `undefined`, while `FORMAT_SURFACE.stroke.modifiers` claimed `true` about it.
    // Deleted rather than left dead: a structural absence stays absent.
    // Shared by the two GAME MANAGEMENT slots — see the note in RackGameView: the
    // canonical Total Points → Golf Course sequence needs two slots, not one "both".
    // #703 family: the COURSE row must read locked once scores exist, because the
    // server refuses the change (COURSE_LOCKED — par and stroke index would move
    // under entered scores). Match has always locked it; rack and stroke passed
    // `locked: false` and let the user change it, hit Save, and get an error instead
    // of seeing it was unavailable. A server refusal with no client lock is the
    // worse direction of the same gap.
    const scoresExist = (scoresQ.data?.length ?? 0) > 0;
    const setupRowsProps = {
      tripId,
      competitionId: gameCompetitionId,
      game: draftGameRow,
      canEdit,
      // Per-SLOT below: this object feeds Total Points too, which never locks.
      locked: false,
      onChanged: () => void refreshGame(),
      onApplyFront: applyFrontToDraft,
      onApplyBack: applyBackToDraft,
      onRemoveBackNine: removeBackNineFromDraft,
      onClearCourse: clearCourseInDraft,
      courseBusy,
    };
    return (
      <>
        <GameSettingsPage
          surface="stroke"
          onClose={closeConfig}
          tripId={tripId}
          competitionId={gameCompetitionId}
          game={draftGameRow}
          canEdit={canEdit}
          isOwner={isOwner}
          canManageGame={canManageGame}
          onChanged={() => void refreshGame()}
          onScoresReset={clearScores}
          onDeleted={() => router.push(gameCompetitionId ? `/trips/${tripId}/leaderboard` : `/trips/${tripId}`)}
          nameValue={configDraft.name}
          onNameChange={setNameDraft}
          delegateValue={configDraft.delegates[0] ?? null}
          onDelegateChange={(next) => setDelegatesDraft(next ? [next] : [])}
          // Stroke = PLACEMENT points: the bare Total (here) and the Point Distribution
          // row (GROUP SETTINGS, below) share this ONE controlled slice so the split
          // can't drift (P3 3.1).
          totalPointsRow={
            <GameSetupRows {...setupRowsProps} slot="config" placementPoints={placementControlled} />
          }
          courseRow={<GameSetupRows {...setupRowsProps} slot="course" locked={scoresExist} />}
          // Points term of the go-live gate (competition games only) — mirrors Match's
          // C3 gate. Standalone games (gameCompetitionId null) are unaffected. Stroke had
          // no client readiness gate at all before this (server still enforces mandatory
          // groupings independently; that gap is untouched — out of scope here, tracked
          // separately) — this adds ONLY the points term, not a general readiness gate.
          management={{
            scoringEnabled: configDraft.scoringEnabled,
            ready: !gameCompetitionId || pointsReady(configDraft.pointsTotal ?? 0),
            blockedReason:
              gameCompetitionId && !pointsReady(configDraft.pointsTotal ?? 0)
                ? "Set a point value before enabling scoring"
                : null,
            onEnable: handleEnable,
            onDisable: handleDisable,
            pending: saving,
            staged: configDraft.scoringEnabled !== scoringEnabled,
          }}
          // GROUP SETTINGS order (item 5): Groupings → Point Distribution → Handicaps —
          // distribution divides across the groups, so Groupings leads (dependency order).
          settingsRows={<>{groupingsRow}{pointDistributionRow}{handicapsRow}</>}
          rulesValue={configDraft.rulesForToday}
          onRulesChange={setRulesDraft}
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

  // The group currently being scored (entryGroupId), and its participants.
  const entryGroup = surfaceGroups.find((g) => g.id === entryGroupId);
  const entryParticipants: Participant[] = (entryGroup?.userIds ?? [])
    .map((id) => fieldParticipants.find((p) => p.id === id))
    .filter((p): p is Participant => !!p);

  // The first hole a group hasn't fully scored — where its entry opens (mirrors rack's
  // currentHoleForGroup, scoped to the tapped group instead of the whole round).
  const currentHoleForGroup = (gid: string) => {
    const g = surfaceGroups.find((x) => x.id === gid);
    if (!g) return 1;
    for (let h = 1; h <= scUnits.length; h++) {
      if (g.userIds.some((uid) => values[uid]?.[String(h)] == null)) return h;
    }
    return scUnits.length;
  };

  // ── Play ──
  if (game) {
    // The read-only scorecard grid — scoped to the group being scored (entry), else the
    // whole field (final). onCellTap (jump to a hole) is scorer-only.
    const gridParticipants = entryGroupId ? entryParticipants : fieldParticipants;
    const scorecardGrid = (
      <StandardGrid
        units={scUnits}
        tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
        teeRows={teeRows}
        gameId={game.id}
        participants={gridParticipants}
        values={values}
        direction="low_wins"
        pips={entryPips}
        saveStatus={saveStatus}
        onCellTap={canScoreStroke ? (label) => {
          setCurrentHole(Number(label) || 1);
          back();
        } : undefined}
      />
    );

    // (There is no post-finalize summary screen. Finalizing leaves you on the
    // scoreboard, which is where rack leaves you and where the result actually
    // lives — see the note at `handleFinish`.)

    // ENTRY (one level down) — a grouping is tapped: score just that group. A scorer of the
    // group gets the keypad; anyone else gets its read-only scorecard. Back → the surface.
    if (entryGroupId && entryGroup) {
      // A POSTED round is read-only for everyone, whatever their role — the same
      // rule rack applies (`readOnly = locked || !canScoreGroup`). Reopening a
      // correction clears `locked` and restores editing, so this is not a
      // one-way door. Without it an owner tapped into the keypad and every
      // keystroke round-tripped to a refusal.
      const canScoreThisGroup =
        !strokeLocked && (canEdit || (!!me && entryGroup.userIds.includes(me.id)));
      return (
        <div className={inPanel ? "absolute inset-0" : "fixed inset-0 z-50"}>
          {!canScoreThisGroup ? (
            <ScorecardSheet subtitle={courseName ?? undefined} onClose={back}>{scorecardGrid}</ScorecardSheet>
          ) : (
            <>
              <ScoreEntryView
                hideHeader={inPanel}
                gameName={entryGroup.name}
                units={scUnits}
                participants={entryParticipants}
                values={values}
                direction="low_wins"
                currentHole={currentHole}
                onHoleChange={setCurrentHole}
                onChange={onChange}
                onClear={onClear}
                saveStatus={saveStatus}
                onRetryCell={retryCell}
                pips={entryPips}
                onBack={back}
                onOpenGrid={() => setGridOpen(true)}
                onConfig={canEdit ? openConfig : undefined}
                // "Finish" on a group's entry is pure navigation back to the
                // scoreboard (like rack) — NOT finalize. Finalizing the whole game
                // is the organizer's game-level action on the scoreboard, gated on
                // ALL groups complete (multi-grouping fix). Empty subtext so the
                // shared default ("Saves results · shows final standings") — which
                // describes the old game-finish behavior — doesn't mislead.
                onFinish={back}
                finishSubtext=""
              />
              {gridOpen && <ScorecardSheet subtitle={courseName ?? undefined} onClose={back}>{scorecardGrid}</ScorecardSheet>}
            </>
          )}
        </div>
      );
    }

    // SURFACE (landing) — where tapping the game lands (routing fix): the WHOLE-FIELD golf
    // leaderboard + the groupings as tappable rows. Entry is one level down (tap a grouping).
    // Everyone sees the board; a scorer taps their group into the keypad, anyone else into
    // the read-only scorecard.
    return (
      <div
        className={inPanel ? "absolute inset-0 overflow-y-auto" : "fixed inset-0 z-50 overflow-y-auto"}
        style={{ background: "var(--color-bt-base)" }}
        data-testid="stroke-surface"
      >
        {/* Stroke had NO lifecycle banner and no state label — it was the format
            that had no correction arm at all until #769, and it never grew a
            signal for the state that arm produces. Same shared component, same
            words and tone as the other three; it reads the same two columns
            `GameLifecycleActions` below already takes. Above the leaderboard, so
            "these standings are being revisited" is read before the standings. */}
        <div className="px-4 pt-3">
          <ScoringStateBanner status={gameQ.data?.status ?? null} correctionsOpen={strokeCorrectionsOpen} />
        </div>
        <StrokeLeaderboard rows={leaderboardRows} participants={fieldParticipants} />
        <FoursomeEntry
          groups={groupViews}
          onEnter={(id) => {
            setCurrentHole(currentHoleForGroup(id));
            setGridOpen(false);
            setEntryGroupId(id);
          }}
        />
        {/* Game-level finalize / correct / re-lock — the SHARED control, so
            stroke's conditions are rack's conditions rather than a second copy
            that agrees today. Organizer/owner/delegate only (hidden for others,
            not disabled); finalize only once every group is complete (all
            players, all holes, live over the current group set — a
            mid-round-added group re-blocks it). Never on a group's entry page. */}
        <GameLifecycleActions
          canEdit={canEdit}
          status={gameQ.data?.status ?? null}
          correctionsOpen={strokeCorrectionsOpen}
          allComplete={allGroupsComplete}
          finalizePending={finalizePending}
          correctPending={correctPending}
          onFinalize={handleFinish}
          onCorrect={handleCorrect}
        />
      </div>
    );
  }

  // ── Pick players ──
  const members = (crew.data ?? []).filter((c) => memberById.has(c.user_id));
  return (
    <div className="mx-auto max-w-md px-4 py-6" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>New stroke-play game</h1>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4 }}>Pick 2–4 players.</p>

      <div className="mt-4 flex flex-col gap-2">
        {members.map((c) => {
          const on = selected.includes(c.user_id);
          const name = memberById.get(c.user_id)?.name ?? "Player";
          return (
            <button
              key={c.user_id}
              onClick={() => toggle(c.user_id)}
              className="flex items-center justify-between text-left"
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
                border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                color: "var(--color-bt-text)",
                fontSize: 15,
              }}
            >
              {name}
              {on && <span style={{ color: "var(--color-bt-accent)", fontWeight: 700 }}>✓</span>}
            </button>
          );
        })}
      </div>

      <button
        onClick={start}
        disabled={selected.length < 2 || createGame.isPending || seedFoursome.isPending}
        className="mt-5 w-full disabled:opacity-40"
        style={{
          height: 50,
          borderRadius: 12,
          background: "var(--color-bt-accent)",
          color: "#0d1f1a",
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        Start game
      </button>
    </div>
  );
}

