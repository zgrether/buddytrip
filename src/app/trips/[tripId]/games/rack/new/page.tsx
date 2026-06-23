"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { TimePicker } from "@/components/TimePicker";
import { parseTime, toTime24 } from "@/lib/time";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { MemberNotReady } from "@/components/games/MemberNotReady";
import { EnableScoringGate } from "@/components/games/EnableScoringGate";
import { GameSetupRows } from "@/components/games/GameSetupRows";
import { GameConfigurationView } from "@/components/games/GameConfigurationView";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import { RsDayScore, RackBoard, type RackTeam } from "@/components/games/rack/RackBoard";
import { FoursomeEntry, type FoursomeGroupView } from "@/components/games/rack/FoursomeEntry";
import { HandicapRoster, type HandicapPlayer } from "@/components/games/HandicapRoster";
import { playerStats, computeRack, type RackPlayer, type RackMode } from "@/lib/rackNStack";
import { strokeHoles } from "@/lib/matchPlay";
import { unitsFromSchema, strokeIndexOf, teeFromSchema } from "@/lib/strokePlayConfig";
import { effectiveStrokes } from "@/lib/handicap";
import type { Participant, ScoreValues } from "@/components/games/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RACK = "gtt_rack_n_stack";

/** "07:40" → "7:40" (no AM/PM); "" / invalid → null. */
function teeLabel(t: string | null | undefined): string | null {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}
/** Add minutes to "HH:MM" 24h (wraps within a day). */
function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(":").map(Number);
  const total = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Chunk into groups of `size`, interleaving the two teams so groups are mixed. */
function autoFoursomes(teamA: string[], teamB: string[], size = 4): string[][] {
  const woven: string[] = [];
  for (let i = 0; i < Math.max(teamA.length, teamB.length); i++) {
    if (teamA[i]) woven.push(teamA[i]);
    if (teamB[i]) woven.push(teamB[i]);
  }
  const out: string[][] = [];
  for (let i = 0; i < woven.length; i += size) out.push(woven.slice(i, i + size));
  return out;
}

