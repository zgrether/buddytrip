"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Users, Settings, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useInGamePanel, usePublishGameChrome } from "@/components/games/GameChrome";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { useConfigDraft } from "@/hooks/useConfigDraft";
import { useConfigSync, GAME_SYNC_INTERVAL_MS } from "@/hooks/useConfigSync";
import { showToast } from "@/lib/toast";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { RackGroupBuilder, type GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameConfigurationView } from "@/components/games/GameConfigurationView";
import { SettingsSaveBar } from "@/components/games/SettingsSaveBar";
import { DiscardChangesPrompt } from "@/components/games/DiscardChangesPrompt";
import { configToRackDraft, rackDraftToPayload, rackDraftsEqual, type RackConfigDraft } from "@/lib/configDraft";
import { buildComposedCourseSnapshot, buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { ModifiersRow } from "@/components/games/ModifiersRow";
import type { ScorecardSchema } from "@/lib/courseIndex";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { RackBoard, type RackTeam } from "@/components/games/rack/RackBoard";
import { GamePageHeader } from "@/components/competition/GamePageHeader";
import { FoursomeEntry, type FoursomeGroupView } from "@/components/games/rack/FoursomeEntry";
import { HandicapList, type HandicapPlayer } from "@/components/games/HandicapRoster";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { useScreenHistory } from "@/hooks/useScreenHistory";
import { playerStats, computeRack, rackProjectedTeamPoints, type RackPlayer, type RackMode } from "@/lib/rackNStack";
import { strokeHoles } from "@/lib/matchPlay";
import { unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import { unconfirmedCount, type Participant, type ScoreValues } from "@/components/games/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RACK = "gtt_rack_n_stack";

/** "07:40" → "7:40" (no AM/PM); "" / invalid → null. */
function teeLabel(t: string | null | undefined): string | null {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}
/**
 * RackGameView — the rack-n-stack game surface. Spec 2 Phase 2: a persistence-
 * BOUND composed view (owns tRPC/state), re-HOSTED by both its route wrapper AND
 * the leaderboard's game PANEL (CompetitionFace), same recipe as MatchGameView.
 * Reads its OWN tripId (useParams) + gameId (?game=), so no prop threading; the
 * back arrow (router.back) pops the ?game= entry and closes the panel.
 */
export function RackGameView() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery({ slugOrId: param }, { ...STRUCTURE_QUERY, enabled: !isId, retry: false });
  const tripId = isId ? param : resolved.data?.id;

  const me = useCurrentUser();
  const utils = trpc.useUtils();

  const [gameId, setGameId] = useState<string | null>(search.get("game"));
  // Resume the trip's latest in-progress rack game so returning here (no nav
  // entry yet) lands on the SAME game instead of starting a fresh one — which
  // would look like the handicaps/scores were lost.
  const gamesList = trpc.games.listByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const resumeId = useMemo(() => {
    const g = (gamesList.data ?? []).find((x) => x.game_type_id === RACK && x.status !== "complete");
    return (g?.id as string | undefined) ?? null;
  }, [gamesList.data]);
  const gid = gameId ?? resumeId;
  // #501 Part 1: delegate-aware canEdit (owner/org OR this game's delegate),
  // centralized in useGameEditAccess. isOwner stays trip-Owner-only.
  const { canEdit, isOwner, loading: roleLoading } = useGameEditAccess(tripId, gid);
  const [mode, setMode] = useState<RackMode>("current");
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [pendingCourse, setPendingCourse] = useState<{ id: string; name: string } | null>(null);
  const [entryGroupId, setEntryGroupId] = useState<string | null>(null);
  // The tapped group's scorecard: "entry" (score keypad) vs "grid" (the read grid,
  // opened by the top-right scorecard icon).
  // The scorecard is an OVERLAY over a group's entry view (not a third screen), so
  // the entry stays mounted underneath and dismiss returns with score state intact.
  const [gridOpen, setGridOpen] = useState(false);
  // Rack settings: GROUPINGS + HANDICAPS are inline accordions (the rack equivalents
  // of the 2v2 Matches/Handicaps rows), single-open. Draft-then-save (P2): every row
  // edits ONE composite draft (`configDraft` below) and nothing reaches the server
  // until Save — no per-collapse persist. `openAccordion` is UI-only now.
  const [openAccordion, setOpenAccordion] = useState<"groupings" | "handicaps" | null>(null);
  // ── Composite draft SLICES (null = untouched → tracks the server). Assembled over
  //    the server mirror in `configDraft`, mirroring MatchGameView / NonGolfGameView.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<string | null>(null);
  const [scoringDraft, setScoringDraft] = useState<boolean | null>(null);
  const [delegatesDraft, setDelegatesDraft] = useState<string[] | null>(null);
  // `undefined` = untouched (a drafted total can legitimately be null for "unset").
  const [pointsTotalDraft, setPointsTotalDraft] = useState<number | null | undefined>(undefined);
  const [groupsDraft, setGroupsDraft] = useState<string[][] | null>(null);
  const [strokesDraft, setStrokesDraft] = useState<Record<string, number> | null>(null);
  const [courseDraft, setCourseDraft] = useState<RackConfigDraft["course"] | null>(null);
  // The settings overlay stays here (confirm-on-leave refs the shared hook writes below).
  // The ONE settings overlay — owns open/close/back + the leaderboard deep link
  // (?settings=1). Confirm-on-leave: the whole page is ONE draft (commits on Save), so a
  // dirty back-press is guarded. `guardDirty` / `handleCancelConfig` reach the hook via
  // latest-refs (guardDirty reads `showConfig`, which the hook returns — a direct pass
  // would be circular). Deep-link path shares the #619 gap (outbox recovers the draft).
  const dirtyRef = useRef(false);
  const discardRef = useRef<() => void>(() => {});
  const {
    open: showConfig,
    openConfig,
    closeConfig,
    confirmingClose,
    confirmDiscard,
    cancelClose,
  } = useGameSettingsOverlay({
    canEdit,
    deepLink: search.get("settings") === "1",
    isDirty: () => dirtyRef.current,
    onDiscard: () => discardRef.current(),
  });
  const [currentHole, setCurrentHole] = useState(1);
  // Rack scores now go through the durable, confirmation-tracked saver (Spec 1a) —
  // same idempotent upsert + retry + outbox + per-cell status as stroke/match
  // (was a raw fire-and-forget mutate with no retry/status). Per-user entries, so
  // no participantType. `values` is seeded once from the server below.
  const { values, saveStatus, onChange, onClear, retryCell, reconcile } = useScoreSaver(tripId, gid);

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competitionId = competition.data?.id as string | undefined;
  const teamsQ = trpc.teams.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId });
  const assignQ = trpc.teamAssignments.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId });

  // game config + foursomes are STRUCTURE (kept); only the raw scores stay short
  // (STATE) so a reopen is instant while the scores re-fetch.
  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  // Multi-tee scorecard yardage rows (Spec 5b) — reads the persisted course record(s).
  const { rows: teeRows, courseName } = useScorecardTeeRows(tripId, gameQ.data);
  const groupsQ = trpc.playGroups.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  // Scores are STATE — poll (~20s, paused when tab hidden) so remote entries
  // reflect on this open board (game-state sync); reconcile below merges them in
  // without clobbering the active enterer.
  const scoresQ = trpc.scores.listByGame.useQuery(
    { tripId: tripId!, gameId: gid! },
    { enabled: !!tripId && !!gid, refetchInterval: GAME_SYNC_INTERVAL_MS, refetchIntervalInBackground: false },
  );

  // Per-game delegates (the draft's `delegates` slice) — same source the non-golf /
  // match settings pages read.
  const orgQ = trpc.games.listOrganizers.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  const serverDelegates = useMemo(
    () => ((orgQ.data ?? []) as { user_id: string }[]).map((d) => d.user_id).sort(),
    [orgQ.data],
  );

  const createGame = trpc.games.create.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const finishGame = trpc.games.finish.useMutation();
  // #7 correction path (owner/co-admin/delegate — server-gated by
  // requireGameRunAction). "Re-lock" reuses finish().
  const openCorrection = trpc.games.openCorrection.useMutation();

  // ── Names / teams ────────────────────────────────────────────────────
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

  // The two competing teams → A (left) / B (right). Order MUST match the
  // leaderboard hero so the rack ladder isn't flipped relative to it: the hero
  // orders teams by created_at (competitions.leaderboard / teams.list), so we
  // read the SAME created_at-ordered teams.list here (teamsQ) rather than
  // sorting the assignment team_ids (a random text id → arbitrary order, the
  // flip this fixes). A/B is display-only — the server rack finish keys results
  // by team_id and computeRack is symmetric, so side order can't change scoring.
  const teamIds = useMemo(
    () => (teamsQ.data ?? []).map((t) => t.id as string),
    [teamsQ.data]
  );
  const teamOf = useMemo(() => {
    const m = new Map<string, "A" | "B">();
    for (const a of assignQ.data ?? []) {
      const t = a.team_id === teamIds[0] ? "A" : a.team_id === teamIds[1] ? "B" : null;
      if (t) m.set(a.user_id as string, t);
    }
    return m;
  }, [assignQ.data, teamIds]);
  const teamMeta = useMemo(() => {
    const byId = new Map((teamsQ.data ?? []).map((t) => [t.id as string, t]));
    const mk = (id?: string): RackTeam => {
      const t = id ? byId.get(id) : undefined;
      return { name: (t?.name as string) ?? "Team", color: (t?.color as string) ?? "var(--color-bt-text-dim)" };
    };
    return { A: mk(teamIds[0]), B: mk(teamIds[1]) };
  }, [teamsQ.data, teamIds]);
  const colorForUser = (id: string) => (teamOf.get(id) === "A" ? teamMeta.A.color : teamMeta.B.color);

  // Canonical roster order (mig 070): assignQ.data arrives ordered by
  // (team_id, sort_order), so its index IS the canonical order — team A's roster
  // then team B's, each in the order set in the Edit Team modal. The handicap
  // roster derives its display order from this, not from foursome/participant order.
  const rosterOrder = useMemo(() => {
    const m = new Map<string, number>();
    (assignQ.data ?? []).forEach((a, i) => m.set(a.user_id as string, i));
    return m;
  }, [assignQ.data]);

  // Each team's roster in canonical sort_order (assignQ arrives ordered by
  // team_id, sort_order) — the combined pool the group builder picks from. Picking
  // top-to-bottom therefore follows the captain's order (handicap order if set).
  const teamRosters = useMemo(() => {
    const A: GroupBuilderTeam["players"] = [];
    const B: GroupBuilderTeam["players"] = [];
    for (const a of assignQ.data ?? []) {
      const uid = a.user_id as string;
      const entry = { id: uid, name: nameOf.get(uid) ?? "Player", avatarIcon: avatarOf.get(uid) ?? null };
      if (teamOf.get(uid) === "A") A.push(entry);
      else if (teamOf.get(uid) === "B") B.push(entry);
    }
    return { A, B };
  }, [assignQ.data, teamOf, nameOf, avatarOf]);

  const hasCompetition = !!competitionId && teamIds.length >= 2;

  // ── Scorecard + live values ──────────────────────────────────────────
  const scUnits = useMemo(
    () => unitsFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof unitsFromSchema>[0]),
    [gameQ.data]
  );
  const scIndex = useMemo(() => strokeIndexOf(scUnits), [scUnits]);
  const coursePar = useMemo(() => scUnits.reduce((a, u) => a + (u.par ?? 0), 0), [scUnits]);

  const loadedValues = useMemo(() => {
    const v: ScoreValues = {};
    for (const e of scoresQ.data ?? []) {
      if (e.value == null) continue;
      (v[e.participant_id] ??= {})[e.unit_label] = e.value;
    }
    return v;
  }, [scoresQ.data]);
  // Reflect scores from OTHER devices: reconcile server truth into the saver each
  // time the poll returns changed data, merged so the active enterer's unsaved
  // cells win (game-state sync). The saver's `values` stays the single source
  // (server-reconciled + live edits), so a clear removes from it cleanly and the
  // outbox recovery re-populates it. Handles the initial load too (empty local →
  // takes the server scores), so no separate seed-once is needed.
  useEffect(() => {
    if (!gid || !scoresQ.data) return;
    reconcile(loadedValues);
  }, [gid, scoresQ.data, loadedValues, reconcile]);
  const mergedFor = (pid: string) => values[pid] ?? {};

  // Config sync: on a config change from another device (foursomes reshuffled,
  // participant handicaps, modifiers/rules, course, go-live, finish), silently
  // refetch this game's config so members converge. Rack config spans the game
  // row + the play_groups/participants → invalidate both.
  const onConfigChanged = useCallback(() => {
    if (!tripId || !gid) return;
    void utils.games.getById.invalidate({ tripId, gameId: gid });
    void utils.playGroups.listByGame.invalidate({ tripId, gameId: gid });
  }, [utils, tripId, gid]);
  useConfigSync(tripId, gid, !!gid, onConfigChanged);

  // ── Rack read-model (the spec's novelty) ─────────────────────────────
  const participants = useMemo(() => groupsQ.data?.participants ?? [], [groupsQ.data]);
  const handicapOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of participants) m.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
    return m;
  }, [participants]);

  // A group's current hole = the first hole ANY of its members hasn't scored
  // yet, so opening a group drops you where it's at — not hole 1 every time
  // (the match-play board's currentHoleFor uses the same pattern, two-sided).
  const currentHoleForGroup = (groupId: string) => {
    const memberIds = participants.filter((p) => p.play_group_id === groupId).map((p) => p.user_id as string);
    for (let h = 1; h <= scUnits.length; h++) {
      if (memberIds.some((pid) => mergedFor(pid)[String(h)] == null)) return h;
    }
    return scUnits.length;
  };

  const rackPlayers = useMemo(() => {
    const players: RackPlayer[] = [];
    for (const p of participants) {
      const uid = p.user_id as string;
      const team = teamOf.get(uid);
      if (!team) continue;
      players.push({ id: uid, team, stats: playerStats(mergedFor(uid), handicapOf.get(uid) ?? 0, scUnits.map((u) => u.par ?? 0), scIndex) });
    }
    return players;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, teamOf, handicapOf, scUnits, scIndex, coursePar, loadedValues, values]);
  const rack = useMemo(() => computeRack(rackPlayers, mode, coursePar), [rackPlayers, mode, coursePar]);
  // Rack's `per_match` = points PER SLOT (the "Points per Slot" field); a legacy
  // rack with no per_match distribution → 1, mirroring the decided path
  // (`computeRackNStackResults`: `value = perMatch ? dist.value : 1`).
  const perSlotValue = useMemo(() => {
    const dist = gameQ.data?.points_distribution;
    return dist?.type === "per_match" ? dist.value : 1;
  }, [gameQ.data]);
  // #533 projection (rack) — "if it ended now" projected slots × the per-slot
  // value = COMPETITION points (the SAME shared helper the board's liveProjection
  // uses, so the two can't diverge; and the same currency as a match pill). Map
  // A/B → the two team ids.
  const projectedPoints = useMemo(
    () => rackProjectedTeamPoints(rackPlayers, coursePar, perSlotValue),
    [rackPlayers, coursePar, perSlotValue]
  );


  // Total-points migration — default `points_total` on first setup = players per
  // team (total roster ÷ teams), the SAME formula match play's MatchPointsRow uses
  // (behavior only, no caption). Roster-derived (assignQ), not rackSlotCount — the
  // default targets the whole-competition rhythm (8/16/32), not this game's
  // currently-added field.
  const defaultTotal = useMemo(() => {
    const totalPlayers = (assignQ.data ?? []).length;
    const teamCount = teamIds.length;
    if (teamCount === 0 || totalPlayers === 0) return 0;
    return Math.round(totalPlayers / teamCount);
  }, [assignQ.data, teamIds.length]);

  // ── Foursome views ───────────────────────────────────────────────────
  const groupViews: FoursomeGroupView[] = useMemo(() => {
    const groups = groupsQ.data?.groups ?? [];
    return groups.map((g) => {
      const members = participants.filter((p) => p.play_group_id === g.id);
      const thrus = members.map((p) => playerStats(mergedFor(p.user_id as string), 0, scUnits.map((u) => u.par ?? 0), scIndex).thru);
      const maxThru = thrus.length ? Math.max(...thrus) : 0;
      return {
        id: g.id as string,
        name: (g.display_name as string) ?? "Group",
        teeLabel: teeLabel((g as { tee_time?: string | null }).tee_time),
        thru: maxThru > 0 ? maxThru : null,
        players: members.map((p) => ({ id: p.user_id as string, name: nameOf.get(p.user_id as string) ?? "Player", teamColor: colorForUser(p.user_id as string) })),
        mine: !!me && members.some((p) => p.user_id === me.id),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsQ.data, participants, scUnits, scIndex, nameOf, me, loadedValues, values, teamOf, teamMeta]);

  const handicapPlayers: HandicapPlayer[] = useMemo(
    () =>
      participants
        .map((p) => {
          const id = p.user_id as string;
          return {
            id,
            name: nameOf.get(id) ?? "Player",
            avatarIcon: avatarOf.get(id) ?? null,
            teamColor: teamOf.get(id) ? colorForUser(id) : null,
            strokes: handicapOf.get(id) ?? 0,
          };
        })
        // Canonical roster order — not the foursome/participant order they arrive in.
        .sort((x, y) => (rosterOrder.get(x.id) ?? Infinity) - (rosterOrder.get(y.id) ?? Infinity)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participants, nameOf, avatarOf, teamOf, teamMeta, handicapOf, rosterOrder]
  );

  // ── Draft-then-save (P2) ─────────────────────────────────────────────────
  // The persisted play_groups as an ordered string[][] (one user-id array per cart),
  // and the participants' handicap strokes as a { userId → strokes } map — the two
  // structural inputs `configToRackDraft` folds into the baseline.
  const serverGroups = useMemo<string[][]>(
    () => (groupsQ.data?.groups ?? []).map((grp) =>
      (groupsQ.data?.participants ?? []).filter((p) => p.play_group_id === grp.id).map((p) => p.user_id as string)),
    [groupsQ.data],
  );
  const serverStrokes = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const p of participants) m[p.user_id as string] = effectiveStrokes(p as { handicap_strokes: number | null });
    return m;
  }, [participants]);
  const serverConfigDraft = useMemo<RackConfigDraft>(
    () => configToRackDraft((gameQ.data ?? {}) as Parameters<typeof configToRackDraft>[0], serverGroups, serverStrokes, serverDelegates),
    [gameQ.data, serverGroups, serverStrokes, serverDelegates],
  );

  const anyTouched =
    nameDraft !== null || rulesDraft !== null || scoringDraft !== null || delegatesDraft !== null ||
    pointsTotalDraft !== undefined || groupsDraft !== null || strokesDraft !== null || courseDraft !== null;

  const configDraft = useMemo<RackConfigDraft>(
    () => ({
      ...serverConfigDraft,
      name: nameDraft ?? serverConfigDraft.name,
      rulesForToday: rulesDraft ?? serverConfigDraft.rulesForToday,
      scoringEnabled: scoringDraft ?? serverConfigDraft.scoringEnabled,
      pointsTotal: pointsTotalDraft !== undefined ? pointsTotalDraft : serverConfigDraft.pointsTotal,
      delegates: delegatesDraft ?? serverConfigDraft.delegates,
      groups: groupsDraft ?? serverConfigDraft.groups,
      strokes: strokesDraft ?? serverConfigDraft.strokes,
      course: courseDraft ?? serverConfigDraft.course,
    }),
    [serverConfigDraft, nameDraft, rulesDraft, scoringDraft, delegatesDraft, pointsTotalDraft, groupsDraft, strokesDraft, courseDraft],
  );

  // Rack SLOT count over the DRAFT carts = rank-paired 1v1s = min(grouped-A, grouped-B),
  // the divisor for the per-slot points share (matches `computeRack`'s n and the payload
  // derivation). Draft-based so it tracks carts as the owner builds them.
  const draftSlotCount = useMemo(() => {
    let a = 0, b = 0;
    for (const uid of configDraft.groups.flat()) {
      const t = teamOf.get(uid);
      if (t === "A") a += 1;
      else if (t === "B") b += 1;
    }
    return Math.min(a, b);
  }, [configDraft.groups, teamOf]);
  const draftGroupsAssigned = configDraft.groups.some((g) => g.length > 0);

  // ── Handlers ─────────────────────────────────────────────────────────
  // The current persisted groups as a builder draft (one user-id array per group,
  // in group order) — seeds the builder when editing an existing game's groups.
  // Start a rack: create the game (if new) + apply the course, then open settings with
  // GROUPINGS expanded. No auto-assignment — the owner builds the carts from empty (the
  // draft's groups slice, seeded from the — empty — server set).
  async function startRack() {
    if (!tripId || !competitionId) return;
    let gameId: string;
    if (gid) {
      gameId = gid;
    } else {
      const g = await createGame.mutateAsync({ tripId, gameTypeId: RACK, name: "Rack-n-Stack", competitionId });
      gameId = g.id as string;
    }
    if (pendingCourse) {
      try {
        await applyCourse.mutateAsync({ tripId, gameId, courseId: pendingCourse.id });
      } catch {
        /* template default par/index still applies */
      }
    }
    await utils.playGroups.listByGame.invalidate({ tripId, gameId });
    setGameId(gameId);
    // Land in the settings page with GROUPINGS expanded (the first Settings item).
    setOpenAccordion("groupings");
    openConfig();
  }

  // Accordion toggles — UI-only now. Edits go straight to the composite draft; there's
  // no persist-on-collapse (Save commits, the outbox covers hard teardown).
  const toggleGroupings = () => setOpenAccordion((o) => (o === "groupings" ? null : "groupings"));
  const toggleHandicaps = () => setOpenAccordion((o) => (o === "handicaps" ? null : "handicaps"));

  // Handicaps → the strokes draft slice (the payload clamps 0–18 and nulls 0). Returns a
  // Promise to satisfy HandicapList's async onSetStrokes contract (no server call here).
  const onSetStrokes = (userId: string, strokes: number) => {
    setStrokesDraft((prev) => ({ ...(prev ?? serverConfigDraft.strokes), [userId]: strokes }));
    return Promise.resolve();
  };

  // ── Course ACTIONS stage into the course draft slice (mirrors MatchGameView). ──
  const [courseBusy, setCourseBusy] = useState(false);
  const gameTypeId = (gameQ.data?.game_type_id as string | undefined) ?? "";
  const applyFrontToDraft = (courseId: string, teeName?: string) => {
    if (!gameTypeId) return;
    setCourseBusy(true);
    void (async () => {
      try {
        const course = await utils.courses.getById.fetch({ courseId });
        const snap = buildCourseSnapshot(course as unknown as CourseSnapshotInput, gameTypeId, teeName);
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
    setCourseDraft({ id: null, backId: null, scorecardSchema: getGameTypeDefinition(gameTypeId)?.scorecardSchema ?? null });
  };

  // ── Save / Cancel the composite draft ──
  function resetSlices() {
    setNameDraft(null); setRulesDraft(null); setScoringDraft(null); setDelegatesDraft(null);
    setPointsTotalDraft(undefined); setGroupsDraft(null); setStrokesDraft(null); setCourseDraft(null);
  }

  async function finish() {
    if (!tripId || !gid) return;
    // Spec 1a: block finalize over unconfirmed scores (finish computes from server
    // rows — an unsaved cell would be silently omitted from standings).
    const gate = unconfirmedCount(saveStatus);
    if (gate.total > 0) {
      showToast(
        gate.errored > 0
          ? `${gate.errored} score${gate.errored > 1 ? "s" : ""} didn’t save — retry before finishing`
          : "Still saving scores — try again in a moment",
      );
      return;
    }
    await finishGame.mutateAsync({ tripId, gameId: gid });
    await utils.games.getById.invalidate({ tripId, gameId: gid });
    // #6: finalize changes the leaderboard — invalidate it so the board reflects
    // the result IMMEDIATELY (no realtime sub, only a 30s poll), instead of only
    // after leave-and-return ("showed 4 to 2 only after I left and came back").
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.games.listByTrip.invalidate({ tripId });
      // The Live face re-seeds competitions.leaderboard FROM faceBootstrap on
      // mount (setData), which marks it fresh and clobbers the invalidate above
      // with the bootstrap's cached value — so invalidate the bootstrap too, or
      // a re-locked correction reads stale until the 30s poll.
      utils.competitions.faceBootstrap.invalidate({ tripId });
    }
  }

  // #7: reopen a posted rack for correction (foursome cards become editable again
  // until re-locked via finish()).
  async function handleCorrect() {
    if (!tripId || !gid) return;
    try {
      await openCorrection.mutateAsync({ tripId, gameId: gid });
      await utils.games.getById.invalidate({ tripId, gameId: gid });
    } catch {
      // surfaced via the global error toast
    }
  }

  // Lifecycle #7: Final = locked. `locked` (posted) → read-only; `correcting`
  // (owner re-opened) → editable until re-locked.
  const correctionsOpen = !!(gameQ.data as { corrections_open?: boolean } | undefined)?.corrections_open;
  const locked = gameQ.data?.status === "complete" && !correctionsOpen;
  const correcting = gameQ.data?.status === "complete" && correctionsOpen;

  // Browser/OS back steps through the score-entry sub-screens (group entry → grid)
  // instead of jumping to the leaderboard. Depth: 0 = play screen, 1 = a group's
  // card, 2 = its grid view (only when not locked — a locked group shows the grid
  // directly, one level). `back()` is the one path every breadcrumb/finish uses.
  const entryDepth = entryGroupId ? (!locked && gridOpen ? 2 : 1) : 0;
  const back = useScreenHistory(entryDepth, () => {
    if (!locked && gridOpen) setGridOpen(false);
    else setEntryGroupId(null);
  });

  // A resumed competition game (gid set from ?game=) may have NO foursomes yet
  // (created as a bare games row by add-game). Route it to the setup step instead
  // of the empty play screen — startRack seeds onto the existing game.
  const needsSetup = !!gid && groupsQ.isSuccess && (groupsQ.data?.groups?.length ?? 0) === 0;
  // Phase 2B.1: a rack with its groups set must be Enabled before the play screen
  // opens (the score saver server-rejects entries until then).
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;

  // Draft durability (Layer 2 — hard-teardown outbox). Mirrors the WHOLE composite draft
  // (not just groups) to localStorage so a refresh / tab-close / OS-kill can't lose an
  // in-progress config edit. `serverFingerprint` = the config hash the draft diverged
  // from (the no-clobber guard: recovery only restores if the server hasn't moved).
  const draftBundle = useMemo(
    () => ({
      name: nameDraft, rules: rulesDraft, scoring: scoringDraft, delegates: delegatesDraft,
      pointsTotal: pointsTotalDraft, groups: groupsDraft, strokes: strokesDraft, course: courseDraft,
    }),
    [nameDraft, rulesDraft, scoringDraft, delegatesDraft, pointsTotalDraft, groupsDraft, strokesDraft, courseDraft],
  );
  const applyBundle = useCallback((b: typeof draftBundle) => {
    if (b.name != null) setNameDraft(b.name);
    if (b.rules != null) setRulesDraft(b.rules);
    if (b.scoring != null) setScoringDraft(b.scoring);
    if (b.delegates != null) setDelegatesDraft(b.delegates);
    if (b.pointsTotal !== undefined) setPointsTotalDraft(b.pointsTotal);
    if (b.groups != null) setGroupsDraft(b.groups);
    if (b.strokes != null) setStrokesDraft(b.strokes);
    if (b.course != null) setCourseDraft(b.course);
  }, []);

  // The shared draft-then-save lifecycle (#626) — baseline + hash + dirty + outbox +
  // confirm-on-leave sync + the atomic Save. Format-specific pieces are passed in.
  const {
    dirty, saveError, setSaveError, justSaved, saving, handleSave: handleSaveConfig, handleCancel: handleCancelConfig,
  } = useConfigDraft<RackConfigDraft, typeof draftBundle>({
    tripId, gameId: gid, view: "rack", canEdit,
    showConfig, dirtyRef, discardRef,
    serverConfigDraft, configDraft, anyTouched,
    draftsEqual: rackDraftsEqual,
    toPayload: (draft, base) => rackDraftToPayload(draft, draftSlotCount, base),
    bundle: draftBundle, applyRecovered: applyBundle, reset: resetSlices,
    onSaved: async () => {
      await Promise.all([gameQ.refetch(), groupsQ.refetch(), orgQ.refetch()]);
      if (competitionId) {
        utils.competitions.leaderboard.invalidate({ tripId, competitionId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
        utils.games.listByTrip.invalidate({ tripId });
      }
    },
  });

  async function refreshGame() {
    if (!tripId || !gid) return;
    await utils.games.getById.invalidate({ tripId, gameId: gid });
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  // Setup/Scoring toggle → the scoring draft slice; Save commits it (go-live readiness
  // is re-asserted server-side inside the tx, so the client gate can't be bypassed).
  function handleEnable() { setScoringDraft(true); }
  function handleDisable() { setScoringDraft(false); }

  // #550: as a PANEL, publish this screen's chrome to the app bar (back/title +
  // owner gear) instead of a second header. Standalone route (no provider) keeps
  // its own Shell/ScoreEntryView headers below.
  const inPanel = useInGamePanel();
  const rackGroupName = (groupsQ.data?.groups ?? []).find((g) => g.id === entryGroupId)?.display_name as string | undefined;
  const rackFinal = gameQ.data?.status === "complete";
  usePublishGameChrome(
    inPanel
      ? {
          title: entryGroupId
            ? rackGroupName ?? "Group"
            : (gameQ.data?.name as string | undefined)?.trim() || "Rack-n-Stack",
          // Gear on the scoreboard screens only (owner/delegate, not final) — not
          // on the entry, the config page, or the pre-setup steps.
          onSettings:
            gid && !entryGroupId && !showConfig && !needsSetup && canEdit && !rackFinal ? openConfig : undefined,
          hideBottomNav: !!entryGroupId,
        }
      : null,
  );

  // ── Render ───────────────────────────────────────────────────────────
  if (!tripId || roleLoading || crew.isLoading || competition.isLoading) {
    return <Center>Loading…</Center>;
  }
  // gid set but the game row / groups still loading → wait, don't flash an empty
  // play screen (or, right after create, the setup form before config opens).
  if (gid && (gameQ.isLoading || groupsQ.isLoading)) {
    return <Center>Loading…</Center>;
  }

  if (!hasCompetition) {
    return (
      <Shell hideHeader={inPanel} onBack={() => router.back()} title="Rack-n-Stack">
        <div className="flex flex-col items-center text-center" style={{ paddingTop: 72 }}>
          <div className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--color-bt-card-raised)", marginBottom: 16 }}>
            <Users size={24} style={{ color: "var(--color-bt-text-dim)" }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>Needs a competition with two teams</div>
          <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 6, maxWidth: 300 }}>
            Rack-n-Stack is a team format. Set up a competition and assign players to two teams first, then come back to run the rack.
          </p>
        </div>
      </Shell>
    );
  }

  // Entry: the tapped foursome's stroke-play card.
  if (entryGroupId && gid) {
    const members = participants.filter((p) => p.play_group_id === entryGroupId);
    // Score-entry access (Task 2 — reflect the server rule): owner/delegate score
    // any cart; a member scores only THEIR OWN cart. Tapping a cart you can't
    // score lands on the read-only scorecard (like a locked/posted card), never a
    // dead entry screen. The SERVER (canWriteScore + RLS) is the real gate.
    const canScoreGroup = canEdit || (!!me && members.some((m) => (m.user_id as string) === me.id));
    const groupName = (groupsQ.data?.groups ?? []).find((g) => g.id === entryGroupId)?.display_name as string | undefined;
    const ps: Participant[] = members.map((p) => {
      const id = p.user_id as string;
      const name = nameOf.get(id) ?? "Player";
      return { id, name, color: colorForUser(id), avatarIcon: avatarOf.get(id) ?? null };
    });
    // Stroke pips per player on the COURSE's stroke-index holes. Rack already
    // SCORES net via this index (playerStats) — surfacing the pips so the card
    // shows which holes are stroked (was invisible: no pips, no net shown).
    const groupPips: Record<string, Set<string>> = {};
    for (const p of ps) {
      groupPips[p.id] = new Set([...strokeHoles(handicapOf.get(p.id) ?? 0, scIndex)].map(String));
    }
    // Locked (posted) → the read-only scorecard grid (#7). Otherwise the editable
    // entry, with a grid view toggled by the top-right scorecard icon (onOpenGrid).
    // Correcting re-opens editing (locked=false).
    // Read-only scorecard when the card is locked/posted, the grid is toggled on,
    // OR the viewer can't score this cart (Task 2) — no tap-to-edit in any of those.
    const readOnly = locked || !canScoreGroup;
    // The read-only scorecard grid — shared by a locked/read-only viewer's landing
    // surface and the scorer's overlay. onCellTap (jump to a hole's entry) is
    // editable-only.
    const scorecardGrid = (
      <StandardGrid
        units={scUnits}
        tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
        teeRows={teeRows}
        gameId={gid}
        participants={ps}
        values={Object.fromEntries(ps.map((p) => [p.id, mergedFor(p.id)]))}
        direction="low_wins"
        pips={groupPips}
        onCellTap={readOnly ? undefined : (label) => { setCurrentHole(Number(label) || 1); back(); }}
      />
    );
    const scorecardTitle = `${groupName ?? "Group"}${locked ? " · Final" : " · Scorecard"}`;
    if (readOnly) {
      // Locked/posted OR a viewer who can't score this cart lands on the read-only
      // scorecard — now an overlay; dismiss returns to the rack hub (#7).
      return (
        <div className={inPanel ? "absolute inset-0" : "fixed inset-0 z-50"}>
          <ScorecardSheet title={scorecardTitle} subtitle={courseName ?? undefined} onClose={back}>{scorecardGrid}</ScorecardSheet>
        </div>
      );
    }
    return (
      // As a panel: fill BELOW the app bar; standalone: full-screen.
      <div className={inPanel ? "absolute inset-0" : "fixed inset-0 z-50"}>
        <div className="flex flex-col" style={{ height: inPanel ? "100%" : "100vh" }}>
          <ScoreEntryView
            hideHeader={inPanel}
            gameName={groupName ?? "Group"}
            units={scUnits}
            participants={ps}
            values={Object.fromEntries(ps.map((p) => [p.id, mergedFor(p.id)]))}
            direction="low_wins"
            currentHole={currentHole}
            onHoleChange={setCurrentHole}
            onChange={onChange}
            onClear={onClear}
            saveStatus={saveStatus}
            onRetryCell={retryCell}
            onBack={back}
            onOpenGrid={() => setGridOpen(true)}
            onFinish={back}
            // "Finish" here is pure navigation back to the hub (onFinish={back}
            // above, no mutation) — the shared default subtext ("Saves results ·
            // shows final standings") describes stroke's games.finish-calling
            // Finish, not rack's. The real rack finalize is the hub's separate
            // "Lock the result" action.
            finishSubtext=""
            pips={groupPips}
          />
        </div>
        {/* Scorecard OVERLAY over entry — entry stays mounted (#543 intact). */}
        {gridOpen && <ScorecardSheet title={scorecardTitle} subtitle={courseName ?? undefined} onClose={back}>{scorecardGrid}</ScorecardSheet>}
      </div>
    );
  }

  // §B 2B.3 Configuration page — the post-Enable editing home, reached from the
  // play hub's top-right. Reused editors + the Enabled/Disabled control; Disable
  // keeps scores and stays here (not a hub reverse-transform).
  if (showConfig && gid && gameQ.data && canEdit) {
    const teamA: GroupBuilderTeam = { id: teamIds[0] ?? "A", name: teamMeta.A.name, color: teamMeta.A.color, players: teamRosters.A };
    const teamB: GroupBuilderTeam = { id: teamIds[1] ?? "B", name: teamMeta.B.name, color: teamMeta.B.color, players: teamRosters.B };
    const groupCount = configDraft.groups.filter((g) => g.length > 0).length;
    // Handicaps row reads the DRAFT strokes (not the server) so an unsaved stroke shows.
    const draftHandicapPlayers = handicapPlayers.map((p) => ({ ...p, strokes: configDraft.strokes[p.id] ?? 0 }));
    const anyHandicap = draftHandicapPlayers.some((p) => p.strokes > 0);
    // Settings order: GROUPINGS (leading, above Course/Points) → the shared Course +
    // "Points per Slot" spine → OPTIONS { Handicaps }. Draft-then-save (P2): every edit
    // stages into the composite draft; NO scoring-enabled lock (the lie sweep) — a scored
    // game's groupings change is refused SERVER-side (HAS_SCORES), not client-frozen.
    const groupingsRow = (
      <ChecklistRow
        icon={Users}
        title="Groupings"
        subtitle={draftGroupsAssigned ? `${groupCount} group${groupCount === 1 ? "" : "s"} · tap to edit the carts` : "No groups yet — add one to start"}
        state={draftGroupsAssigned ? "resolved" : "empty"}
        expanded={openAccordion === "groupings"}
        onToggle={toggleGroupings}
        testId="row-groupings"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Add a group per cart, then pick its players from either team — any mix of 1–4. Anyone left out sits this round out.
        </p>
        <RackGroupBuilder groups={configDraft.groups} onChange={setGroupsDraft} teamA={teamA} teamB={teamB} />
      </ChecklistRow>
    );
    // Game Modifiers — HIDDEN BY LOGIC, not omitted (Phase 2 gate). Rack's game type
    // declares `compatibleModifiers: []`, so `availableModifiers` is empty and the row is
    // never built — but the wiring is present and keyed on the game type, so a future
    // rack-compatible modifier would surface the row automatically (its inline editor is
    // Phase 3 work; the branch is unreachable today). This is the same gated shape stroke
    // uses, so the two can't drift.
    const availableModifiers = getGameTypeDefinition(gameTypeId)?.compatibleModifiers ?? [];
    // OPTIONS section (extraRows): Handicaps.
    const optionRows = (
      <ChecklistRow
        icon={SlidersHorizontal}
        title="Handicaps"
        subtitle={draftGroupsAssigned ? (anyHandicap ? "Strokes set — tap to adjust" : "Optional — set strokes per player") : "Set the groupings first"}
        state={anyHandicap ? "resolved" : "empty"}
        // Gated until a cart exists; opens INLINE (the same per-player strokes UI stroke
        // play uses). No scoring lock — strokes are the warned (in-place) tier.
        disabled={!draftGroupsAssigned}
        expanded={openAccordion === "handicaps" && draftGroupsAssigned}
        onToggle={draftGroupsAssigned ? toggleHandicaps : undefined}
        testId="row-handicaps"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Strokes come off gross on the hardest holes — a friendly guess, not an official handicap.
        </p>
        <HandicapList players={draftHandicapPlayers} holeCount={scUnits.length} strokeIndex={scIndex} onSetStrokes={onSetStrokes} raised />
      </ChecklistRow>
    );
    return (
      <>
        <GameConfigurationView
          onBack={closeConfig}
          tripId={tripId!}
          competitionId={competitionId ?? null}
          game={gameQ.data as unknown as GameRow}
          canEdit={canEdit}
          isOwner={isOwner}
          onChanged={() => void refreshGame()}
          onDeleted={() => router.push(competitionId ? `/trips/${tripId}/leaderboard` : `/trips/${tripId}`)}
          leadingSettingsRows={groupingsRow}
          extraRows={optionRows}
          // Hidden by logic: rack's `compatibleModifiers` is empty, so this is undefined
          // and no Modifiers row renders. Wired (not omitted) so the row would appear if
          // the game type ever declared a compatible modifier. onClick is unreachable today.
          modifiersRow={
            availableModifiers.length > 0 ? (
              <ModifiersRow count={0} onClick={() => {}} disabled={!canEdit} locked={false} />
            ) : undefined
          }
          // Total-points: the DRAFT slot count is the per-slot divisor; the roster-derived
          // default total seeds first-setup. Rack labels the derived readout "Points per Slot".
          matchCount={draftSlotCount}
          defaultPointsTotal={defaultTotal}
          pointsRowTitle="Points per Slot"
          // Draft-then-save controlled wiring:
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
          rackPoints={{ value: configDraft.pointsTotal, onChange: (total) => setPointsTotalDraft(total) }}
          // Gate the Setup→Scoring toggle on a drafted cart (mirrors the server enable guard).
          ready={draftGroupsAssigned}
          onEnable={handleEnable}
          onDisable={handleDisable}
          busy={saving}
          saveBar={
            <SettingsSaveBar
              dirty={dirty}
              saving={saving}
              justSaved={justSaved}
              error={saveError}
              onSave={() => void handleSaveConfig()}
              onCancel={handleCancelConfig}
            />
          }
        />
        {confirmingClose && (
          <DiscardChangesPrompt
            onDiscard={confirmDiscard}
            onKeepEditing={cancelClose}
            onSave={() => { cancelClose(); void handleSaveConfig(); }}
            saving={saving}
          />
        )}
      </>
    );
  }

  // No game yet, or a resumed game with no foursomes → setup. A member who taps
  // a not-ready game gets the warm game-led message (§8), never the setup form.
  if (!gid || needsSetup) {
    if (!canEdit) {
      return (
        <Shell hideHeader={inPanel} onBack={() => router.back()} title="Rack-n-Stack">
          <SetupPlaceholder tripId={tripId} game={gameQ.data as unknown as GameRow | undefined} />
        </Shell>
      );
    }
    return (
      <Shell hideHeader={inPanel} onBack={() => router.back()} title="Rack-n-Stack" subtitle="Net stroke play · team rack">
        <div className="w-full px-4 py-5">
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Course</label>
              <button type="button" onClick={() => setCoursePickerOpen(true)} className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm" style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}>
                <span style={{ color: pendingCourse ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}>{pendingCourse?.name ?? "Select a course (optional)"}</span>
              </button>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)" }}>
              {assignQ.data?.length ?? 0} players across {teamMeta.A.name} &amp; {teamMeta.B.name} — you&apos;ll build them into playing groups (carts) yourself, any mix of 1–4 per group.
            </p>
            {canEdit && (
              <button onClick={startRack} disabled={createGame.isPending || applyCourse.isPending} className="mt-2 w-full disabled:opacity-40" style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
                Set up playing groups
              </button>
            )}
          </div>
        </div>
        {coursePickerOpen && (
          <CoursePicker onClose={() => setCoursePickerOpen(false)} onApply={(c) => { setPendingCourse(c); setCoursePickerOpen(false); }} />
        )}
      </Shell>
    );
  }

  // A2-ux correction: the groups are set but scoring isn't enabled yet — the
  // scoreboard page is a PASS-THROUGH. A member sees just the placeholder; the
  // owner/delegate gets it + the way into the ONE settings page (front button +
  // corner gear). NO checklist / toggle here — those live on the settings page.
  // Complete/correcting games are already enabled (backfill) → fall through to play.
  if (!scoringEnabled) {
    return (
      <Shell
        hideHeader={inPanel}
        onBack={() => router.back()}
        title="Rack-n-Stack"
        right={
          canEdit ? (
            <button onClick={openConfig} aria-label="Settings" className="flex h-9 w-9 items-center justify-center" data-testid="game-settings-gear">
              <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
            </button>
          ) : undefined
        }
      >
        <SetupPlaceholder
          tripId={tripId}
          game={gameQ.data as unknown as GameRow | undefined}
          message={canEdit
            ? "Set the course, handicaps, and points on the settings page — the crew can’t see the game until you switch it to scoring."
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
      </Shell>
    );
  }

  // Play screen.
  const final = gameQ.data?.status === "complete";
  const allThru18 = rack.slots.length > 0 && rack.slots.every((s) => s.a.thru >= scUnits.length && s.b.thru >= scUnits.length);
  return (
    // Title-bar (back + name/status + gear) then the GamePageHeader below — the same
    // header pattern the match/stroke game pages use.
    <Shell
      hideHeader={inPanel}
      onBack={() => router.back()}
      title="Rack-n-Stack"
      subtitle={correcting ? "Net stroke play · correcting" : final ? "Net stroke play · final" : "Net stroke play · standings"}
      right={
        canEdit && !final ? (
          <button onClick={openConfig} aria-label="Settings" className="flex h-9 w-9 items-center justify-center" data-testid="game-settings-gear">
            <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        ) : undefined
      }
    >
      {/* Standard game header — row 1 (the collapsed cup hero, team names +
          cup totals) + row 2 (this game's projected/final per-team
          contribution), sticky over the scoreboard. Competition games only.
          The team standing comes ONLY from this hero now — the old RsDayScore
          team-totals band ("CENTURIONS 4 · matches won · MANHATTANS 2") was a
          redundant restatement of the hero + projection row, so it's gone. */}
      <GamePageHeader
        tripId={tripId}
        competitionId={competitionId}
        projection={
          teamIds.length >= 2
            ? {
                perTeam: { [teamIds[0]]: projectedPoints.A, [teamIds[1]]: projectedPoints.B },
                gameName: (gameQ.data?.name as string | undefined)?.trim() || "Rack-n-Stack",
                final,
              }
            : undefined
        }
      />
      <FoursomeEntry groups={groupViews} onEnter={(id) => { setEntryGroupId(id); setCurrentHole(currentHoleForGroup(id)); setGridOpen(false); }} />
      {/* #501 Part 3: the scoring board is read-and-score only — "Edit handicaps"
          (config) is gone. Edit handicaps in Setup mode (gear → Who's playing ·
          Handicaps), where mid-game config is deliberate. */}
      <RackBoard
        teamA={teamMeta.A}
        teamB={teamMeta.B}
        slots={rack.slots}
        sitOut={rack.sitOut}
        mode={mode}
        onMode={setMode}
        nameOf={(id) => nameOf.get(id) ?? "Player"}
        final={final}
      />
      {canEdit && !final && allThru18 && (
        <div className="px-4 pb-6">
          <button onClick={finish} disabled={finishGame.isPending} className="w-full disabled:opacity-40" style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 15, fontWeight: 600 }}>
            {finishGame.isPending ? "Locking…" : "Lock the result"}
          </button>
        </div>
      )}
      {/* #7: the deliberate, auditable correction path (owner/co-admin/delegate). */}
      {canEdit && locked && (
        <div className="px-4 pb-6">
          <button onClick={handleCorrect} disabled={openCorrection.isPending} className="w-full disabled:opacity-40" style={{ height: 48, borderRadius: 12, background: "transparent", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", fontSize: 14, fontWeight: 600 }}>
            {openCorrection.isPending ? "Opening…" : "Correct a score"}
          </button>
        </div>
      )}
      {canEdit && correcting && (
        <div className="px-4 pb-6">
          <button onClick={finish} disabled={finishGame.isPending} className="w-full disabled:opacity-40" style={{ height: 50, borderRadius: 12, background: "var(--color-bt-warning)", color: "#0d1f1a", fontSize: 15, fontWeight: 600 }}>
            {finishGame.isPending ? "Re-locking…" : "Re-lock result"}
          </button>
        </div>
      )}
    </Shell>
  );
}

// #550: as a panel the app bar carries back/title/gear, so the header is
// suppressed and the shell fills the panel height (no forced 100vh). Standalone
// route (no bar) keeps the header.
function Shell({ title, subtitle, onBack, right, children, hideHeader = false }: { title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode; children: React.ReactNode; hideHeader?: boolean }) {
  return (
    // min-height (not h-full): the scoreboard content isn't in its own scroll
    // container, so it must GROW and let the panel scroll (h-full capped it and
    // clipped the bottom rows). Fills the panel when short; grows when tall.
    <div className="flex flex-col" style={{ background: "var(--color-bt-base)", minHeight: hideHeader ? "100%" : "100vh" }}>
      {!hideHeader && (
        <header className="flex shrink-0 items-center justify-between" style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
          <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
            <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
          </button>
          <div className="min-w-0 text-center">
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>}
          </div>
          <div className="flex h-9 min-w-9 items-center justify-end pr-1">{right}</div>
        </header>
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text-dim)" }}>
      {children}
    </div>
  );
}
