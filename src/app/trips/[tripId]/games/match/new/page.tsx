"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Flag, Lock, GripVertical, Plus, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MatchEntryView, type MatchGroupData } from "@/components/games/MatchEntryView";
import { MatchCard } from "@/components/games/MatchCard";
import { StandardGrid } from "@/components/games/StandardGrid";
import { RelHandicapControl } from "@/components/games/RelHandicapControl";
import { Avatar } from "@/components/Avatar";
import { TimePicker } from "@/components/TimePicker";
import { parseTime, toTime24 } from "@/lib/time";
import { buildDecided, matchState, strokeHoles, type HoleResult } from "@/lib/matchPlay";
import { STROKE_PLAY_UNITS, PLAYER_COLORS, initialsOf } from "@/lib/strokePlayConfig";
import type { Participant, ScoreValues } from "@/components/games/types";

/** "07:40" → "7:40 AM". Empty/invalid → "". */
function formatTee(t: string | null | undefined): string {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_PLAY = "gtt_match_play_singles";

type SideRef = { type: "user"; id: string } | null;
interface DraftMatch {
  matchNumber: number;
  a: SideRef;
  b: SideRef;
  handicap: number; // signed: <0 → a gets |n|, >0 → b gets n, 0 → even
}
type Screen = "new" | "member-wait" | "setup" | "overview" | "score";

/**
 * Singles match-play game flow (Slice B). TEMPORARY route — the real Games tab
 * is Slice E. Walks the full lifecycle (create → pairings → handicap → activate
 * → score → finish), role-gated, persisting each step via the `matches` router.
 * Resume an existing game with `?game=<id>`.
 */
export default function NewMatchGamePage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();
  const search = useSearchParams();

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery({ slugOrId: param }, { enabled: !isId, retry: false });
  const tripId = isId ? param : resolved.data?.id;

  const { canEdit, loading: roleLoading } = useTripRole(tripId);
  const me = useCurrentUser();
  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { enabled: !!tripId });

  const [gameId, setGameId] = useState<string | null>(search.get("game"));
  const [manualScreen, setManualScreen] = useState<Screen | null>(null);

  // New-game form
  const [matchCount, setMatchCount] = useState(2);
  const [teeTime, setTeeTime] = useState(""); // "HH:MM" 24h
  // Setup editing state
  const [draft, setDraft] = useState<DraftMatch[]>([]);
  const [selector, setSelector] = useState<{ matchIdx: number; slot: "a" | "b" } | null>(null);
  // Back-stack: forward transitions push the screen they left; Back pops to it.
  // Empty stack means we arrived directly (derived screen) → leave to trip home.
  const [navStack, setNavStack] = useState<Screen[]>([]);
  // Scoring
  const [values, setValues] = useState<ScoreValues>({});
  const [view, setView] = useState<"entry" | "grid">("entry");
  const [currentHole, setCurrentHole] = useState(1);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });
  const matchesQ = trpc.matches.listByGame.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });
  const scoresQ = trpc.scores.listByGame.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });

  const createGame = trpc.games.create.useMutation();
  const setPairings = trpc.matches.setPairings.useMutation();
  const setHandicap = trpc.matches.setHandicap.useMutation();
  const activate = trpc.matches.activate.useMutation();
  const upsertEntry = trpc.scores.upsertEntry.useMutation();
  const deleteEntry = trpc.scores.deleteEntry.useMutation();
  const finishGame = trpc.games.finish.useMutation();

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of crew.data ?? []) m.set(c.user_id, c.displayName ?? c.user?.name ?? "Player");
    return m;
  }, [crew.data]);

  const avatarIconOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of crew.data ?? []) m.set(c.user_id, c.user?.avatar_icon ?? null);
    return m;
  }, [crew.data]);

  // Loaded scores (for live match status on the matchup page + scoring resume).
  const loadedValues = useMemo(() => {
    const v: ScoreValues = {};
    for (const e of scoresQ.data ?? []) {
      if (e.value == null) continue;
      (v[e.participant_id] ??= {})[e.unit_label] = e.value;
    }
    return v;
  }, [scoresQ.data]);

  // Max singles matches = floor(players ÷ 2): the standalone pool is
  // undifferentiated, so any two of the crew pair up (Slice B). In a 2-team
  // competition the cap becomes min(teamA, teamB) since matches cross the team
  // line — generally min team size across teams — which is Slice D's concern.
  const crewCount = crew.data?.length ?? 0;
  const maxMatches = Math.max(1, Math.floor(crewCount / 2));

  const status = gameQ.data?.status as string | undefined;
  const published = matchesQ.data?.published ?? false;
  const serverMatches = useMemo(() => matchesQ.data?.matches ?? [], [matchesQ.data]);
  const serverParticipants = useMemo(() => matchesQ.data?.participants ?? [], [matchesQ.data]);

  // Stable color per user across the game.
  const colorOf = useMemo(() => {
    const ids = new Set<string>();
    for (const mm of serverMatches) {
      const a = mm.side_a as SideRef;
      const b = mm.side_b as SideRef;
      if (a?.id) ids.add(a.id);
      if (b?.id) ids.add(b.id);
    }
    const map = new Map<string, string>();
    [...ids].forEach((id, i) => map.set(id, PLAYER_COLORS[i % PLAYER_COLORS.length]));
    return map;
  }, [serverMatches]);

  const handicapOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of serverParticipants) m.set(p.user_id as string, (p.handicap_strokes as number | null) ?? 0);
    return m;
  }, [serverParticipants]);

  function participant(id: string, fallbackColor?: string): Participant {
    const name = nameOf.get(id) ?? "Player";
    return {
      id,
      name,
      initials: initialsOf(name),
      color: colorOf.get(id) ?? fallbackColor ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(id) ?? null,
    };
  }

  // Persisted scores overlaid with this session's local edits (local wins), so
  // the overview strips reflect scores entered before this load AND just now,
  // without waiting on a refetch.
  const mergedFor = (pid: string) => ({ ...(loadedValues[pid] ?? {}), ...(values[pid] ?? {}) });

  // Decided holes (A's perspective) for an overview strip — the shared builder.
  const decidedFor = (g: MatchGroupData) =>
    buildDecided(mergedFor(g.a.id), mergedFor(g.b.id), g.strokesA, g.strokesB);

  // A match's current hole = the first hole either player hasn't scored yet, so
  // opening a match drops you where it's at (not the hole you left from).
  const currentHoleFor = (g: MatchGroupData) => {
    const va = mergedFor(g.a.id);
    const vb = mergedFor(g.b.id);
    for (let h = 1; h <= STROKE_PLAY_UNITS.length; h++) {
      if (va[String(h)] == null || vb[String(h)] == null) return h;
    }
    return STROKE_PLAY_UNITS.length;
  };

  // Derive the screen from server state; manual transitions take precedence.
  // Active/complete → the flat overview; pending → setup (owner) or wait (member).
  const derived: Screen = !gameId
    ? "new"
    : status === "complete" || status === "active"
      ? "overview"
      : !canEdit
        ? "member-wait"
        : "setup";
  const screen = manualScreen ?? derived;

  // Forward step: remember the screen we're leaving so Back can return to it.
  const go = (next: Screen) => {
    setNavStack((s) => [...s, screen]);
    setManualScreen(next);
  };
  // Back step: pop to the previous workflow screen, or leave to the trip home
  // when there's nothing to pop (we arrived directly at a derived screen).
  const goBack = () => {
    if (navStack.length === 0) {
      router.push(`/trips/${param}`);
      return;
    }
    setManualScreen(navStack[navStack.length - 1]);
    setNavStack((s) => s.slice(0, -1));
  };

  // Seed the editable draft from the server when we land on setup for an
  // existing game (e.g. owner opens a pending game, or taps Edit) and the local
  // draft is empty. Create + Edit also seed via their handlers; this covers a
  // direct/derived landing.
  useEffect(() => {
    if (screen === "setup" && draft.length === 0 && serverMatches.length > 0) {
      setDraft(serverDraftFrom(serverMatches, handicapOf));
    }
  }, [screen, draft.length, serverMatches, handicapOf]);

  // ── Actions ──────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!tripId) return;
    const g = await createGame.mutateAsync({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Singles Match Play",
      teeTime: teeTime || null,
    });
    setGameId(g.id);
    const count = Math.min(Math.max(1, matchCount), maxMatches);
    setDraft(Array.from({ length: count }, (_, i) => ({ matchNumber: i + 1, a: null, b: null, handicap: 0 })));
    go("setup");
  }

  function startSetup() {
    // Seed the draft from server (or blank cards).
    if (serverMatches.length > 0) {
      setDraft(
        serverMatches.map((mm, i) => {
          const a = mm.side_a as SideRef;
          const b = mm.side_b as SideRef;
          const hcA = a?.id ? (handicapOf.get(a.id) ?? 0) : 0;
          const hcB = b?.id ? (handicapOf.get(b.id) ?? 0) : 0;
          return {
            matchNumber: (mm.match_number as number) ?? i + 1,
            a,
            b,
            handicap: hcA > 0 ? -hcA : hcB > 0 ? hcB : 0,
          };
        })
      );
    } else if (draft.length === 0) {
      setDraft(Array.from({ length: matchCount }, (_, i) => ({ matchNumber: i + 1, a: null, b: null, handicap: 0 })));
    }
    go("setup");
  }

  // Ready to tee off — one action: persist the pairings + handicaps, publish
  // (activate) so members can see them, and land on the overview. No separate
  // Save-then-Activate, no confirmation screen.
  async function readyToTeeOff() {
    if (!tripId || !gameId) return;
    const saved = await setPairings.mutateAsync({
      tripId,
      gameId,
      matches: draft.map((d, i) => ({ sideA: d.a, sideB: d.b, matchNumber: i + 1 })),
    });
    // Persist handicaps (one side n, other 0) for fully-paired matches and
    // activate — all in parallel: they each only depend on the just-saved
    // pairings, touch different rows, and there are no scores yet (no recompute
    // contention). Avoids a chain of sequential round-trips.
    const handicapWrites = draft.flatMap((d, i) => {
      const row = saved[i] as { id: string } | undefined;
      if (!row || !d.a?.id || !d.b?.id || d.handicap === 0) return [];
      const recipientUserId = d.handicap < 0 ? d.a.id : d.b.id;
      return [setHandicap.mutateAsync({ tripId, gameId, matchId: row.id, recipientUserId, strokes: Math.abs(d.handicap) })];
    });
    await Promise.all([...handicapWrites, activate.mutateAsync({ tripId, gameId })]);
    await Promise.all([gameQ.refetch(), matchesQ.refetch(), scoresQ.refetch()]);
    go("overview");
  }

  function handleChange(participantId: string, unitLabel: string, value: number) {
    if (!tripId || !gameId) return;
    const prev = values;
    setValues((v) => ({ ...v, [participantId]: { ...(v[participantId] ?? {}), [unitLabel]: value } }));
    upsertEntry.mutate({ tripId, gameId, participantId, unitLabel, value }, { onError: () => setValues(prev) });
  }
  function handleClear(participantId: string, unitLabel: string) {
    if (!tripId || !gameId) return;
    const prev = values;
    setValues((v) => {
      const row = { ...(v[participantId] ?? {}) };
      delete row[unitLabel];
      return { ...v, [participantId]: row };
    });
    deleteEntry.mutate({ tripId, gameId, participantId, unitLabel }, { onError: () => setValues(prev) });
  }
  async function handleFinish() {
    if (!tripId || !gameId) return;
    await finishGame.mutateAsync({ tripId, gameId });
    await Promise.all([gameQ.refetch(), matchesQ.refetch(), scoresQ.refetch()]);
    go("overview");
  }

  // Scoreable groups (fully-paired matches) for the entry view + grid.
  const groups: MatchGroupData[] = useMemo(
    () =>
      serverMatches
        .filter((mm) => (mm.side_a as SideRef)?.id && (mm.side_b as SideRef)?.id)
        .map((mm, i) => {
          const a = mm.side_a as { id: string };
          const b = mm.side_b as { id: string };
          return {
            matchId: mm.id as string,
            label: `Match ${(mm.match_number as number) ?? i + 1}`,
            a: participant(a.id),
            b: participant(b.id),
            strokesA: handicapOf.get(a.id) ?? 0,
            strokesB: handicapOf.get(b.id) ?? 0,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverMatches, handicapOf, colorOf, nameOf]
  );
  // One match at a time: the strip tapped on the overview (falls back to the
  // first). Single-match entry — no shared keypad across matches.
  const selectedGroup = useMemo(
    () => groups.find((g) => g.matchId === selectedMatchId) ?? groups[0] ?? null,
    [groups, selectedMatchId]
  );
  const entryParticipants = selectedGroup ? [selectedGroup.a, selectedGroup.b] : [];
  const entryPips = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    if (selectedGroup) {
      m[selectedGroup.a.id] = new Set([...strokeHoles(selectedGroup.strokesA)].map(String));
      m[selectedGroup.b.id] = new Set([...strokeHoles(selectedGroup.strokesB)].map(String));
    }
    return m;
  }, [selectedGroup]);

  // ── Loading ──
  if (!tripId || roleLoading || (gameId && (gameQ.isLoading || matchesQ.isLoading))) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // ── Single-match scoring (one match at a time) ──
  if (screen === "score" && selectedGroup) {
    return (
      <div className="fixed inset-0 z-50">
        {view === "grid" ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
              <button onClick={() => setView("entry")} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>Scorecard</span>
            </div>
            <div className="min-h-0 flex-1">
              <StandardGrid
                units={STROKE_PLAY_UNITS}
                participants={entryParticipants}
                values={values}
                direction="low_wins"
                pips={entryPips}
                onCellTap={(label) => {
                  setCurrentHole(Number(label) || 1);
                  setView("entry");
                }}
              />
            </div>
          </div>
        ) : (
          <MatchEntryView
            gameName={`${selectedGroup.a.name} v ${selectedGroup.b.name}`}
            subtitle="Singles match · 1v1"
            units={STROKE_PLAY_UNITS}
            matches={[selectedGroup]}
            values={values}
            currentHole={currentHole}
            onHoleChange={setCurrentHole}
            onChange={handleChange}
            onClear={handleClear}
            onBack={goBack}
            onOpenGrid={() => setView("grid")}
            onFinish={goBack}
            finishLabel="Back to matches"
            finishSubtext="Scores save as you enter"
            meId={me?.id}
          />
        )}
      </div>
    );
  }

  // ── Shell for the setup screens ──
  const headerTitle = screen === "new" ? "New game" : screen === "setup" ? "Set Pairings" : "Matches";
  return (
    <div className="flex flex-col" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
      <SetupHeader
        title={headerTitle}
        subtitle="Singles · 1v1 Match Play"
        onBack={goBack}
        right={
          screen === "overview" && canEdit && status !== "complete" ? (
            <button onClick={startSetup} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>
              Edit
            </button>
          ) : null
        }
      />

      <div className="w-full px-4 py-5">
      {screen === "new" && (
        <NewGame
          matchCount={matchCount}
          setMatchCount={setMatchCount}
          maxMatches={maxMatches}
          crewCount={crewCount}
          teeTime={teeTime}
          setTeeTime={setTeeTime}
          onCreate={handleCreate}
          pending={createGame.isPending}
          canEdit={canEdit}
        />
      )}

      {screen === "member-wait" && <MemberWait />}

      {screen === "setup" && (
        <MatchSetup
          tripId={tripId}
          draft={draft}
          setDraft={setDraft}
          nameOf={nameOf}
          colorOf={colorOf}
          avatarIconOf={avatarIconOf}
          openSelector={(matchIdx, slot) => setSelector({ matchIdx, slot })}
          onReady={readyToTeeOff}
          saving={setPairings.isPending || setHandicap.isPending || activate.isPending}
        />
      )}

      {screen === "overview" && (
        <Overview
          groups={groups}
          myId={me?.id}
          published={published}
          complete={status === "complete"}
          teeLabel={formatTee(gameQ.data?.tee_time as string | null | undefined)}
          canEdit={canEdit}
          decidedFor={decidedFor}
          onFinish={handleFinish}
          finishing={finishGame.isPending}
          onOpenMatch={(matchId) => {
            const g = groups.find((x) => x.matchId === matchId);
            if (g) setCurrentHole(currentHoleFor(g));
            setSelectedMatchId(matchId);
            setValues((v) => (Object.keys(v).length ? v : loadedValues));
            go("score");
          }}
        />
      )}
      </div>

      {/* Player selector sheet */}
      {selector && (
        <PlayerSelector
          matchIdx={selector.matchIdx}
          slot={selector.slot}
          draft={draft}
          crew={(crew.data ?? []).map((c) => c.user_id)}
          nameOf={nameOf}
          avatarIconOf={avatarIconOf}
          onPick={(userId) => {
            setDraft((prev) => assignInDraft(prev, selector.matchIdx, selector.slot, userId));
            setSelector(null);
          }}
          onClose={() => setSelector(null)}
        />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function serverDraftFrom(serverMatches: unknown[], handicapOf: Map<string, number>): DraftMatch[] {
  return (serverMatches as { match_number: number; side_a: SideRef; side_b: SideRef }[]).map((mm, i) => {
    const hcA = mm.side_a?.id ? (handicapOf.get(mm.side_a.id) ?? 0) : 0;
    const hcB = mm.side_b?.id ? (handicapOf.get(mm.side_b.id) ?? 0) : 0;
    return { matchNumber: mm.match_number ?? i + 1, a: mm.side_a, b: mm.side_b, handicap: hcA > 0 ? -hcA : hcB > 0 ? hcB : 0 };
  });
}

// Assign userId to (matchIdx, slot); if already in another slot, MOVE them and
// clear the vacated match's handicap (the relationship it described is gone).
function assignInDraft(prev: DraftMatch[], matchIdx: number, slot: "a" | "b", userId: string): DraftMatch[] {
  const next = prev.map((d) => ({ ...d }));
  next.forEach((d, i) => {
    if (i === matchIdx) return;
    if (d.a?.id === userId) {
      d.a = null;
      d.handicap = 0;
    }
    if (d.b?.id === userId) {
      d.b = null;
      d.handicap = 0;
    }
  });
  const target = next[matchIdx];
  target[slot] = { type: "user", id: userId };
  return next;
}

/**
 * Setup-flow title bar — matches the entry app bar (Quick Game / score views):
 * back arrow only (top-left), centered title (white) + subtitle, optional
 * top-right slot (the overview's Edit link).
 */
function SetupHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header
      className="flex shrink-0 items-center justify-between"
      style={{
        height: 52,
        padding: "0 8px",
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
        <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
      </button>
      <div className="min-w-0 text-center">
        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
      </div>
      <div className="flex h-9 min-w-9 items-center justify-end pr-1">{right}</div>
    </header>
  );
}

function NewGame({
  matchCount,
  setMatchCount,
  maxMatches,
  crewCount,
  teeTime,
  setTeeTime,
  onCreate,
  pending,
  canEdit,
}: {
  matchCount: number;
  setMatchCount: (n: number) => void;
  maxMatches: number;
  crewCount: number;
  teeTime: string;
  setTeeTime: (t: string) => void;
  onCreate: () => void;
  pending: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return <MemberWait />;
  // Clamp the displayed value to the crew-derived cap (state may still hold an
  // old value while the crew query resolves).
  const value = Math.min(Math.max(1, matchCount), maxMatches);
  return (
    <div>
      <div className="flex flex-col gap-3.5">
        {/* Course — stub picker (Slice C); same field style as the tee time. */}
        <div>
          <FieldLabel>Course</FieldLabel>
          <button type="button" className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm" style={pillStyle}>
            <span style={{ color: "var(--color-bt-text-dim)" }}>Select a course</span>
            <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </div>

        <TimePicker
          label="First tee time"
          presets="tee"
          value={parseTime(teeTime)}
          onChange={(v) => setTeeTime(toTime24(v))}
        />

        {/* Matches — count stepper. */}
        <div>
          <FieldLabel>Matches to add</FieldLabel>
          <div className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5" style={pillStyle}>
            <span style={{ fontSize: 14, color: "var(--color-bt-text)" }}>
              {value} {value === 1 ? "match" : "matches"}
            </span>
            <div className="flex items-center gap-2">
              <Stepper dir="dec" disabled={value <= 1} onClick={() => setMatchCount(Math.max(1, value - 1))} />
              <Stepper dir="inc" disabled={value >= maxMatches} onClick={() => setMatchCount(Math.min(maxMatches, value + 1))} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 6, paddingLeft: 2 }}>
            {crewCount} in the crew · up to {maxMatches} singles match{maxMatches === 1 ? "" : "es"}
          </p>
        </div>
      </div>

      <PrimaryButton label="Create game" onClick={onCreate} disabled={pending} />
    </div>
  );
}

function MemberWait() {
  return (
    <div className="flex flex-col items-center text-center" style={{ paddingTop: 80 }}>
      <div className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--color-bt-card-raised)", marginBottom: 16 }}>
        <Lock size={24} style={{ color: "var(--color-bt-text-dim)" }} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>Pairings haven&apos;t been announced yet</div>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 6, maxWidth: 260 }}>
        Your organizer is still setting the matchups. You&apos;ll see them here once they&apos;re announced.
      </p>
    </div>
  );
}

