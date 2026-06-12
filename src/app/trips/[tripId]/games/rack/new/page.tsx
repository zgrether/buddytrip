"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { TimePicker } from "@/components/TimePicker";
import { parseTime, toTime24 } from "@/lib/time";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { RsDayScore, RackBoard, type RackTeam } from "@/components/games/rack/RackBoard";
import { FoursomeEntry, type FoursomeGroupView } from "@/components/games/rack/FoursomeEntry";
import { HandicapRoster, type HandicapPlayer } from "@/components/games/HandicapRoster";
import { playerStats, computeRack, type RackPlayer, type RackMode } from "@/lib/rackNStack";
import { unitsFromSchema, strokeIndexOf, initialsOf } from "@/lib/strokePlayConfig";
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
  const resolved = trpc.trips.resolveSlug.useQuery({ slugOrId: param }, { enabled: !isId, retry: false });
  const tripId = isId ? param : resolved.data?.id;

  const { canEdit, loading: roleLoading } = useTripRole(tripId);
  const me = useCurrentUser();
  const utils = trpc.useUtils();

  const [gameId, setGameId] = useState<string | null>(search.get("game"));
  // Resume the trip's latest in-progress rack game so returning here (no nav
  // entry yet) lands on the SAME game instead of starting a fresh one — which
  // would look like the handicaps/scores were lost.
  const gamesList = trpc.games.listByTrip.useQuery({ tripId: tripId! }, { enabled: !!tripId });
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
  const [currentHole, setCurrentHole] = useState(1);
  const [values, setValues] = useState<ScoreValues>({});

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { enabled: !!tripId });
  const competition = trpc.competitions.getByTrip.useQuery({ tripId: tripId! }, { enabled: !!tripId });
  const competitionId = competition.data?.id as string | undefined;
  const teamsQ = trpc.teams.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { enabled: !!tripId && !!competitionId });
  const assignQ = trpc.teamAssignments.list.useQuery({ tripId: tripId!, competitionId: competitionId! }, { enabled: !!tripId && !!competitionId });

  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gid! }, { enabled: !!tripId && !!gid });
  const groupsQ = trpc.playGroups.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { enabled: !!tripId && !!gid });
  const scoresQ = trpc.scores.listByGame.useQuery({ tripId: tripId!, gameId: gid! }, { enabled: !!tripId && !!gid });

  const createGame = trpc.games.create.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const setFoursomes = trpc.playGroups.setFoursomes.useMutation();
  const setStrokes = trpc.playGroups.setParticipantStrokes.useMutation();
  const upsertEntry = trpc.scores.upsertEntry.useMutation();
  const deleteEntry = trpc.scores.deleteEntry.useMutation();
  const finishGame = trpc.games.finish.useMutation();

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
  async function startRack() {
    if (!tripId || !competitionId) return;
    const g = await createGame.mutateAsync({ tripId, gameTypeId: RACK, name: "Rack-n-Stack", competitionId });
    if (pendingCourse) {
      try {
        await applyCourse.mutateAsync({ tripId, gameId: g.id, courseId: pendingCourse.id });
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
    await setFoursomes.mutateAsync({ tripId, gameId: g.id, groups });
    setGameId(g.id);
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
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (!tripId || roleLoading || crew.isLoading || competition.isLoading) {
    return <Center>Loading…</Center>;
  }

  if (!hasCompetition) {
    return (
      <Shell onBack={() => router.push(`/trips/${param}`)} title="Rack-n-Stack">
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
      return { id, name, initials: initialsOf(name), color: colorForUser(id), avatarIcon: avatarOf.get(id) ?? null };
    });
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
        />
      </div>
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

  // No game yet → setup.
  if (!gid) {
    return (
      <Shell onBack={() => router.push(`/trips/${param}`)} title="Rack-n-Stack" subtitle="Net stroke play · team rack">
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

  // Play screen.
  const final = gameQ.data?.status === "complete";
  const allThru18 = rack.slots.length > 0 && rack.slots.every((s) => s.a.thru >= scUnits.length && s.b.thru >= scUnits.length);
  return (
    <Shell onBack={() => router.push(`/trips/${param}`)} title="Rack-n-Stack" subtitle={final ? "Net stroke play · final" : "Net stroke play · standings"}>
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
            Lock the result
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ title, subtitle, onBack, children }: { title: string; subtitle?: string; onBack: () => void; children: React.ReactNode }) {
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
        <div className="h-9 w-9" />
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
