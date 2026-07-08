"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Users, Settings, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useGameEditAccess } from "@/hooks/useGameEditAccess";
import { useGameSettingsOverlay } from "@/hooks/useGameSettingsOverlay";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useScoreSaver } from "@/hooks/useScoreSaver";
import { showToast } from "@/lib/toast";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { RackGroupBuilder, type GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { toPersist as groupsToPersist } from "@/lib/rackGroupDraft";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { useScorecardTeeRows } from "@/hooks/useScorecardTeeRows";
import { SetupPlaceholder } from "@/components/games/SetupPlaceholder";
import { GameConfigurationView } from "@/components/games/GameConfigurationView";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { RackBoard, type RackTeam } from "@/components/games/rack/RackBoard";
import { GamePageHeader } from "@/components/competition/GamePageHeader";
import { FoursomeEntry, type FoursomeGroupView } from "@/components/games/rack/FoursomeEntry";
import { HandicapList, type HandicapPlayer } from "@/components/games/HandicapRoster";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { useScreenHistory } from "@/hooks/useScreenHistory";
import { playerStats, computeRack, type RackPlayer, type RackMode } from "@/lib/rackNStack";
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
  const [entryView, setEntryView] = useState<"entry" | "grid">("entry");
  // Rack settings: both GROUPINGS and HANDICAPS are inline accordions (the rack
  // equivalents of the 2v2 Matches/Handicaps rows), single-open. `groupDraft` = one
  // user-id array per group.
  const [openAccordion, setOpenAccordion] = useState<"groupings" | "handicaps" | null>(null);
  const [groupDraft, setGroupDraft] = useState<string[][]>([]);
  // Has the user actually edited the group draft this open? Only a TOUCHED draft is
  // persisted on leave — an untouched open (just seeded from the server) never
  // rewrites, so a seed race can't wipe the persisted groups.
  const groupingsTouched = useRef(false);
  // Every builder edit goes through this (marks touched, then updates) — raw
  // setGroupDraft is only for SEEDING (open / new game), which must not set touched.
  const editGroupDraft = (next: string[][]) => {
    groupingsTouched.current = true;
    setGroupDraft(next);
  };
  // The ONE settings overlay — owns open/close/back + the leaderboard deep link
  // (?settings=1 → land here directly for an owner/delegate of a setup-mode game).
  const { open: showConfig, openConfig, closeConfig } = useGameSettingsOverlay({
    canEdit,
    deepLink: search.get("settings") === "1",
  });
  const [currentHole, setCurrentHole] = useState(1);
  // Rack scores now go through the durable, confirmation-tracked saver (Spec 1a) —
  // same idempotent upsert + retry + outbox + per-cell status as stroke/match
  // (was a raw fire-and-forget mutate with no retry/status). Per-user entries, so
  // no participantType. `values` is seeded once from the server below.
  const { values, setValues, saveStatus, onChange, onClear, retryCell } = useScoreSaver(tripId, gid);

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competitionId = competition.data?.id as string | undefined;
  const teamsQ = trpc.teams.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId });
  const assignQ = trpc.teamAssignments.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId });

  // game config + foursomes are STRUCTURE (kept); only the raw scores stay short
  // (STATE) so a reopen is instant while the scores re-fetch.
  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  // Multi-tee scorecard yardage rows (Spec 5b) — reads the persisted course record(s).
  const teeRows = useScorecardTeeRows(tripId, gameQ.data);
  const groupsQ = trpc.playGroups.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  const scoresQ = trpc.scores.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { enabled: !!tripId && !!gid });

  const createGame = trpc.games.create.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const setFoursomes = trpc.playGroups.setFoursomes.useMutation();
  // Phase 2B.1: scoring must be enabled before entries land (universal gate).
  const enableScoring = trpc.games.enableScoring.useMutation();
  const disableScoring = trpc.games.disableScoring.useMutation();
  const setStrokes = trpc.playGroups.setParticipantStrokes.useMutation();
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
  // Seed the saver's values from the server ONCE on resume (mirrors stroke) — the
  // saver's `values` is then the single source (server seed + live edits), so a
  // clear removes from it cleanly and the outbox recovery re-populates it.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !gid || !scoresQ.data) return;
    setValues((v) => (Object.keys(v).length ? v : loadedValues));
    seededRef.current = true;
  }, [gid, scoresQ.data, loadedValues, setValues]);
  const mergedFor = (pid: string) => values[pid] ?? {};

  // ── Rack read-model (the spec's novelty) ─────────────────────────────
  const participants = useMemo(() => groupsQ.data?.participants ?? [], [groupsQ.data]);
  const handicapOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of participants) m.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
    return m;
  }, [participants]);

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
  // #533 projection (rack) — REUSE the existing rack projection ("if it ended now"
  // = computeRack in "projected" mode), NOT a rebuild. Map A/B → the two team ids.
  const projectedPoints = useMemo(() => computeRack(rackPlayers, "projected", coursePar).points, [rackPlayers, coursePar]);

  // Rack SLOT count = the number of rank-paired 1v1s = min(grouped-A, grouped-B),
  // mirroring computeRack's `n = min(A.length, B.length)`. Derived from the
  // GROUPED participants so it grows as the owner builds groups (a 2v2 group → 2
  // slots) — NOT gated on a full roster and NOT on scores existing (computeRack's
  // slots need thru>0, so it's 0 during setup). Feeds the settings "Total Points
  // Available" (points × slots) so it stops reading 0 (Task 3).
  const rackSlotCount = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const p of participants) {
      const t = teamOf.get(p.user_id as string);
      if (t === "A") a += 1;
      else if (t === "B") b += 1;
    }
    return Math.min(a, b);
  }, [participants, teamOf]);

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

  // ── Handlers ─────────────────────────────────────────────────────────
  // The current persisted groups as a builder draft (one user-id array per group,
  // in group order) — seeds the builder when editing an existing game's groups.
  const currentGroupDraft = (): string[][] => {
    const gs = groupsQ.data?.groups ?? [];
    return gs.map((grp) => participants.filter((p) => p.play_group_id === grp.id).map((p) => p.user_id as string));
  };

  // Start a rack: create the game (if new) + apply the course, then open the MANUAL
  // group builder. No auto-assignment — deliberate grouping is the point of this
  // round (see spec), so the owner builds the carts from an empty state.
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
    setGroupDraft([]); // start empty — the owner builds the groups
    groupingsTouched.current = false;
    // Land in the settings page with GROUPINGS expanded (the first Settings item).
    setOpenAccordion("groupings");
    openConfig();
  }

  // Persist the built groups. Empty groups (an unfinished "add group") are dropped;
  // the survivors renumber Group 1..N. Clean-replaces via setFoursomes, then
  // refreshes the board (incl. faceBootstrap, CLAUDE.md #10).
  async function saveGroups() {
    if (!tripId || !gid) return;
    await setFoursomes.mutateAsync({ tripId, gameId: gid, groups: groupsToPersist(groupDraft) });
    await utils.playGroups.listByGame.invalidate({ tripId, gameId: gid });
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }

  // Toggle the GROUPINGS accordion (the rack "Matches" builder). Opening seeds the
  // draft from what's persisted; collapsing persists it (persist-on-collapse, like
  // the 2v2 match builder), so building groups then collapsing the row saves them.
  function toggleGroupings() {
    if (openAccordion === "groupings") {
      setOpenAccordion(null);
      if (groupingsTouched.current) void saveGroups();
    } else {
      setGroupDraft(currentGroupDraft());
      groupingsTouched.current = false;
      setOpenAccordion("groupings");
    }
  }

  // Toggle the HANDICAPS accordion (inline per-player strokes). Single-open —
  // opening it collapses Groupings, persisting any in-progress group edits first.
  function toggleHandicaps() {
    if (openAccordion === "handicaps") {
      setOpenAccordion(null);
    } else {
      if (openAccordion === "groupings" && groupingsTouched.current) void saveGroups();
      setOpenAccordion("handicaps");
    }
  }

  // Persist the groupings whenever the settings overlay CLOSES by ANY path — the
  // config Back arrow, the OS/browser back (popstate, page stays mounted), or a
  // deep-link nav that unmounts the page. Without this, groups built in the
  // accordion but not explicitly collapsed were lost on leaving settings (the
  // Back-arrow onBack saved, but an OS back-gesture bypasses it). Mirrors the match
  // page's close-flush. Guarded on touched (+ !scoringEnabled) so an untouched
  // close never rewrites and a live game is never written.
  const flushGroupings = () => {
    if (scoringEnabled) return;
    if (openAccordion === "groupings" && groupingsTouched.current) void saveGroups();
  };
  const flushRef = useRef(flushGroupings);
  flushRef.current = flushGroupings;
  const prevShowConfig = useRef(showConfig);
  useEffect(() => {
    const wasOpen = prevShowConfig.current;
    prevShowConfig.current = showConfig;
    if (!wasOpen || showConfig) return; // only the true→false transition
    flushGroupings();
    if (openAccordion !== null) setOpenAccordion(null);
    // flushGroupings is a per-render closure; we react to the overlay-close
    // transition only, so it stays out of the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfig, openAccordion]);
  // Unmount flush — the deep-link/navigate-away teardown the transition effect
  // can't see (no committed showConfig=false render).
  useEffect(() => () => flushRef.current(), []);

  const onSetStrokes = (userId: string, strokes: number) =>
    setStrokes
      .mutateAsync({ tripId: tripId!, gameId: gid!, userId, strokes })
      .then(() => utils.playGroups.listByGame.invalidate({ tripId: tripId!, gameId: gid! }));

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
  const entryDepth = entryGroupId ? (!locked && entryView === "grid" ? 2 : 1) : 0;
  const back = useScreenHistory(entryDepth, () => {
    if (!locked && entryView === "grid") setEntryView("entry");
    else setEntryGroupId(null);
  });

  // A resumed competition game (gid set from ?game=) may have NO foursomes yet
  // (created as a bare games row by add-game). Route it to the setup step instead
  // of the empty play screen — startRack seeds onto the existing game.
  const needsSetup = !!gid && groupsQ.isSuccess && (groupsQ.data?.groups?.length ?? 0) === 0;
  // Task 2 readiness: rack can't switch to scoring until at least one playing group
  // exists (players assigned). Mirrors the server enable guard (grouped participants
  // > 0) so the client toggle and the server refuse agree.
  const groupsAssigned = (groupsQ.data?.groups?.length ?? 0) > 0;
  // Phase 2B.1: a rack with its groups set must be Enabled before the play screen
  // opens (the score saver server-rejects entries until then).
  const scoringEnabled = (gameQ.data as { scoring_enabled?: boolean } | undefined)?.scoring_enabled === true;
  async function refreshGame() {
    if (!tripId || !gid) return;
    await utils.games.getById.invalidate({ tripId, gameId: gid });
    if (competitionId) {
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
      utils.games.listByTrip.invalidate({ tripId });
    }
  }
  async function handleEnable() {
    if (!tripId || !gid) return;
    try {
      await enableScoring.mutateAsync({ tripId, gameId: gid });
      await refreshGame();
      // #512 correction: STAY on the settings page — the toggle flips in place. The
      // back arrow still returns to the game page via the openConfig history entry.
    } catch {
      // surfaced via the global error toast
    }
  }
  // §B 2B.3: Disable from Configuration — keep scores, STAY in Configuration.
  async function handleDisable() {
    if (!tripId || !gid) return;
    try {
      await disableScoring.mutateAsync({ tripId, gameId: gid });
      await refreshGame();
    } catch {
      // surfaced via the global error toast
    }
  }

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
      <Shell onBack={() => router.back()} title="Rack-n-Stack">
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
    if (readOnly || entryView === "grid") {
      return (
        <div className="flex flex-col" style={{ height: "100vh" }}>
          <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
            <button onClick={back} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{(groupName ?? "Group")}{locked ? " · Final" : " · Scorecard"}</span>
          </div>
          <div className="min-h-0 flex-1">
            <StandardGrid
              units={scUnits}
              tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
              teeRows={teeRows}
              participants={ps}
              values={Object.fromEntries(ps.map((p) => [p.id, mergedFor(p.id)]))}
              direction="low_wins"
              pips={groupPips}
              onCellTap={readOnly ? undefined : (label) => { setCurrentHole(Number(label) || 1); back(); }}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col" style={{ height: "100vh" }}>
        <ScoreEntryView
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
          onOpenGrid={() => setEntryView("grid")}
          onFinish={back}
          pips={groupPips}
        />
      </div>
    );
  }

  // §B 2B.3 Configuration page — the post-Enable editing home, reached from the
  // play hub's top-right. Reused editors + the Enabled/Disabled control; Disable
  // keeps scores and stays here (not a hub reverse-transform).
  if (showConfig && gid && gameQ.data && canEdit) {
    const teamA: GroupBuilderTeam = { id: teamIds[0] ?? "A", name: teamMeta.A.name, color: teamMeta.A.color, players: teamRosters.A };
    const teamB: GroupBuilderTeam = { id: teamIds[1] ?? "B", name: teamMeta.B.name, color: teamMeta.B.color, players: teamRosters.B };
    const groupCount = groupsQ.data?.groups?.length ?? 0;
    const anyHandicap = handicapPlayers.some((p) => p.strokes > 0);
    // Settings order (Task 4): GROUPINGS (leading, above Course/Points) → then the
    // shared Course + "Points per Slot" spine → then the OPTIONS section
    // { Handicaps, Game Modifiers } via extraRows. GROUPINGS is the rack "Matches"
    // builder; both accordions stay single-open.
    const groupingsRow = (
      <ChecklistRow
        icon={Users}
        title="Groupings"
        subtitle={groupsAssigned ? `${groupCount} group${groupCount === 1 ? "" : "s"} · tap to edit the carts` : "No groups yet — add one to start"}
        state={groupsAssigned ? "resolved" : "empty"}
        locked={scoringEnabled}
        expanded={openAccordion === "groupings" && !scoringEnabled}
        onToggle={!scoringEnabled ? toggleGroupings : undefined}
        testId="row-groupings"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Add a group per cart, then pick its players from either team — any mix of 1–4. Anyone left out sits this round out.
        </p>
        <RackGroupBuilder groups={groupDraft} onChange={editGroupDraft} teamA={teamA} teamB={teamB} />
      </ChecklistRow>
    );
    // OPTIONS section (extraRows): Handicaps. (Rack has no Game Modifiers — its
    // format offers none, so that row is correctly absent, like any modifier-less
    // format.)
    const optionRows = (
      <ChecklistRow
        icon={SlidersHorizontal}
        title="Handicaps"
        subtitle={groupsAssigned ? (anyHandicap ? "Strokes set — tap to adjust" : "Optional — set strokes per player") : "Set the groupings first"}
        state={anyHandicap ? "resolved" : "empty"}
        locked={scoringEnabled}
        // Gated until groups exist (the ChecklistRow "not available yet" dim); when
        // ready, it opens INLINE — the same per-player strokes UI stroke play uses.
        disabled={!groupsAssigned}
        expanded={openAccordion === "handicaps" && groupsAssigned && !scoringEnabled}
        onToggle={groupsAssigned && !scoringEnabled ? toggleHandicaps : undefined}
        testId="row-handicaps"
      >
        <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginBottom: 12 }}>
          Strokes come off gross on the hardest holes — a friendly guess, not an official handicap.
        </p>
        <HandicapList players={handicapPlayers} holeCount={scUnits.length} strokeIndex={scIndex} onSetStrokes={onSetStrokes} raised />
      </ChecklistRow>
    );
    return (
      <GameConfigurationView
        subtitle="Net stroke play · team rack"
        // The close-flush effect persists the groupings on ANY overlay close (incl.
        // OS back), so Back just closes — no inline save needed here.
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
        // Task 3: feed the slot count so "Total Points Available" (points × slots)
        // isn't stuck at 0. Task 4: rack labels the field "Points per Slot"
        // (display only — the per_match data model is unchanged).
        matchCount={rackSlotCount}
        pointsRowTitle="Points per Slot"
        scoringEnabled={scoringEnabled}
        // Task 2: gate the Setup→Scoring toggle on groups being assigned.
        ready={groupsAssigned}
        onEnable={handleEnable}
        onDisable={handleDisable}
        busy={enableScoring.isPending || disableScoring.isPending}
      />
    );
  }

  // No game yet, or a resumed game with no foursomes → setup. A member who taps
  // a not-ready game gets the warm game-led message (§8), never the setup form.
  if (!gid || needsSetup) {
    if (!canEdit) {
      return (
        <Shell onBack={() => router.back()} title="Rack-n-Stack">
          <SetupPlaceholder tripId={tripId} game={gameQ.data as unknown as GameRow | undefined} />
        </Shell>
      );
    }
    return (
      <Shell onBack={() => router.back()} title="Rack-n-Stack" subtitle="Net stroke play · team rack">
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
      <FoursomeEntry groups={groupViews} onEnter={(id) => { setEntryGroupId(id); setCurrentHole(1); setEntryView("entry"); }} />
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

function Shell({ title, subtitle, onBack, right, children }: { title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
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