function MatchSetup({
  draft,
  setDraft,
  nameOf,
  colorOf,
  avatarIconOf,
  openSelector,
  onReady,
  saving,
}: {
  tripId: string;
  draft: DraftMatch[];
  setDraft: (fn: (prev: DraftMatch[]) => DraftMatch[]) => void;
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  avatarIconOf: Map<string, string | null>;
  openSelector: (matchIdx: number, slot: "a" | "b") => void;
  onReady: () => void;
  saving: boolean;
}) {
  // Drag-to-reorder (mirrors the news composer): `ins` is the insertion slot in
  // the original array (0..length). The accent line shows only once the cursor
  // crosses a neighbour's midpoint, and never on the dragged card's own two
  // adjacent slots (a no-op). Drag is armed only while the grip is held so the
  // slots/stepper inside the card stay tappable.
  const [dragState, setDragState] = useState<{ from: number; ins: number | null } | null>(null);
  const [armedIdx, setArmedIdx] = useState<number | null>(null);

  const reorderTo = (from: number, ins: number) =>
    setDraft((prev) => {
      if (from < 0 || from >= prev.length) return prev;
      if (ins === from || ins === from + 1) return prev; // own slot — no-op
      const copy = prev.slice();
      const [moved] = copy.splice(from, 1);
      const target = Math.max(0, Math.min(copy.length, ins > from ? ins - 1 : ins));
      copy.splice(target, 0, moved);
      return copy;
    });

  const onCardDragOver = (i: number, clientY: number, rect: DOMRect) =>
    setDragState((s) => {
      if (!s) return s;
      const isTop = clientY < rect.top + rect.height / 2;
      let ins: number | null = isTop ? i : i + 1;
      if (ins === s.from || ins === s.from + 1) ins = null; // adjacent = no-op, hide line
      return s.ins === ins ? s : { ...s, ins };
    });

  function partFor(ref: SideRef): Participant | null {
    if (!ref?.id) return null;
    const name = nameOf.get(ref.id) ?? "Player";
    return {
      id: ref.id,
      name,
      initials: initialsOf(name),
      color: colorOf.get(ref.id) ?? PLAYER_COLORS[0],
      avatarIcon: avatarIconOf.get(ref.id) ?? null,
    };
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginBottom: 14 }}>
        Tap a slot to pick a player · drag to reorder.
      </p>

      <div className="flex flex-col gap-3">
        {draft.map((d, i) => {
          const a = partFor(d.a);
          const b = partFor(d.b);
          const both = a && b;
          const dragging = dragState?.from === i;
          const dropIndicator: "top" | "bottom" | null =
            dragState?.ins === i
              ? "top"
              : i === draft.length - 1 && dragState?.ins === draft.length
                ? "bottom"
                : null;
          return (
            <div
              key={i}
              draggable={armedIdx === i}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragState({ from: i, ins: null });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                onCardDragOver(i, e.clientY, e.currentTarget.getBoundingClientRect());
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragState && dragState.ins != null) reorderTo(dragState.from, dragState.ins);
                setDragState(null);
                setArmedIdx(null);
              }}
              onDragEnd={() => {
                setDragState(null);
                setArmedIdx(null);
              }}
              style={{ position: "relative", padding: "12px 12px 14px", borderRadius: 14, background: "var(--color-bt-card)", border: `1px solid ${dragging ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`, opacity: dragging ? 0.4 : 1 }}
            >
              {dropIndicator && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 2,
                    right: 2,
                    [dropIndicator === "top" ? "top" : "bottom"]: -8,
                    height: 2,
                    borderRadius: 2,
                    background: "var(--color-bt-accent)",
                    boxShadow: "0 0 0 2px var(--color-bt-accent-faint)",
                    pointerEvents: "none",
                  }}
                />
              )}
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>Match {i + 1}</span>
                <span
                  onMouseDown={() => setArmedIdx(i)}
                  onMouseUp={() => setArmedIdx(null)}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  className="flex cursor-grab items-center justify-center active:cursor-grabbing"
                  style={{ width: 24, height: 24, color: "var(--color-bt-text-dim)", touchAction: "none" }}
                >
                  <GripVertical size={16} />
                </span>
              </div>
              {/* Grid with minmax(0,1fr) columns → the two slots are always
                  equal width regardless of name length, vs stays centered. */}
              <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 8 }}>
                <Slot player={a} onTap={() => openSelector(i, "a")} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
                <Slot player={b} onTap={() => openSelector(i, "b")} />
              </div>
              {both && (
                <div style={{ marginTop: 12 }}>
                  <RelHandicapControl
                    a={a}
                    b={b}
                    value={d.handicap}
                    onChange={(v) => setDraft((prev) => prev.map((x, j) => (j === i ? { ...x, handicap: v } : x)))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PrimaryButton
        label={saving ? "Setting up…" : "Ready to tee off"}
        onClick={onReady}
        disabled={saving || draft.length === 0 || !draft.every((d) => d.a?.id && d.b?.id)}
      />
    </div>
  );
}

/**
 * Overview — the flat list of tappable match strips (the post-setup home for a
 * match-play game). Banner + Edit (owner) + N strips, one per 1v1. Tapping a
 * strip opens single-match entry. When every match is decided, the owner can
 * finish the round.
 */
function Overview({
  groups,
  myId,
  published,
  complete,
  teeLabel,
  canEdit,
  decidedFor,
  onFinish,
  finishing,
  onOpenMatch,
}: {
  groups: MatchGroupData[];
  myId: string | undefined;
  published: boolean;
  complete: boolean;
  teeLabel: string;
  canEdit: boolean;
  decidedFor: (g: MatchGroupData) => HoleResult[];
  onFinish: () => void;
  finishing: boolean;
  onOpenMatch: (matchId: string) => void;
}) {
  if (!published) return <MemberWait />;
  const decideds = groups.map(decidedFor);
  const allOver = groups.length > 0 && decideds.every((d) => matchState(d).over);
  const underway = decideds.some((d) => d.length > 0);
  return (
    <div>
      {/* Pre-round banner — disappears once the first match starts. Edit lives in
          the title bar; round-complete keeps its banner. */}
      {(complete || !underway) && (
        <div className="flex items-center gap-2" style={{ padding: "10px 14px", borderRadius: 12, background: "var(--color-bt-place-1-bg)", border: "1px solid rgba(34,197,94,0.25)", marginBottom: 10 }}>
          <Flag size={15} style={{ color: "var(--color-bt-place-1-text)", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-place-1-text)" }}>
            {complete ? "Round complete" : `Matchups are set${teeLabel ? ` · tees off ${teeLabel}` : ""}`}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {groups.map((g, i) => (
          <MatchCard
            key={g.matchId}
            a={g.a}
            b={g.b}
            results={decideds[i]}
            label={`Match ${i + 1}`}
            youId={myId}
            onClick={() => onOpenMatch(g.matchId)}
          />
        ))}
      </div>

      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", margin: "12px 0 0 2px" }}>
        {underway ? "Tap a match to keep scoring." : "Tap a match to enter scores — the round starts on your first score."}
      </p>

      {canEdit && !complete && allOver && (
        <button onClick={onFinish} disabled={finishing} className="mt-5 w-full disabled:opacity-40" style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
          Finish round
        </button>
      )}
    </div>
  );
}

function PlayerSelector({
  matchIdx,
  slot,
  draft,
  crew,
  nameOf,
  avatarIconOf,
  onPick,
  onClose,
}: {
  matchIdx: number;
  slot: "a" | "b";
  draft: DraftMatch[];
  crew: string[];
  nameOf: Map<string, string>;
  avatarIconOf: Map<string, string | null>;
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  // Map user → the match label they currently occupy (if any).
  const inMatch = new Map<string, number>();
  draft.forEach((d, i) => {
    if (d.a?.id) inMatch.set(d.a.id, i);
    if (d.b?.id) inMatch.set(d.b.id, i);
  });
  const available = crew.filter((id) => !inMatch.has(id));
  const taken = crew.filter((id) => inMatch.has(id));

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full" style={{ background: "var(--color-bt-card-float)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px 28px", maxHeight: "75vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>Match {matchIdx + 1} · Player {slot === "a" ? 1 : 2}</div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 14 }}>Available</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {available.length === 0 && <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Everyone&apos;s assigned.</span>}
          {available.map((id) => (
            <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} avatarIcon={avatarIconOf.get(id) ?? null} onClick={() => onPick(id)} />
          ))}
        </div>
        {taken.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 16 }}>Already in a match</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {taken.map((id) => (
                <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} avatarIcon={avatarIconOf.get(id) ?? null} sub={`Match ${(inMatch.get(id) ?? 0) + 1}`} dim onClick={() => onPick(id)} />
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
              Choosing someone already in a match moves them here and clears that match&apos;s handicap.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Small shared bits ──

// Card-raised pill — matches the TimePicker trigger (Course / Matches fields).
const pillStyle: React.CSSProperties = {
  background: "var(--color-bt-card-raised)",
  borderColor: "var(--color-bt-border)",
};

// Field label above a control — same style as the TimePicker's label.
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      {children}
    </label>
  );
}

function Stepper({ dir, disabled, onClick }: { dir: "inc" | "dec"; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center justify-center disabled:opacity-30" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}>
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}

function Slot({ player, onTap }: { player: Participant | null; onTap: () => void }) {
  if (!player) {
    // The plus + label live together inside one dashed pill (card-raised so it
    // reads as a fillable block). Always "+ Add player".
    return (
      <button
        onClick={onTap}
        className="flex items-center justify-center gap-1.5"
        style={{ width: "100%", minWidth: 0, height: 44, borderRadius: 10, background: "var(--color-bt-card-raised)", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
      >
        <Plus size={15} />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Add player</span>
      </button>
    );
  }
  // Filled block — lighter card-raised pill so the player stands out on the card.
  // Avatar is always left of the name (we never put it after the name).
  return (
    <button
      onClick={onTap}
      className="flex items-center gap-2"
      style={{ width: "100%", minWidth: 0, height: 44, padding: "0 10px", borderRadius: 10, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
    >
      <Avatar name={player.name} avatarIcon={player.avatarIcon} sizePx={30} />
      <span style={{ minWidth: 0, fontSize: 15, fontWeight: 500, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{player.name}</span>
    </button>
  );
}

function SelectorRow({ name, avatarIcon, sub, dim, onClick }: { name: string; avatarIcon?: string | null; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 text-left" style={{ padding: "9px 12px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: dim ? 0.55 : 1 }}>
      <span className="flex min-w-0 items-center gap-2.5">
        <Avatar name={name} avatarIcon={avatarIcon} sizePx={30} />
        <span style={{ fontSize: 15, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      </span>
      {sub && <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)", flexShrink: 0 }}>{sub}</span>}
    </button>
  );
}

function PrimaryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="mt-6 w-full disabled:opacity-40" style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
      {label}
    </button>
  );
}
