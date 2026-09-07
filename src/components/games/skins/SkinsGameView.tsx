"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTripId } from "@/components/TripIdProvider";
import { Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useInGamePanel, useGameSurfaceChrome, type GameChromeData } from "@/components/games/GameChrome";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSkinsSaver, type SkinsRows } from "@/hooks/useSkinsSaver";
import { useConfigDraft } from "@/hooks/useConfigDraft";
import { useConfigSync, GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { useRealtimeGame } from "@/hooks/useRealtimeGame";
import { useRealtimeScoreEvents } from "@/hooks/useRealtimeScoreEvents";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { useScreenHistory } from "@/hooks/useScreenHistory";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { useExitToBoard } from "@/hooks/useExitToBoard";
import { useGameFinalize } from "@/hooks/useGameFinalize";
import { useOpenCorrection } from "@/hooks/useGameCorrection";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameSettingsPage } from "@/components/games/GameSettingsPage";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { GameLifecycleActions } from "@/components/games/GameLifecycleActions";
import { GameStandaloneHeader } from "@/components/games/GameStandaloneHeader";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { ModifierCards } from "@/components/games/ModifierCards";
import { RackGroupBuilder, type GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { FoursomeEntry, type FoursomeGroupView } from "@/components/games/rack/FoursomeEntry";
import { ScoringStateBanner } from "@/components/games/ScoringStateBanner";
import { SkinsBoard } from "./SkinsBoard";
import { SkinsEntryView } from "./SkinsEntryView";
import { SkinsScorecard } from "./SkinsScorecard";
import {
  configToSkinsDraft,
  skinsDraftToPayload,
  skinsDraftsEqual,
  type SkinsConfigDraft,
} from "@/lib/configDraft";
import { buildComposedCourseSnapshot, buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { modifiersSummary, enabledCount, type ModifiersMap } from "@/lib/modifiers";
import { unitsFromSchema, teeFromSchema } from "@/lib/strokePlayConfig";
import { computeStrokeTeamStandings } from "@/lib/strokePlay";
import { gameLockState } from "@/lib/gameLifecycle";
import { pointsReady } from "@/lib/matchDraft";
import {
  tallySkins,
  computeSkinsStandings,
  skinsGloriousConfig,
  type SkinsOutcomeRow,
} from "@/lib/skins";
import type { ScorecardSchema } from "@/lib/courseIndex";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import type { Participant } from "@/components/games/types";

const SKINS = "gtt_skins";

/**
 * SkinsGameView — the skins game surface.
 *
 * A persistence-BOUND composed view (owns tRPC/state), re-hosted by both its
 * route wrapper and the leaderboard's game PANEL, the same recipe every other
 * format uses (CLAUDE.md #12). It reads its own `tripId` and `?game=`, so no
 * prop threading, and the back arrow pops the `?game=` entry to close the panel.
 *
 * ── Why it is not the stroke surface ──────────────────────────────────────
 *
 * Scramble shares `StrokeGameView` because it IS that surface with a different
 * scorer. Skins is not: its entry is a choice LIST rather than a keypad, its
 * board carries a per-grouping carryover pot that nothing else in the app has,
 * and it computes no handicaps at all — so the stroke settings page's handicap
 * roster and scoring-type control would both be rows about nothing.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 *
 *   depth 0 · the board: leaderboard + pots + the groupings as tappable cards
 *   depth 1 · one grouping's entry (`SkinsEntryView`)
 *   depth 2 · that grouping's scorecard, as an overlay over its entry
 *
 * Settings is the shared `GameSettingsPage`, driven by one composite draft and
 * committed by one atomic `save_game_config` (CLAUDE.md #18).
 */
export function SkinsGameView() {
  const { tripId } = useTripId();
  const router = useRouter();
  const search = useSearchParams();
  const me = useCurrentUser();
  const utils = trpc.useUtils();

  const gid = search.get("game");
  const { canEdit, canManageGame } = useGameEditAccess(tripId, gid);

  const [entryGroupId, setEntryGroupId] = useState<string | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [currentHole, setCurrentHole] = useState(1);
  const [openAccordion, setOpenAccordion] = useState<"groupings" | "modifiers" | null>(null);

  // ── Composite draft SLICES (null = untouched → tracks the server) ─────────
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [scoringDraft, setScoringDraft] = useState<boolean | null>(null);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null | undefined>(undefined);
  const [groupsDraft, setGroupsDraft] = useState<string[][] | null>(null);
  const [modifiersDraft, setModifiersDraft] = useState<ModifiersMap | null>(null);
  const [courseDraft, setCourseDraft] = useState<SkinsConfigDraft["course"] | null>(null);
  const [courseBusy, setCourseBusy] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────
  const gameQ = trpc.games.getById.useQuery(
    { tripId: tripId!, gameId: gid! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid }
  );
  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  /**
   * THE GAME'S competition. There is no second answer, and no fallback.
   *
   * A trip can hold more than one, and `competitions.getByTrip` answers with the
   * trip's FIRST — so reading it here resolved every team lookup against a
   * competition this game is not in. Found by probing the rendered avatar
   * backgrounds rather than by reading: the colours that came back were real
   * team colours from the OTHER cup, which is why it looked right.
   *
   * `undefined` UNTIL THE GAME ROW LOADS, deliberately. An earlier version fell
   * back to the trip's competition while `gameQ` was in flight, which fixed the
   * displayed colours and left the first render fetching the wrong cup's teams
   * and JOINING ITS REALTIME TOPIC before correcting itself. A transient wrong
   * answer is still a wrong answer; not answering yet is the honest state, and
   * every consumer below already gates on the id being present.
   *
   * A STANDALONE game keeps a null competition and gets no teams, which is
   * correct — it has none. The trip-level competition is read for exactly one
   * thing, the board exit below, where "back to the leaderboard" is a trip-level
   * idea rather than this game's.
   */
  const competitionId = gameQ.data
    ? (((gameQ.data as { competition_id?: string | null }).competition_id ?? undefined) || undefined)
    : undefined;
  const tripCompetitionId = competition.data?.id as string | undefined;
  const teamsQ = trpc.teams.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );
  const assignQ = trpc.teamAssignments.list.useQuery(
    { tripId: tripId!, competitionId: competitionId! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );
  const groupsQ = trpc.playGroups.listByGame.useQuery(
    { tripId: tripId!, gameId: gid! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid }
  );
  const orgQ = trpc.games.listOrganizers.useQuery(
    { tripId: tripId!, gameId: gid! },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid }
  );
  // The recorded holes are STATE — polled like every other score read, and
  // reconciled below so a teammate's entry lands without clobbering mine.
  const holesQ = trpc.skinsOutcomes.listByGame.useQuery(
    { tripId: tripId!, gameId: gid! },
    { enabled: !!tripId && !!gid, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false }
  );

  const refetchHoles = useCallback(() => {
    if (tripId && gid) void utils.skinsOutcomes.listByGame.invalidate({ tripId, gameId: gid });
  }, [utils, tripId, gid]);
  const saver = useSkinsSaver(tripId, gid, refetchHoles);
  const { rows, saveStatus, refusals, onChange, onClear, retryCell, reconcile } = saver;

  const { correct: handleCorrect, isPending: correctPending } = useOpenCorrection(tripId, gid, competitionId);
  const { rows: teeRows, courseName } = useScorecardTeeRows(tripId, gameQ.data);

  // ── Names, teams, roster ─────────────────────────────────────────────────
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of crew.data ?? []) m.set(c.user_id, c.displayName ?? c.user?.name ?? "Player");
    return m;
  }, [crew.data]);
  const avatarOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of crew.data ?? []) m.set(c.user_id, c.user?.avatar_icon ?? null);
    return m;
  }, [crew.data]);
  const teamIds = useMemo(() => (teamsQ.data ?? []).map((t) => t.id as string), [teamsQ.data]);
  const teamOfUser = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignQ.data ?? []) m.set(a.user_id as string, a.team_id as string);
    return m;
  }, [assignQ.data]);
  const teamMeta = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const t of teamsQ.data ?? []) {
      m.set(t.id as string, { name: (t.name as string) ?? "Team", color: (t.color as string) ?? "var(--color-bt-text-dim)" });
    }
    return m;
  }, [teamsQ.data]);
  /** A player's colour is their ROSTER team's, so an unassigned player reads
   *  neutral rather than borrowing somebody's. Same rule as every other surface. */
  const colorOf = useCallback(
    (uid: string) => teamMeta.get(teamOfUser.get(uid) ?? "")?.color ?? "var(--color-bt-text-dim)",
    [teamMeta, teamOfUser]
  );

  /** The picker's sections, in canonical roster order (assignQ arrives ordered
   *  by team_id, sort_order — the same contract rack relies on). */
  const builderTeams = useMemo<GroupBuilderTeam[]>(() => {
    const byTeam = new Map<string, GroupBuilderTeam>();
    for (const id of teamIds) {
      const meta = teamMeta.get(id);
      byTeam.set(id, { id, name: meta?.name ?? "Team", color: meta?.color ?? "var(--color-bt-text-dim)", players: [] });
    }
    for (const a of assignQ.data ?? []) {
      const uid = a.user_id as string;
      byTeam.get(a.team_id as string)?.players.push({
        id: uid,
        name: nameOf.get(uid) ?? "Player",
        avatarIcon: avatarOf.get(uid) ?? null,
      });
    }
    return [...byTeam.values()];
  }, [teamIds, teamMeta, assignQ.data, nameOf, avatarOf]);

  // ── Scorecard units + the glorious config ────────────────────────────────
  const scUnits = useMemo(
    () => unitsFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0]),
    [gameQ.data]
  );
  const glorious = useMemo(
    () =>
      skinsGloriousConfig(
        (gameQ.data?.game_type_id as string | undefined) ?? null,
        (gameQ.data?.modifiers as ModifiersMap | undefined) ?? null
      ),
    [gameQ.data]
  );

  // ── Server holes → the engine's shape, reconciled into the saver ─────────
  const serverRows = useMemo<SkinsRows>(() => {
    const out: SkinsRows = {};
    for (const h of holesQ.data ?? []) {
      const gidKey = h.grouping_id as string;
      (out[gidKey] ??= []).push({
        hole: h.hole_number as number,
        result: h.result as "won" | "tied",
        winnerId: (h.winner_user_id as string | null) ?? null,
      });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.hole - b.hole);
    return out;
  }, [holesQ.data]);
  useEffect(() => {
    if (!gid || !holesQ.data) return;
    reconcile(serverRows);
  }, [gid, holesQ.data, serverRows, reconcile]);

  // ── Sync (CLAUDE.md #16 / #19 / #20) ─────────────────────────────────────
  const onConfigChanged = useCallback(() => {
    if (!tripId || !gid) return;
    void utils.games.getById.invalidate({ tripId, gameId: gid });
    void utils.playGroups.listByGame.invalidate({ tripId, gameId: gid });
  }, [utils, tripId, gid]);
  useConfigSync(tripId, gid, !!gid, onConfigChanged);
  useRealtimeGame(tripId, gid);
  useRealtimeMembers(tripId);
  useRealtimeScoreEvents(tripId, competitionId ?? null);

  // ── The draft ────────────────────────────────────────────────────────────
  const serverGroups = useMemo<string[][]>(
    () =>
      (groupsQ.data?.groups ?? []).map((grp) =>
        (groupsQ.data?.participants ?? []).filter((p) => p.play_group_id === grp.id).map((p) => p.user_id as string)
      ),
    [groupsQ.data]
  );
  const serverDelegates = useMemo(
    () => ((orgQ.data ?? []) as { user_id: string }[]).map((d) => d.user_id).sort(),
    [orgQ.data]
  );
  const serverConfigDraft = useMemo<SkinsConfigDraft>(
    () =>
      configToSkinsDraft(
        (gameQ.data ?? {}) as Parameters<typeof configToSkinsDraft>[0],
        serverGroups,
        serverDelegates
      ),
    [gameQ.data, serverGroups, serverDelegates]
  );
  const anyTouched =
    nameDraft !== null ||
    rulesDraft !== null ||
    scoringDraft !== null ||
    delegatesDraft !== null ||
    pointsTotalDraft !== undefined ||
    groupsDraft !== null ||
    modifiersDraft !== null ||
    courseDraft !== null;
  const configDraft = useMemo<SkinsConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      scoringEnabled: scoringDraft ?? serverConfigDraft.scoringEnabled,
      pointsTotal: pointsTotalDraft !== undefined ? pointsTotalDraft : serverConfigDraft.pointsTotal,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
      groups: groupsDraft ?? serverConfigDraft.groups,
      modifiers: modifiersDraft ?? serverConfigDraft.modifiers,
      course: courseDraft ?? serverConfigDraft.course,
    }),
    [
      serverConfigDraft, nameDraft, rulesDraft, scoringDraft, delegatesDraft,
      pointsTotalDraft, groupsDraft, modifiersDraft, courseDraft,
    ]
  );

  /** The game row as the DRAFT sees it — the course row renders from
   *  `game.course_id` / `scorecard_schema`, so it must reflect the PENDING pick
   *  or the selection visibly spits back (Cluster A1, match's reference). */
  const draftGameRow = useMemo(
    () =>
      ({
        ...(gameQ.data as unknown as GameRow),
        name: configDraft.name,
        course_id: configDraft.course.id,
        back_course_id: configDraft.course.backId,
        scorecard_schema: configDraft.course.scorecardSchema,
      }) as GameRow,
    [gameQ.data, configDraft.name, configDraft.course]
  );

  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});
  const { open: showConfig, openConfig, closeConfig, confirmingClose, confirmDiscard, cancelClose, leave } =
    useGameSettingsOverlay({
      canEdit,
      deepLink: search.get("settings") === "1",
      isDirty: () => dirtyRef.current,
      onDiscard: () => discardRef.current(),
    });

  function resetSlices() {
    setNameDraft(null);
    setRulesDraft(null);
    setScoringDraft(null);
    setDelegatesDraft(null);
    setPointsTotalDraft(undefined);
    setGroupsDraft(null);
    setModifiersDraft(null);
    setCourseDraft(null);
  }

  async function refreshGame() {
    if (!tripId || !gid) return;
    await utils.games.getById.invalidate({ tripId, gameId: gid });
    await utils.playGroups.listByGame.invalidate({ tripId, gameId: gid });
    if (competitionId) {
      // #10 — the child alone is silently undone by the face's re-seed, so the
      // BOOTSTRAP is the one that actually refreshes the board.
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }

  const { saveState, saving, saveError, setSaveError, handleSave, handleCancel } = useConfigDraft<
    SkinsConfigDraft,
    { name: string | null; rules: string | null; scoring: boolean | null; delegates: string[] | null; pointsTotal: number | null | undefined; groups: string[][] | null; modifiers: ModifiersMap | null; course: SkinsConfigDraft["course"] | null }
  >({
    tripId,
    gameId: gid,
    view: "skins",
    canEdit,
    showConfig,
    dirtyRef,
    discardRef,
    ready: !!gameQ.data && groupsQ.isSuccess && orgQ.isSuccess,
    serverConfigDraft,
    configDraft,
    anyTouched,
    draftsEqual: skinsDraftsEqual,
    toPayload: (draft, baseline) => skinsDraftToPayload(draft, baseline),
    bundle: {
      name: nameDraft, rules: rulesDraft, scoring: scoringDraft, delegates: delegatesDraft,
      pointsTotal: pointsTotalDraft, groups: groupsDraft, modifiers: modifiersDraft, course: courseDraft,
    },
    applyRecovered: (b) => {
      setNameDraft(b.name);
      setRulesDraft(b.rules);
      setScoringDraft(b.scoring);
      setDelegatesDraft(b.delegates);
      setPointsTotalDraft(b.pointsTotal);
      setGroupsDraft(b.groups);
      setModifiersDraft(b.modifiers);
      setCourseDraft(b.course);
    },
    reset: () => resetSlices(),
    onSaved: refreshGame,
  });

  // ── Course staging (identical to rack's; the snapshot is what freezes) ────
  const gameTypeId = (gameQ.data?.game_type_id as string | undefined) ?? "";
  const applyFrontToDraft = (courseId: string, teeName?: string) => {
    if (!gameTypeId) return;
    setCourseBusy(true);
    void (async () => {
      try {
        const course = await utils.courses.getById.fetch({ courseId });
        const snap = buildCourseSnapshot(course as unknown as CourseSnapshotInput, gameTypeId, teeName);
        if (!snap.ok) {
          setSaveError(
            snap.reason === "bad_index"
              ? "That course's stroke index isn't a valid permutation — fix it before use."
              : "That game type has no scorecard to snapshot onto."
          );
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
    if (!gameTypeId) return;
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
          gameTypeId,
          backTeeName
        );
        if (!res.ok) {
          setSaveError("Couldn’t compose that back nine — try again.");
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
    const teeName = (
      (configDraft.course.scorecardSchema as { units?: { metadata?: { tee?: { name?: string } } } } | null)?.units
        ?.metadata?.tee?.name ?? ""
    ).trim();
    applyFrontToDraft(frontId, teeName || undefined);
  };
  const clearCourseInDraft = () => {
    setSaveError(null);
    setCourseDraft({ id: null, backId: null, scorecardSchema: getGameTypeDefinition(gameTypeId)?.scorecardSchema ?? null });
  };

  // ── Derived play state ───────────────────────────────────────────────────
  const groupings = useMemo(() => groupsQ.data?.groups ?? [], [groupsQ.data]);
  const membersOf = useCallback(
    (groupingId: string) =>
      (groupsQ.data?.participants ?? [])
        .filter((p) => p.play_group_id === groupingId)
        .map((p) => p.user_id as string),
    [groupsQ.data]
  );
  const participantOf = useCallback(
    (uid: string): Participant => ({
      id: uid,
      name: nameOf.get(uid) ?? "Player",
      color: colorOf(uid),
      avatarIcon: avatarOf.get(uid) ?? null,
    }),
    [nameOf, colorOf, avatarOf]
  );

  const groupingIds = useMemo(() => groupings.map((g) => g.id as string), [groupings]);
  const tallies = useMemo(
    () => tallySkins(groupingIds, rows, scUnits.length || 18, glorious),
    [groupingIds, rows, scUnits.length, glorious]
  );
  const standings = useMemo(
    () =>
      computeSkinsStandings(
        groupingIds.flatMap((g) => membersOf(g).map((userId) => ({ userId, groupingId: g }))),
        tallies
      ),
    [groupingIds, membersOf, tallies]
  );
  const allParticipants = useMemo(
    () => groupingIds.flatMap((g) => membersOf(g).map(participantOf)),
    [groupingIds, membersOf, participantOf]
  );
  /**
   * The team roll-up, through the SAME `computeStrokeTeamStandings` the server
   * finalize uses (`server/lib/skins.ts`) — so the live board and the banked
   * result cannot diverge, which is the whole of CLAUDE.md #8.
   */
  const teamRows = useMemo(
    () =>
      computeStrokeTeamStandings(
        standings.map((s) => ({ entityId: s.entityId, rawScore: s.skins, position: s.position })),
        Object.fromEntries(teamOfUser),
        "skins"
      ),
    [standings, teamOfUser]
  );
  const teamList = useMemo(
    () => teamIds.map((id) => ({ id, name: teamMeta.get(id)?.name ?? "Team", color: teamMeta.get(id)?.color ?? "var(--color-bt-text-dim)" })),
    [teamIds, teamMeta]
  );
  /** Holes RECORDED in a grouping — progress belongs to the group, because a
   *  hole is decided for everyone in it at once. */
  const thruOf = useCallback(
    (groupingId: string) => (tallies[groupingId]?.lines ?? []).filter((l) => l.status !== "unplayed").length,
    [tallies]
  );

  const groupNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of groupings) m[g.id as string] = (g.display_name as string) ?? "Group";
    return m;
  }, [groupings]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  const correctionsOpen = !!(gameQ.data as { corrections_open?: boolean } | undefined)?.corrections_open;
  // Only `isLocked` is read here — the subtitle and the read-only scorecard
  // path. `isFinal` is NOT destructured: `GameLifecycleActions` derives its own
  // from the same two columns through the shared predicate, and a second copy
  // here is exactly the divergence #24 catalogues.
  const { isLocked: locked } = gameLockState({ status: gameQ.data?.status, correctionsOpen });
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  const exitToBoard = useExitToBoard(tripId, competitionId ?? tripCompetitionId ?? null);
  const { finalize, isPending: finalizePending } = useGameFinalize({
    tripId,
    gameId: gid,
    competitionId,
    refreshSelf: () => void utils.games.getById.invalidate({ tripId: tripId!, gameId: gid! }),
    onExit: exitToBoard,
  });

  const entryDepth = entryGroupId ? (!locked && gridOpen ? 2 : 1) : 0;
  const back = useScreenHistory(entryDepth, () => {
    if (!locked && gridOpen) setGridOpen(false);
    else setEntryGroupId(null);
  });

  const draftGroupsAssigned = configDraft.groups.some((g) => g.length > 0);
  const needsSetup = !!gid && groupsQ.isSuccess && groupings.length === 0;
  /** Every hole recorded in every grouping — the finalize gate. There is no
   *  close-out to shortcut it: every skins hole pays, so every one is played. */
  const allComplete =
    groupingIds.length > 0 &&
    groupingIds.every((g) => (tallies[g]?.lines ?? []).every((l) => l.status !== "unplayed"));

  const inPanel = useInGamePanel();
  const activeGroupName = entryGroupId ? groupNames[entryGroupId] : undefined;
  const standaloneChrome = useGameSurfaceChrome(
    gameQ.data || gid
      ? {
          title: (gameQ.data?.name as string | undefined)?.trim() || "Skins",
          titleSuffix: entryGroupId ? (activeGroupName ?? "Group") : undefined,
          onSettings: gid && !entryGroupId && !showConfig && !needsSetup && canEdit ? openConfig : undefined,
          rules:
            gid && tripId && !showConfig && gameQ.data
              ? {
                  tripId,
                  gameId: gid,
                  gameTypeId: SKINS,
                  canEdit,
                  text: (gameQ.data?.rules_for_today as string | null) ?? null,
                }
              : undefined,
          onScorecard: entryGroupId && !gridOpen ? () => setGridOpen(true) : undefined,
          // Hides the trip bottom nav at every width AND the top app bar on
          // mobile — ONE flag read by both consumers, never two booleans that
          // must agree (#24).
          focusedEntry: !!entryGroupId,
        }
      : null
  );

  if (!tripId) return null;

  // ── Settings ─────────────────────────────────────────────────────────────
  if (showConfig && gid && gameQ.data && canEdit) {
    const groupCount = configDraft.groups.filter((g) => g.length > 0).length;
    const modCount = enabledCount(configDraft.modifiers, getGameTypeDefinition(SKINS)?.compatibleModifiers ?? []);
    const setupRowsProps = {
      tripId,
      competitionId: competitionId ?? null,
      game: draftGameRow,
      canEdit,
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
          surface="skins"
          onClose={closeConfig}
          tripId={tripId}
          competitionId={competitionId ?? null}
          game={draftGameRow}
          canEdit={canEdit}
          canDelegate={canManageGame}
          canManageGame={canManageGame}
          onChanged={() => void refreshGame()}
          onScoresReset={refetchHoles}
          onDeleted={() => router.push(competitionId ? `/trips/${tripId}/leaderboard` : `/trips/${tripId}`)}
          nameValue={configDraft.name}
          onNameChange={setNameDraft}
          delegateValue={configDraft.delegates[0] ?? null}
          onDelegateChange={(next) => setDelegatesDraft(next ? [next] : [])}
          // A PLACEMENT payout over the whole field, like stroke play — a skins
          // game is one contest producing a finishing order, not a set of slots
          // that each pay. So there is no per-slot divisor to show or derive.
          totalPointsRow={
            <GameSetupRows
              {...setupRowsProps}
              slot="config"
              rackPoints={{ value: configDraft.pointsTotal, onChange: (total) => setPointsTotalDraft(total) }}
            />
          }
          // The course row LOCKS once holes are recorded, because the server
          // refuses the change (COURSE_LOCKED via migration 185's widened
          // `v_has_scores`). A server refusal with no client lock is the worse
          // direction of the same gap — #703's family.
          courseRow={
            <GameSetupRows {...setupRowsProps} slot="course" locked={(holesQ.data?.length ?? 0) > 0} />
          }
          management={{
            scoringEnabled: configDraft.scoringEnabled,
            ready: draftGroupsAssigned && (!competitionId || pointsReady(configDraft.pointsTotal ?? 0)),
            blockedReason: !draftGroupsAssigned
              ? "Add at least one group before enabling scoring"
              : competitionId && !pointsReady(configDraft.pointsTotal ?? 0)
                ? "Set a point value before enabling scoring"
                : null,
            onEnable: () => setScoringDraft(true),
            onDisable: () => setScoringDraft(false),
            pending: saving,
            staged: configDraft.scoringEnabled !== scoringEnabled,
          }}
          settingsRows={
            <>
              <ChecklistRow
                icon={Users}
                title="Groupings"
                subtitle={
                  draftGroupsAssigned
                    ? `${groupCount} group${groupCount === 1 ? "" : "s"} · each plays its own skins`
                    : "No groups yet — add one to start"
                }
                state={draftGroupsAssigned ? "resolved" : "empty"}
                expanded={openAccordion === "groupings"}
                onToggle={() => setOpenAccordion((o) => (o === "groupings" ? null : "groupings"))}
                testId="row-groupings"
              >
                <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
                  Each group plays its OWN skins — its own pot, its own carryover, and a tie in one
                  never touches another. Pick 2–4 players per group from any team; anyone left out
                  sits this round out.
                </p>
                <RackGroupBuilder groups={configDraft.groups} onChange={setGroupsDraft} teams={builderTeams} />
              </ChecklistRow>
            </>
          }
          rulesValue={configDraft.rulesForToday}
          onRulesChange={setRulesDraft}
          // The Game Modifiers slot, not a row inside `settingsRows`. The
          // registry says this surface HAS a modifier and
          // `oneSettingsPage.test.ts` pins the declaration to the slot the view
          // actually passes — which is how it caught this being in the wrong
          // place, exactly as its own header says it should.
          modifiersRow={
            <ChecklistRow
              icon={Users}
              title="Game Modifiers"
              subtitle={
                modCount > 0
                  ? modifiersSummary(configDraft.modifiers, getGameTypeDefinition(SKINS)?.compatibleModifiers ?? [])
                  : "Optional — special rules for this round"
              }
              state={modCount > 0 ? "resolved" : "empty"}
              expanded={openAccordion === "modifiers"}
              onToggle={() => setOpenAccordion((o) => (o === "modifiers" ? null : "modifiers"))}
              testId="row-modifiers"
            >
              <ModifierCards
                available={getGameTypeDefinition(SKINS)?.compatibleModifiers ?? []}
                modifiers={configDraft.modifiers}
                onChange={setModifiersDraft}
              />
            </ChecklistRow>
          }
          saveBar={
            <SettingsSaveBar
              saveState={saveState}
              saving={saving}
              error={saveError}
              onSave={handleSave}
              onDiscard={handleCancel}
              onLeave={leave}
            />
          }
        />
        {confirmingClose && (
          <DiscardChangesPrompt
            onDiscard={confirmDiscard}
            onKeepEditing={cancelClose}
            onSave={() => {
              cancelClose();
              void handleSave().then((ok) => {
                if (ok) leave();
              });
            }}
            saving={saving}
          />
        )}
      </>
    );
  }

  if (!gid || needsSetup) {
    // The member view (no children) is the warm game-led message; an owner gets
    // the same frame plus the way in. Same split every other format uses.
    return (
      <Shell title="Skins" subtitle="Setup" onBack={exitToBoard} chrome={standaloneChrome}>
        <SetupPlaceholder
          tripId={tripId}
          game={(gameQ.data as GameRow | undefined) ?? null}
          message={
            canEdit
              ? "Add at least one group before this round can be played — each group plays its own skins, with its own pot."
              : undefined
          }
        >
          {canEdit && gid ? (
            <button
              onClick={openConfig}
              className="mx-auto flex items-center gap-2"
              style={{
                height: 48,
                padding: "0 22px",
                borderRadius: 12,
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-on-accent)",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Set up this game
            </button>
          ) : undefined}
        </SetupPlaceholder>
      </Shell>
    );
  }

  // ── Entry (depth 1) + its scorecard (depth 2) ────────────────────────────
  if (entryGroupId) {
    const players = membersOf(entryGroupId).map(participantOf);
    const groupRows: SkinsOutcomeRow[] = rows[entryGroupId] ?? [];
    const scorecard = (
      <SkinsScorecard
        units={scUnits}
        players={players}
        rows={groupRows}
        groupingId={entryGroupId}
        glorious={glorious}
        tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
        teeRows={teeRows}
        gameId={gid}
      />
    );
    // A LOCKED game opens the read-only card directly — there is nothing to
    // enter, and offering the entry surface would be an affordance that refuses.
    if (locked) {
      return (
        <ScorecardSheet title={groupNames[entryGroupId] ?? "Group"} subtitle={courseName ?? undefined} onClose={back}>
          {scorecard}
        </ScorecardSheet>
      );
    }
    return (
      <>
        <SkinsEntryView
          gameName={(gameQ.data?.name as string | undefined)?.trim() || "Skins"}
          units={scUnits}
          grouping={{ id: entryGroupId, name: groupNames[entryGroupId] ?? "Group", players }}
          rows={groupRows}
          onChange={onChange}
          onClear={onClear}
          currentHole={currentHole}
          onHoleChange={setCurrentHole}
          onFinish={() => void finalize()}
          onBack={back}
          onOpenGrid={() => setGridOpen(true)}
          onConfig={inPanel ? undefined : canEdit ? openConfig : undefined}
          meId={me?.id}
          glorious={glorious}
          saveStatus={saveStatus}
          refusals={refusals}
          onRetryCell={retryCell}
          hideHeader={inPanel}
          readOnly={!scoringEnabled}
          finishSubtext={allComplete ? "Saves results · shows final standings" : "Every hole must be in first"}
        />
        {gridOpen && (
          <ScorecardSheet title={groupNames[entryGroupId] ?? "Group"} subtitle={courseName ?? undefined} onClose={back}>
            {scorecard}
          </ScorecardSheet>
        )}
      </>
    );
  }

  // ── The board (depth 0) ──────────────────────────────────────────────────
  const groupViews: FoursomeGroupView[] = groupings.map((g) => {
    const id = g.id as string;
    const played = (tallies[id]?.lines ?? []).filter((l) => l.status !== "unplayed").length;
    const uids = membersOf(id);
    return {
      id,
      name: (g.display_name as string) ?? "Group",
      teeLabel: null,
      thru: played > 0 ? played : null,
      players: uids.map((uid) => ({ id: uid, name: nameOf.get(uid) ?? "Player", teamColor: colorOf(uid) })),
      mine: !!me?.id && uids.includes(me.id),
      // Neutral card + per-player dots: unlike scramble, a skins grouping is
      // several genuinely different competitors, so there is something to tell
      // apart and no single team colour to wear.
      teamColor: null,
      finished: played === scUnits.length && scUnits.length > 0,
    };
  });

  return (
    <Shell
      title="Skins"
      // `· final` is DROPPED while correcting rather than swapped for a second
      // word — a reopened game is live again, so the subtitle reads as it did
      // before the finalize. The banner carries the state.
      subtitle={locked ? "Per-hole skins · final" : "Per-hole skins · standings"}
      onBack={exitToBoard}
      chrome={standaloneChrome}
    >
      <div>
        {/* The one banner every format shows at the top of its board — "This game
            is worth 12 pts" in progress, and the locked / correcting states after
            a finalize. Reads the SAME two lifecycle columns through the SAME
            predicate as every other view, so skins cannot disagree with them
            about what a re-opened game looks like (CLAUDE.md #24, and this
            component's own header).

            NOT `PointsAtStake`, which was here first and was wrong: that is the
            inline chip a match CARD wears, so it rendered a bare "12 PTS" strip
            where the game surface has an established banner that says what the
            number MEANS. It also knew nothing about the lifecycle, so a posted
            skins game would have shown its value and never said it was final.

            `points_total` from the SERVER row, not the draft — the banner states
            what the game is worth, and an unsaved edit is not yet true of it. */}
        <ScoringStateBanner
          status={gameQ.data?.status ?? null}
          correctionsOpen={correctionsOpen}
          pointsTotal={(gameQ.data?.points_total as number | null) ?? null}
        />
        <SkinsBoard
          rows={standings}
          teamRows={teamRows}
          teams={teamList}
          participants={allParticipants}
          unitCount={scUnits.length}
          thruOf={thruOf}
        />
        <FoursomeEntry
          groups={groupViews}
          onEnter={(id) => {
            setEntryGroupId(id);
            // Land on the first hole this group has NOT recorded, so entry
            // resumes where the round is rather than at hole 1.
            const next = (tallies[id]?.lines ?? []).find((l) => l.status === "unplayed");
            setCurrentHole(next?.hole ?? 1);
            setGridOpen(false);
          }}
        />
        {/* Finalize / correction / re-lock, all three decided by the SHARED
            `gameLifecycle` predicate rather than by a fifth private copy of the
            rule (#24 — seven incidents, one missing abstraction). `allComplete`
            is this format's own answer to "can the server compute a real result
            yet", which is the one part that legitimately differs. */}
        <GameLifecycleActions
          canEdit={canEdit}
          status={gameQ.data?.status ?? null}
          correctionsOpen={correctionsOpen}
          allComplete={allComplete}
          finalizePending={finalizePending}
          correctPending={correctPending}
          onFinalize={() => void finalize()}
          onCorrect={handleCorrect}
        />
      </div>
    </Shell>
  );
}

/**
 * The page frame. As a PANEL the app bar already carries back / title / gear, so
 * the header is suppressed and the shell fills the panel; on the standalone route
 * (no bar) it keeps its own header. `chrome` being null IS panel mode — the same
 * signal every other format's Shell reads, so the two hosts cannot show
 * different actions.
 */
function Shell({
  title,
  subtitle,
  onBack,
  children,
  chrome,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
  chrome: GameChromeData | null;
}) {
  return (
    // min-height rather than h-full: the board is not in its own scroll
    // container, so it must GROW and let the panel scroll.
    <div className="flex flex-col" style={{ background: "var(--color-bt-base)", minHeight: chrome ? "100vh" : "100%" }}>
      {chrome && <GameStandaloneHeader title={title} subtitle={subtitle} onBack={onBack} chrome={chrome} />}
      <div className="flex-1">{children}</div>
    </div>
  );
}