export default function RackNStackPage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery({ slugOrId: param }, { ...STRUCTURE_QUERY, enabled: !isId, retry: false });
  const tripId = isId ? param : resolved.data?.id;

  const { canEdit: tripCanEdit, loading: roleLoading } = useTripRole(tripId);
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
  const [mode, setMode] = useState<RackMode>("current");
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [pendingCourse, setPendingCourse] = useState<{ id: string; name: string } | null>(null);
  const [firstTee, setFirstTee] = useState(""); // "HH:MM" 24h; groups stagger +10
  const [entryGroupId, setEntryGroupId] = useState<string | null>(null);
  const [showHandicaps, setShowHandicaps] = useState(false);
  const [showConfig, setShowConfig] = useState(false); // §B 2B.3 Configuration page
  const [currentHole, setCurrentHole] = useState(1);
  const [values, setValues] = useState<ScoreValues>({});

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { ...STRUCTURE_QUERY, enabled: !!tripId });
  const competitionId = competition.data?.id as string | undefined;
  const teamsQ = trpc.teams.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId });
  const assignQ = trpc.teamAssignments.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId });

  // game config + foursomes are STRUCTURE (kept); only the raw scores stay short
  // (STATE) so a reopen is instant while the scores re-fetch.
  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  const groupsQ = trpc.playGroups.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  const scoresQ = trpc.scores.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { enabled: !!tripId && !!gid });
  // Per-game delegate (§10): this game's delegate runs it like an editor (the
  // server's requireGameEdit admits them); trip staff keep edit everywhere.
  const orgQ = trpc.games.listOrganizers.useQuery({ tripId: tripId!, gameId: gid! }, { ...STRUCTURE_QUERY, enabled: !!tripId && !!gid });
  const amDelegate = useMemo(
    () => !!me && (orgQ.data as { user_id: string }[] | undefined ?? []).some((o) => o.user_id === me.id),
    [orgQ.data, me]
  );
  const canEdit = tripCanEdit || amDelegate;

  const createGame = trpc.games.create.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const setFoursomes = trpc.playGroups.setFoursomes.useMutation();
  // Phase 2B.1: scoring must be enabled before entries land (universal gate).
  const enableScoring = trpc.games.enableScoring.useMutation();
  const disableScoring = trpc.games.disableScoring.useMutation();
  const setStrokes = trpc.playGroups.setParticipantStrokes.useMutation();
  const upsertEntry = trpc.scores.upsertEntry.useMutation();
  const deleteEntry = trpc.scores.deleteEntry.useMutation();
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

  // The two competing teams (sorted by id → A/B, matching the server).
  const teamIds = useMemo(() => {
    const ids = [...new Set((assignQ.data ?? []).map((a) => a.team_id as string))].sort();
    return ids;
  }, [assignQ.data]);
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
  const mergedFor = (pid: string) => ({ ...(loadedValues[pid] ?? {}), ...(values[pid] ?? {}) });

  // ── Rack read-model (the spec's novelty) ─────────────────────────────
  const participants = useMemo(() => groupsQ.data?.participants ?? [], [groupsQ.data]);
  const handicapOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of participants) m.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
    return m;
  }, [participants]);

  const rack = useMemo(() => {
    const players: RackPlayer[] = [];
    for (const p of participants) {
      const uid = p.user_id as string;
      const team = teamOf.get(uid);
      if (!team) continue;
      players.push({ id: uid, team, stats: playerStats(mergedFor(uid), handicapOf.get(uid) ?? 0, scUnits.map((u) => u.par ?? 0), scIndex) });
    }
    return computeRack(players, mode, coursePar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, teamOf, handicapOf, scUnits, scIndex, coursePar, mode, loadedValues, values]);

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
      participants.map((p) => {
        const id = p.user_id as string;
        return {
          id,
          name: nameOf.get(id) ?? "Player",
          avatarIcon: avatarOf.get(id) ?? null,
          teamColor: teamOf.get(id) ? colorForUser(id) : null,
          strokes: handicapOf.get(id) ?? 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participants, nameOf, avatarOf, teamOf, teamMeta, handicapOf]
  );

  // ── Handlers ─────────────────────────────────────────────────────────
  // Seed the rack's structure from the competition roster. Two entry points,
  // ONE path: a brand-new game (no gid → create it first), or an existing
  // competition game tapped from the leaderboard that has no foursomes yet
  // (gid set, groups empty → seed onto it, don't mint a new game).
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
    const aIds = [...teamOf.entries()].filter(([, t]) => t === "A").map(([id]) => id);
    const bIds = [...teamOf.entries()].filter(([, t]) => t === "B").map(([id]) => id);
    const groups = autoFoursomes(aIds, bIds).map((userIds, i) => ({
      name: `Group ${i + 1}`,
      userIds,
      teeTime: firstTee ? addMinutes(firstTee, i * 10) : null,
    }));
    await setFoursomes.mutateAsync({ tripId, gameId, groups });
    await utils.playGroups.listByGame.invalidate({ tripId, gameId });
    setGameId(gameId);
    setShowHandicaps(true); // Pairings ✓ → Handicaps step
  }

  const onSetStrokes = (userId: string, strokes: number) =>
    setStrokes
      .mutateAsync({ tripId: tripId!, gameId: gid!, userId, strokes })
      .then(() => utils.playGroups.listByGame.invalidate({ tripId: tripId!, gameId: gid! }));

  const handleChange = (pid: string, unit: string, value: number) => {
    setValues((v) => ({ ...v, [pid]: { ...(v[pid] ?? {}), [unit]: value } }));
    if (!tripId || !gid) return;
    upsertEntry.mutate(
      { tripId, gameId: gid, participantId: pid, unitLabel: unit, value },
      { onSettled: () => utils.scores.listByGame.invalidate({ tripId, gameId: gid }) }
    );
  };
  const handleClear = (pid: string, unit: string) => {
    setValues((v) => {
      const next = { ...(v[pid] ?? {}) };
      delete next[unit];
      return { ...v, [pid]: next };
    });
    if (!tripId || !gid) return;
    deleteEntry.mutate(
      { tripId, gameId: gid, participantId: pid, unitLabel: unit },
      { onSettled: () => utils.scores.listByGame.invalidate({ tripId, gameId: gid }) }
    );
  };

  async function finish() {
    if (!tripId || !gid) return;
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

  // A resumed competition game (gid set from ?game=) may have NO foursomes yet
  // (created as a bare games row by add-game). Route it to the setup step instead
  // of the empty play screen — startRack seeds onto the existing game.
  const needsSetup = !!gid && groupsQ.isSuccess && (groupsQ.data?.groups?.length ?? 0) === 0;
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
      setShowConfig(false); // re-Enable from Configuration → back to score entry
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
  // gid set but groups still loading → wait, don't flash an empty play screen.
  if (gid && groupsQ.isLoading) {
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
    // Locked (posted) → the read-only scorecard grid (#7); otherwise the
    // editable entry. Correcting re-opens editing (locked=false).
    if (locked) {
      return (
        <div className="flex flex-col" style={{ height: "100vh" }}>
          <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
            <button onClick={() => setEntryGroupId(null)} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{(groupName ?? "Group")} · Final</span>
          </div>
          <div className="min-h-0 flex-1">
            <StandardGrid
              units={scUnits}
              tee={teeFromSchema(gameQ.data?.scorecard_schema as Parameters<typeof teeFromSchema>[0])}
              participants={ps}
              values={Object.fromEntries(ps.map((p) => [p.id, mergedFor(p.id)]))}
              direction="low_wins"
              pips={groupPips}
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
          onChange={handleChange}
          onClear={handleClear}
          onBack={() => setEntryGroupId(null)}
          onFinish={() => setEntryGroupId(null)}
          pips={groupPips}
        />
      </div>
    );
  }

  // §B 2B.3 Configuration page — the post-Enable editing home, reached from the
  // play hub's top-right. Reused editors + the Enabled/Disabled control; Disable
  // keeps scores and stays here (not a hub reverse-transform).
  if (showConfig && gid && gameQ.data && canEdit) {
    return (
      <GameConfigurationView
        subtitle="Net stroke play · team rack"
        onBack={() => setShowConfig(false)}
        tripId={tripId!}
        competitionId={competitionId ?? null}
        game={gameQ.data as unknown as GameRow}
        canEdit={canEdit}
        onChanged={() => void refreshGame()}
        whosPlayingLabel={`${groupsQ.data?.groups?.length ?? 0} group${(groupsQ.data?.groups?.length ?? 0) === 1 ? "" : "s"} · auto-grouped · strokes`}
        onEditWhosPlaying={() => { setShowConfig(false); setShowHandicaps(true); }}
        scoringEnabled={scoringEnabled}
        onEnable={handleEnable}
        onDisable={handleDisable}
        busy={enableScoring.isPending || disableScoring.isPending}
      />
    );
  }

  // Handicaps setup step (after pairings; before play). Reached only via the
  // canEdit-gated start/edit affordances; the mutation is server-canEdit-gated.
  if (showHandicaps && gid) {
    return (
      <div className="flex flex-col" style={{ height: "100vh" }}>
        <HandicapRoster
          players={handicapPlayers}
          holeCount={scUnits.length}
          strokeIndex={scIndex}
          onSetStrokes={onSetStrokes}
          onDone={() => setShowHandicaps(false)}
          onBack={() => setShowHandicaps(false)}
        />
      </div>
    );
  }

  // No game yet, or a resumed game with no foursomes → setup. A member who taps
  // a not-ready game gets the warm game-led message (§8), never the setup form.
  if (!gid || needsSetup) {
    if (!canEdit) {
      return (
        <Shell onBack={() => router.back()} title="Rack-n-Stack">
          <MemberNotReady gameName={gameQ.data?.name as string | undefined} />
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
            <TimePicker label="First tee time" presets="tee" value={parseTime(firstTee)} onChange={(v) => setFirstTee(toTime24(v))} />
            <p style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)" }}>
              {assignQ.data?.length ?? 0} players across {teamMeta.A.name} &amp; {teamMeta.B.name} — they&apos;ll be auto-grouped into foursomes (tee times stagger by 10 min) you can regroup later.
            </p>
            {canEdit && (
              <button onClick={startRack} disabled={createGame.isPending || setFoursomes.isPending} className="mt-2 w-full disabled:opacity-40" style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
                Start the rack
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

  // Phase 2B.1 Enable gate: the groups are set but scoring isn't enabled yet.
  // The owner enables here (the score saver server-rejects entries until then);
  // a member sees the warm not-ready message. Complete/correcting games are
  // already enabled (backfill), so they fall through to the play screen.
  if (!scoringEnabled) {
    if (!canEdit) {
      return (
        <Shell onBack={() => router.back()} title="Rack-n-Stack">
          <MemberNotReady gameName={gameQ.data?.name as string | undefined} />
        </Shell>
      );
    }
    return (
      <EnableScoringGate
        title="Rack-n-Stack"
        subtitle={`${groupsQ.data?.groups?.length ?? 0} group${(groupsQ.data?.groups?.length ?? 0) === 1 ? "" : "s"} · net stroke play`}
        onEnable={handleEnable}
        onBack={() => router.back()}
        pending={enableScoring.isPending}
        setupRows={
          gameQ.data ? (
            <GameSetupRows
              tripId={tripId!}
              competitionId={competitionId ?? null}
              game={gameQ.data as unknown as GameRow}
              canEdit={canEdit}
              onChanged={() => {
                void utils.games.getById.invalidate({ tripId: tripId!, gameId: gid! });
                if (competitionId) {
                  utils.competitions.leaderboard.invalidate({ tripId: tripId!, competitionId });
                  utils.competitions.faceBootstrap.invalidate({ tripId: tripId! });
                  utils.games.listByTrip.invalidate({ tripId: tripId! });
                }
              }}
            />
          ) : null
        }
      />
    );
  }

  // Play screen.
  const final = gameQ.data?.status === "complete";
  const allThru18 = rack.slots.length > 0 && rack.slots.every((s) => s.a.thru >= scUnits.length && s.b.thru >= scUnits.length);
  return (
    <Shell
      onBack={() => router.back()}
      title="Rack-n-Stack"
      subtitle={correcting ? "Net stroke play · correcting" : final ? "Net stroke play · final" : "Net stroke play · standings"}
      right={
        canEdit && !final ? (
          <button onClick={() => setShowConfig(true)} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>
            Configuration
          </button>
        ) : undefined
      }
    >
      <RsDayScore teamA={teamMeta.A} teamB={teamMeta.B} pointsA={rack.points.A} pointsB={rack.points.B} final={final} projected={mode === "projected"} />
      <FoursomeEntry groups={groupViews} onEnter={(id) => { setEntryGroupId(id); setCurrentHole(1); }} />
      {canEdit && !final && (
        <div className="px-3">
          <button onClick={() => setShowHandicaps(true)} style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-accent)" }}>
            Edit handicaps
          </button>
        </div>
      )}
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
