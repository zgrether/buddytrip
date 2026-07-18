"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Scale, Settings, SlidersHorizontal, Sparkles, Users } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { useConfigSync, GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { useInGamePanel, usePublishGameChrome } from "@/components/games/GameChrome";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { FinalStandings } from "@/components/games/FinalStandings";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameConfigurationView } from "@/components/games/GameConfigurationView";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { HandicapList, type HandicapPlayer } from "@/components/games/HandicapRoster";
import { ModifierCards } from "@/components/games/ModifierCards";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { FormatPointsPanel } from "@/components/games/FormatPointsPanel";
import { RackGroupBuilder, type GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { configToStrokeDraft, strokeDraftToPayload, strokeDraftsEqual, type StrokeConfigDraft } from "@/lib/configDraft";
import { buildComposedCourseSnapshot, buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import type { ScorecardSchema } from "@/lib/courseIndex";
import { useConfigDraft } from "@/hooks/useConfigDraft";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { GAME_TYPES, getGameTypeDefinition } from "@/lib/gameTypes";
import { enabledCount, type ModifiersMap } from "@/lib/modifiers";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useScreenHistory } from "@/hooks/useScreenHistory";
import type { StrokeStanding } from "@/lib/strokePlay";
import { PLAYER_COLORS, unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import { strokeHoles } from "@/lib/matchPlay";
import { unconfirmedCount, type Participant, type ScoreValues } from "@/components/games/types";
import { showToast } from "@/lib/toast";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STROKE_PLAY = "gtt_stroke_play";

/**
 * StrokeGameView — the stroke-play game surface. Pick 2–4 crew → create game +
 * participants → hole-by-hole entry → Finish/Final + review grid.
 *
 * Spec 2 Phase 3: a persistence-BOUND composed view, re-HOSTED by both its route
 * wrapper AND the leaderboard's game PANEL (CompetitionFace) — same recipe as
 * MatchGameView/RackGameView/NonGolfGameView. Reads its OWN tripId (useParams) +
 * gameId (?game=); the back arrow (router.back) pops the ?game= entry and closes
 * the panel. Its scoring "Play" view is a `fixed inset-0` overlay (like match's
 * score sub-screen) — appropriate for focused entry; the setup/settings screens
 * are normal-flow panels.
 */
export function StrokeGameView() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  // Resume an existing game when the leaderboard (or a refresh) lands here with
  // ?game=<id>. Without reading this, the page always fell back to pick-players
  // and created a NEW game every time — the picked roster + scores never came
  // back, because they live on the original game id this page never loaded.
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
  const [view, setView] = useState<"entry" | "final">("entry");
  // The scorecard is an OVERLAY over the current view (entry or final), not a
  // third base view — so the caller stays mounted underneath and dismiss returns
  // to it with score state intact (#543).
  const [gridOpen, setGridOpen] = useState(false);
  // Browser/OS back steps out of the scorecard grid back to entry (not the
  // leaderboard). The grid is the one history-tracked sub-screen over entry.
  const backFromGrid = useScreenHistory(gridOpen ? 1 : 0, () => setGridOpen(false));
  const [currentHole, setCurrentHole] = useState(1);
  const [standings, setStandings] = useState<StrokeStanding[]>([]);
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
  const addParticipants = trpc.games.addParticipants.useMutation();

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

  // The game we're actually scoring: one created/joined this session, or the
  // ?game we opened once it has a roster. Null → show the pick-players screen.
  const game = useMemo<{ id: string; participants: Participant[] } | null>(() => {
    if (createdGame) return createdGame;
    if (urlGameId && resumeRoster.length > 0) {
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
  const handicapPlayers: HandicapPlayer[] = useMemo(
    () =>
      (game?.participants ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        avatarIcon: null,
        teamColor: null,
        strokes: strokesOf.get(p.id) ?? 0,
      })),
    [game, strokesOf]
  );

  // The id the saver writes to: the resumed game, else the one created here.
  const activeGameId = urlGameId ?? createdGame?.id;
  // Phase 2B.1: a configured game must be Enabled before its score screen opens.
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  // Draft-then-save (P2) lie sweep: NO scoring_enabled lock — every settings row (incl. the
  // inline handicaps / modifiers panels) stays editable in every mode; an edit stages into
  // the draft and Save commits it (the RPC refuses only the destroys tier — a course change
  // on a scored game, COURSE_LOCKED). `canEdit` (role) is the only gate.
  const gameCompetitionId = (gameQ.data as { competition_id?: string | null } | undefined)?.competition_id ?? null;

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

  // P3 3.2 — the group picker's team sections: the GAME ROSTER (create-only participants)
  // grouped by team, in teamsQ order, plus a neutral "Unassigned" bucket for roster members
  // not on a team. Only teams with ≥1 rostered player get a section. Players key by user_id
  // (what the groups draft stores + the RPC's groups[] path expects). This is the N-team
  // component's N-section input — rack passes the two competition teams; stroke passes its
  // roster split across however many teams it spans (2–4).
  const pickerTeams = useMemo<GroupBuilderTeam[]>(() => {
    const roster = (gameQ.data?.participants ?? []) as { user_id: string; name?: string }[];
    const teamOfUser = new Map<string, string>();
    for (const a of (assignQ.data ?? []) as { user_id: string; team_id: string }[]) teamOfUser.set(a.user_id, a.team_id);
    const nameFor = (uid: string, fallback?: string) =>
      (crew.data ?? []).find((c) => c.user_id === uid)?.displayName ?? fallback ?? "Player";
    const sections: GroupBuilderTeam[] = [];
    for (const t of (teamsQ.data ?? []) as { id: string; name: string; color: string }[]) {
      const players = roster
        .filter((p) => teamOfUser.get(p.user_id) === t.id)
        .map((p) => ({ id: p.user_id, name: nameFor(p.user_id, p.name), avatarIcon: null }));
      if (players.length) sections.push({ id: t.id, name: t.name, color: t.color, players });
    }
    const unassigned = roster
      .filter((p) => !teamOfUser.has(p.user_id))
      .map((p) => ({ id: p.user_id, name: nameFor(p.user_id, p.name), avatarIcon: null }));
    if (unassigned.length) sections.push({ id: "__unassigned", name: "Unassigned", color: "var(--color-bt-text-dim)", players: unassigned });
    return sections;
  }, [gameQ.data, teamsQ.data, assignQ.data, crew.data]);

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
  // Game Modifiers → the modifiers draft slice (no server write until Save).
  const persistModifiers = (next: ModifiersMap) => setModifiersDraft(next);

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
  } = useConfigDraft<StrokeConfigDraft, typeof draftBundle>({
    tripId, gameId: activeGameId, view: "stroke", canEdit,
    showConfig, dirtyRef, discardRef,
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
  // it; stroke didn't, yet stroke has functional modifiers — moving_tees /
  // glorious_holes). Same component + same games.modifiers wiring as the match
  // page; persisted on-change (the stroke page's idiom — like onSetStrokes —
  // rather than the match accordion's persist-on-collapse). Seed the draft once
  // from the saved game, then own it locally.
  const availableModifiers = GAME_TYPES.find(
    (t) => t.id === (gameQ.data as { game_type_id?: string } | undefined)?.game_type_id
  )?.compatibleModifiers ?? [];
  // Score writes go through the connectivity-resilient saver: optimistic value,
  // retry-with-backoff, per-cell save status, kept-and-flagged (never rolled
  // back) on failure. Owns `values` + `saveStatus` for this game.
  const { values, setValues, saveStatus, onChange, onClear, retryCell, reconcile } =
    useScoreSaver(tripId, activeGameId);
  // Finishing also retries (idempotent — recomputes from the same scores); a
  // failure stays on the entry view and surfaces via the global error toast,
  // so it's loud + retryable instead of a silent stall.
  const finishGame = trpc.games.finish.useMutation({
    retry: 4,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 8000),
  });

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
    await addParticipants.mutateAsync({ tripId, gameId, userIds: selected });
    setCreatedGame({ id: gameId, participants: toParticipants(selected) });
    if (urlGameId) {
      void utils.games.getById.invalidate({ tripId, gameId });
    } else {
      // Stamp the new id into the URL so a refresh / re-entry resumes it.
      router.replace(`/trips/${param}/games/new?game=${gameId}`);
    }
  }

  // #550: as a PANEL, publish chrome to the app bar (back/title + owner gear) instead of
  // a second header. Handicaps/modifiers are inline panels now (P3 3.3), so there's no
  // drill-down that covers the bar. Standalone route keeps its headers.
  const inPanel = useInGamePanel();
  usePublishGameChrome(
    inPanel
      ? {
          title: (gameQ.data?.name as string | undefined)?.trim() || "Stroke Play",
          onSettings: !!game && canEdit && !showConfig && view !== "final" ? openConfig : undefined,
          hideBottomNav: !!game && scoringEnabled && !showConfig && view === "entry" && canScoreStroke,
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
    try {
      const res = await finishGame.mutateAsync({ tripId, gameId: game.id });
      setStandings(res.standings);
      setView("final");
    } catch {
      // Stay on the entry view (no silent advance). The global error toast
      // surfaces the failure; the Finish CTA stays tappable to retry (the
      // recompute is idempotent).
    }
  }

  function playAgain() {
    setCreatedGame(null);
    setValues({});
    setStandings([]);
    setSelected([]);
    setCurrentHole(1);
    setView("entry");
    setGridOpen(false);
    // Drop ?game so "Play again" starts a fresh game instead of resuming this one.
    if (urlGameId) router.replace(`/trips/${param}/games/new`);
  }

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
        {/* #550: as a panel the app bar carries back/title/gear. Standalone keeps it. */}
        {!inPanel && (
          <header className="flex shrink-0 items-center justify-between" style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
            <button onClick={() => router.back()} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
              <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
            </button>
            <div className="min-w-0 text-center">
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>Stroke Play</div>
              <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{`${game.participants.length} player${game.participants.length === 1 ? "" : "s"}`}</div>
            </div>
            {canEdit ? (
              <button onClick={openConfig} aria-label="Settings" className="flex h-9 w-9 items-center justify-center" data-testid="game-settings-gear">
                <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            ) : <div className="h-9 w-9" />}
          </header>
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
    const pointDistributionRow = (
      <ChecklistRow
        icon={Scale}
        title="Point Distribution"
        subtitle={
          configDraft.pointsDistribution?.type === "placement"
            ? "Custom placement split — tap to edit"
            : "Even — tap to set a placement split"
        }
        state={configDraft.pointsDistribution?.type === "placement" ? "resolved" : "empty"}
        disabled={!canEdit}
        expanded={openAccordion === "distribution"}
        onToggle={() => setOpenAccordion((o) => (o === "distribution" ? null : "distribution"))}
        testId="row-point-distribution"
      >
        <FormatPointsPanel
          game={gameQ.data as unknown as GameRow}
          canEdit={canEdit}
          controlled={placementControlled}
          part="distribution"
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
        subtitle={draftGroupCount > 0 ? `${draftGroupCount} group${draftGroupCount === 1 ? "" : "s"} · tap to edit tee groups` : "Optional — group players into tee times"}
        state={draftGroupCount > 0 ? "resolved" : "empty"}
        disabled={!canEdit}
        expanded={openAccordion === "groupings"}
        onToggle={() => setOpenAccordion((o) => (o === "groupings" ? null : "groupings"))}
        testId="row-groupings"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Group players into tee groups — any mix across teams, up to 4 each. Anyone left out just isn&rsquo;t grouped.
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
        disabled={!canEdit}
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
    const modifierCount = enabledCount(configDraft.modifiers, availableModifiers);
    const modifiersInlineRow = availableModifiers.length > 0 ? (
      <ChecklistRow
        icon={Sparkles}
        title="Game Modifiers"
        subtitle={modifierCount > 0 ? `${modifierCount} modifier${modifierCount === 1 ? "" : "s"} added` : "Optional — add special rules"}
        state={modifierCount > 0 ? "resolved" : "empty"}
        disabled={!canEdit}
        expanded={openAccordion === "modifiers"}
        onToggle={() => setOpenAccordion((o) => (o === "modifiers" ? null : "modifiers"))}
        testId="row-modifiers"
      >
        <ModifierCards available={availableModifiers} modifiers={configDraft.modifiers} onChange={persistModifiers} readOnly={!canEdit} />
      </ChecklistRow>
    ) : undefined;
    return (
      <>
        <GameConfigurationView
          onBack={closeConfig}
          tripId={tripId}
          competitionId={gameCompetitionId}
          game={gameQ.data as unknown as GameRow}
          canEdit={canEdit}
          isOwner={isOwner}
          settingsZoneLabel="Group Settings"
          // GROUP SETTINGS (P3): Point Distribution → Groupings → Handicaps (all inline).
          // GROUP SETTINGS order (item 5): Groupings → Point Distribution → Handicaps —
          // distribution divides across the groups, so Groupings leads (dependency order).
          leadingSettingsRows={<>{groupingsRow}{pointDistributionRow}{handicapsRow}</>}
          onChanged={() => void refreshGame()}
          onDeleted={() => router.push(gameCompetitionId ? `/trips/${tripId}/leaderboard` : `/trips/${tripId}`)}
          // Game Modifiers renders AFTER Rules Of The Day (Match Play's canonical order) —
          // an inline accordion now (P3 3.3), not a drill-down trigger.
          modifiersRow={modifiersInlineRow}
          serverScoringEnabled={scoringEnabled}
          draftScoringEnabled={configDraft.scoringEnabled}
          nameValue={configDraft.name}
          onNameChange={setNameDraft}
          delegateValue={configDraft.delegates[0] ?? null}
          onDelegateChange={(next) => setDelegatesDraft(next ? [next] : [])}
          rulesValue={configDraft.rulesForToday}
          onRulesChange={setRulesDraft}
          onApplyFront={applyFrontToDraft}
          onApplyBack={applyBackToDraft}
          onRemoveBackNine={removeBackNineFromDraft}
          onClearCourse={clearCourseInDraft}
          courseBusy={courseBusy}
          // Stroke = PLACEMENT points: the bare Total (GAME MANAGEMENT) and the Point
          // Distribution row (GROUP SETTINGS, above) share this ONE controlled slice so the
          // split can't drift (P3 3.1).
          placementPoints={placementControlled}
          onEnable={handleEnable}
          onDisable={handleDisable}
          busy={saving}
          saveBar={
            <SettingsSaveBar
              dirty={dirty}
              saving={saving}
              error={saveError}
              onSave={handleSaveConfig}
              onDiscard={confirmDiscard}
              onLeave={leave}
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

  // ── Play ──
  if (game) {
    // The read-only scorecard grid — shared by a non-scorer's landing surface and
    // the scorer's overlay. onCellTap (jump to a hole's entry) is scorer-only.
    const scorecardGrid = (
      <StandardGrid
        units={scUnits}
        tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
        teeRows={teeRows}
        gameId={game.id}
        participants={game.participants}
        values={values}
        direction="low_wins"
        pips={entryPips}
        saveStatus={saveStatus}
        onCellTap={canScoreStroke ? (label) => {
          setCurrentHole(Number(label) || 1);
          backFromGrid();
        } : undefined}
      />
    );
    return (
      // As a panel: fill BELOW the app bar; standalone: full-screen.
      <div className={inPanel ? "absolute inset-0" : "fixed inset-0 z-50"}>
        {!canScoreStroke ? (
          // #557: a viewer who can't score this game lands on the read-only
          // scorecard — now as an overlay; dismissing leaves the game (back to the
          // board), consistent with the "scorecard floats" model.
          <ScorecardSheet subtitle={courseName ?? undefined} onClose={() => router.back()}>{scorecardGrid}</ScorecardSheet>
        ) : (
          <>
            {view === "final" ? (
              <FinalStandings
                participants={game.participants}
                standings={standings}
                unitCount={scUnits.length}
                dateLabel={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                onScorecard={() => setGridOpen(true)}
                onPlayAgain={playAgain}
              />
            ) : (
              <ScoreEntryView
                hideHeader={inPanel}
                gameName="Stroke Play"
                units={scUnits}
                participants={game.participants}
                values={values}
                direction="low_wins"
                currentHole={currentHole}
                onHoleChange={setCurrentHole}
                onChange={onChange}
                onClear={onClear}
                saveStatus={saveStatus}
                onRetryCell={retryCell}
                pips={entryPips}
                onBack={() => router.back()}
                onOpenGrid={() => setGridOpen(true)}
                onConfig={canEdit ? openConfig : undefined}
                onFinish={handleFinish}
              />
            )}
            {/* Scorecard OVERLAY over entry/final — the base stays mounted so
                dismiss returns with in-progress entry intact (#543). */}
            {gridOpen && <ScorecardSheet subtitle={courseName ?? undefined} onClose={backFromGrid}>{scorecardGrid}</ScorecardSheet>}
          </>
        )}
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
        disabled={selected.length < 2 || createGame.isPending || addParticipants.isPending}
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

