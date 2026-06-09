"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Flag, Lock, Check, GripVertical, Plus, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MatchEntryView, type MatchGroupData } from "@/components/games/MatchEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { RelHandicapControl } from "@/components/games/RelHandicapControl";
import { strokeHoles } from "@/lib/matchPlay";
import { STROKE_PLAY_UNITS, PLAYER_COLORS, initialsOf } from "@/lib/strokePlayConfig";
import type { Participant, ScoreValues } from "@/components/games/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_PLAY = "gtt_match_play_singles";

type SideRef = { type: "user"; id: string } | null;
interface DraftMatch {
  matchNumber: number;
  a: SideRef;
  b: SideRef;
  handicap: number; // signed: <0 → a gets |n|, >0 → b gets n, 0 → even
}
type Screen = "new" | "prepair" | "member-wait" | "setup" | "ready" | "activated" | "score";

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

  const gameQ = trpc.games.getById.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });
  const matchesQ = trpc.matches.listByGame.useQuery({ tripId: tripId!, gameId: gameId! }, { enabled: !!tripId && !!gameId });

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
    return { id, name, initials: initialsOf(name), color: colorOf.get(id) ?? fallbackColor ?? PLAYER_COLORS[0] };
  }

  // Derive the screen from server state; manual transitions take precedence.
  const derived: Screen = !gameId
    ? "new"
    : status === "complete"
      ? "score"
      : status === "active"
        ? "activated"
        : !canEdit
          ? "member-wait"
          : serverMatches.length === 0
            ? "prepair"
            : "ready";
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

  // ── Actions ──────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!tripId) return;
    const g = await createGame.mutateAsync({ tripId, gameTypeId: MATCH_PLAY, name: "Singles Match Play" });
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

  async function saveMatchups() {
    if (!tripId || !gameId) return;
    const saved = await setPairings.mutateAsync({
      tripId,
      gameId,
      matches: draft.map((d, i) => ({ sideA: d.a, sideB: d.b, matchNumber: i + 1 })),
    });
    // Persist handicaps (one side n, other 0) for fully-paired matches.
    for (let i = 0; i < draft.length; i++) {
      const d = draft[i];
      const row = saved[i] as { id: string } | undefined;
      if (!row || !d.a?.id || !d.b?.id || d.handicap === 0) continue;
      const recipientUserId = d.handicap < 0 ? d.a.id : d.b.id;
      await setHandicap.mutateAsync({ tripId, gameId, matchId: row.id, recipientUserId, strokes: Math.abs(d.handicap) });
    }
    await matchesQ.refetch();
    go("ready");
  }

  async function handleActivate() {
    if (!tripId || !gameId) return;
    await activate.mutateAsync({ tripId, gameId });
    await Promise.all([gameQ.refetch(), matchesQ.refetch()]);
    go("activated");
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
    await Promise.all([gameQ.refetch(), matchesQ.refetch()]);
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
  const scoringParticipants = useMemo(() => groups.flatMap((g) => [g.a, g.b]), [groups]);
  const pips = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const g of groups) {
      m[g.a.id] = new Set([...strokeHoles(g.strokesA)].map(String));
      m[g.b.id] = new Set([...strokeHoles(g.strokesB)].map(String));
    }
    return m;
  }, [groups]);

  // ── Loading ──
  if (!tripId || roleLoading || (gameId && (gameQ.isLoading || matchesQ.isLoading))) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // ── Scoring (active/complete) ──
  if (screen === "score") {
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
                participants={scoringParticipants}
                values={values}
                direction="low_wins"
                pips={pips}
                onCellTap={(label) => {
                  setCurrentHole(Number(label) || 1);
                  setView("entry");
                }}
              />
            </div>
          </div>
        ) : (
          <MatchEntryView
            gameName="Singles Match Play"
            units={STROKE_PLAY_UNITS}
            matches={groups}
            values={values}
            currentHole={currentHole}
            onHoleChange={setCurrentHole}
            onChange={handleChange}
            onClear={handleClear}
            onBack={goBack}
            onOpenGrid={() => setView("grid")}
            onFinish={handleFinish}
          />
        )}
      </div>
    );
  }

  // ── Shell for the setup screens ──
  return (
    <div className="mx-auto max-w-md px-4 py-5" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
      <button onClick={goBack} className="flex items-center gap-1" style={{ color: "var(--color-bt-text-dim)", fontSize: 14, marginBottom: 14 }}>
        <ChevronLeft size={18} /> Back
      </button>

      {screen === "new" && (
        <NewGame
          matchCount={matchCount}
          setMatchCount={setMatchCount}
          maxMatches={maxMatches}
          crewCount={crewCount}
          onCreate={handleCreate}
          pending={createGame.isPending}
          canEdit={canEdit}
        />
      )}

      {screen === "member-wait" && <MemberWait />}

      {screen === "prepair" && <PrePairings count={serverMatches.length || matchCount} onSet={startSetup} />}

      {screen === "setup" && (
        <MatchSetup
          tripId={tripId}
          draft={draft}
          setDraft={setDraft}
          nameOf={nameOf}
          colorOf={colorOf}
          crew={(crew.data ?? []).map((c) => c.user_id)}
          openSelector={(matchIdx, slot) => setSelector({ matchIdx, slot })}
          onSave={saveMatchups}
          saving={setPairings.isPending || setHandicap.isPending}
        />
      )}

      {screen === "ready" && (
        <ReadyToCompete
          draft={draft.length ? draft : serverDraftFrom(serverMatches, handicapOf)}
          nameOf={nameOf}
          onEdit={startSetup}
          onActivate={handleActivate}
          activating={activate.isPending}
        />
      )}

      {screen === "activated" && (
        <ActivatedMember
          groups={groups}
          myId={me?.id}
          published={published}
          onEnter={() => go("score")}
        />
      )}

      {/* Player selector sheet */}
      {selector && (
        <PlayerSelector
          matchIdx={selector.matchIdx}
          slot={selector.slot}
          draft={draft}
          crew={(crew.data ?? []).map((c) => c.user_id)}
          nameOf={nameOf}
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

function NewGame({
  matchCount,
  setMatchCount,
  maxMatches,
  crewCount,
  onCreate,
  pending,
  canEdit,
}: {
  matchCount: number;
  setMatchCount: (n: number) => void;
  maxMatches: number;
  crewCount: number;
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
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-bt-text)" }}>Singles match play</h1>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4 }}>1v1 · low net wins each match</p>

      <div className="mt-5 flex flex-col gap-2.5">
        <StubRow label="Course" value="Add a course" />
        <StubRow label="When" value="Add a time" />
        <div className="flex items-center justify-between" style={rowStyle}>
          <span style={{ fontSize: 15, color: "var(--color-bt-text)" }}>Matches</span>
          <div className="flex items-center gap-3">
            <Stepper dir="dec" disabled={value <= 1} onClick={() => setMatchCount(Math.max(1, value - 1))} />
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-bt-text)", minWidth: 18, textAlign: "center" }}>{value}</span>
            <Stepper dir="inc" disabled={value >= maxMatches} onClick={() => setMatchCount(Math.min(maxMatches, value + 1))} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)", padding: "0 2px" }}>
          {crewCount} in the crew · up to {maxMatches} singles match{maxMatches === 1 ? "" : "es"}
        </p>
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

function PrePairings({ count, onSet }: { count: number; onSet: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
        <div className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}>
          <Flag size={20} style={{ color: "var(--color-bt-accent)" }} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>Ready to set the pairings?</div>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{count} matches to fill</div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-center justify-between" style={{ ...rowStyle, padding: "14px" }}>
            <TbdChip />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
            <TbdChip />
          </div>
        ))}
      </div>
      <PrimaryButton label="Set pairings" onClick={onSet} />
    </div>
  );
}

function MatchSetup({
  draft,
  setDraft,
  nameOf,
  colorOf,
  openSelector,
  onSave,
  saving,
}: {
  tripId: string;
  draft: DraftMatch[];
  setDraft: (fn: (prev: DraftMatch[]) => DraftMatch[]) => void;
  nameOf: Map<string, string>;
  colorOf: Map<string, string>;
  crew: string[];
  openSelector: (matchIdx: number, slot: "a" | "b") => void;
  onSave: () => void;
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
    return { id: ref.id, name, initials: initialsOf(name), color: colorOf.get(ref.id) ?? PLAYER_COLORS[0] };
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-bt-text)" }}>Set the matchups</h1>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4 }}>Tap a slot to pick a player · drag to reorder.</p>

      <div className="mt-4 flex flex-col gap-3">
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
              <div className="flex items-center justify-between" style={{ gap: 8 }}>
                <Slot player={a} onTap={() => openSelector(i, "a")} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-bt-text-dim)", flexShrink: 0 }}>vs</span>
                <Slot player={b} onTap={() => openSelector(i, "b")} align="right" />
              </div>
              {both ? (
                <div style={{ marginTop: 12 }}>
                  <RelHandicapControl
                    a={a}
                    b={b}
                    value={d.handicap}
                    onChange={(v) => setDraft((prev) => prev.map((x, j) => (j === i ? { ...x, handicap: v } : x)))}
                  />
                </div>
              ) : (
                <div className="text-center" style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
                  Add both players to set a handicap
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PrimaryButton label="Save matchups" onClick={onSave} disabled={saving} />
    </div>
  );
}

function ReadyToCompete({
  draft,
  nameOf,
  onEdit,
  onActivate,
  activating,
}: {
  draft: DraftMatch[];
  nameOf: Map<string, string>;
  onEdit: () => void;
  onActivate: () => void;
  activating: boolean;
}) {
  const set = draft.filter((d) => d.a?.id && d.b?.id).length;
  return (
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
        <div className="flex items-center justify-center" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--color-bt-place-1-bg)", border: "1px solid rgba(34,197,94,0.25)" }}>
          <Check size={22} style={{ color: "var(--color-bt-place-1-text)" }} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>Ready to compete</div>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{set} matches set · activate to announce to the crew</div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {draft.map((d, i) => {
          const aName = d.a?.id ? (nameOf.get(d.a.id) ?? "TBD") : "TBD";
          const bName = d.b?.id ? (nameOf.get(d.b.id) ?? "TBD") : "TBD";
          const recipient = d.handicap < 0 ? aName : d.handicap > 0 ? bName : null;
          const holes = [...strokeHoles(Math.abs(d.handicap))].sort((x, y) => x - y);
          return (
            <div key={i} style={{ ...rowStyle, display: "block", padding: "12px 14px" }}>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>{aName} <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}>vs</span> {bName}</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>Match {i + 1}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 4 }}>
                {recipient ? `${recipient} gets ${Math.abs(d.handicap)} · holes ${holes.join(", ")}` : "Even match"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={onEdit} style={{ height: 50, padding: "0 18px", borderRadius: 12, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 15, fontWeight: 600 }}>
          Edit
        </button>
        <button onClick={onActivate} disabled={activating} className="flex-1 disabled:opacity-40" style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
          Activate round
        </button>
      </div>
    </div>
  );
}

function ActivatedMember({
  groups,
  myId,
  published,
  onEnter,
}: {
  groups: MatchGroupData[];
  myId: string | undefined;
  published: boolean;
  onEnter: () => void;
}) {
  if (!published) return <MemberWait />;
  return (
    <div>
      <div className="flex items-center gap-2" style={{ padding: "10px 14px", borderRadius: 12, background: "var(--color-bt-place-1-bg)", border: "1px solid rgba(34,197,94,0.25)", marginBottom: 8 }}>
        <Check size={16} style={{ color: "var(--color-bt-place-1-text)" }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-place-1-text)" }}>Matchups are set</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", margin: "0 0 14px 2px" }}>Tap a match to keep score.</p>

      <div className="flex flex-col gap-2.5">
        {groups.map((g) => {
          const mine = g.a.id === myId || g.b.id === myId;
          const recipient = g.strokesA > 0 ? g.a : g.strokesB > 0 ? g.b : null;
          const n = g.strokesA > 0 ? g.strokesA : g.strokesB;
          return (
            <button
              key={g.matchId}
              onClick={onEnter}
              className="flex w-full items-center justify-between gap-3 text-left transition-transform active:scale-[0.99]"
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: mine ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
                border: `1px solid ${mine ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
              }}
            >
              <div className="min-w-0">
                {mine && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--color-bt-accent)", marginBottom: 4 }}>YOUR MATCH</div>}
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>
                  {g.a.name} <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}>vs</span> {g.b.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 3 }}>
                  {recipient ? `${recipient.name} gets ${n}` : "Even match"}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerSelector({
  matchIdx,
  slot,
  draft,
  crew,
  nameOf,
  onPick,
  onClose,
}: {
  matchIdx: number;
  slot: "a" | "b";
  draft: DraftMatch[];
  crew: string[];
  nameOf: Map<string, string>;
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
            <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} onClick={() => onPick(id)} />
          ))}
        </div>
        {taken.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-bt-text-dim)", marginTop: 16 }}>Already in a match</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {taken.map((id) => (
                <SelectorRow key={id} name={nameOf.get(id) ?? "Player"} sub={`Match ${(inMatch.get(id) ?? 0) + 1}`} dim onClick={() => onPick(id)} />
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

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "14px",
  borderRadius: 12,
  background: "var(--color-bt-card)",
  border: "1px solid var(--color-bt-border)",
};

function StubRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between" style={rowStyle}>
      <span style={{ fontSize: 15, color: "var(--color-bt-text)" }}>{label}</span>
      <span style={{ fontSize: 14, color: "var(--color-bt-text-dim)" }}>{value} ›</span>
    </div>
  );
}

function Stepper({ dir, disabled, onClick }: { dir: "inc" | "dec"; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center justify-center disabled:opacity-30" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}>
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}

function TbdChip() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)", fontSize: 10, fontWeight: 700 }}>?</span>
      <span style={{ fontSize: 14, color: "var(--color-bt-text-dim)" }}>TBD</span>
    </span>
  );
}

function Slot({ player, onTap, align }: { player: Participant | null; onTap: () => void; align?: "right" }) {
  if (!player) {
    return (
      <button onClick={onTap} className="flex min-w-0 flex-1 items-center gap-2" style={{ flexDirection: align === "right" ? "row-reverse" : "row" }}>
        <span className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text-dim)", flexShrink: 0 }}>
          <Plus size={15} />
        </span>
        <span style={{ fontSize: 14, color: "var(--color-bt-text-dim)" }}>Add player</span>
      </button>
    );
  }
  return (
    <button onClick={onTap} className="flex min-w-0 flex-1 items-center gap-2" style={{ flexDirection: align === "right" ? "row-reverse" : "row" }}>
      <span className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: "50%", background: `${player.color}22`, border: `1.5px solid ${player.color}55`, color: player.color, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
        {player.initials}
      </span>
      <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{player.name}</span>
    </button>
  );
}

function SelectorRow({ name, sub, dim, onClick }: { name: string; sub?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between text-left" style={{ padding: "11px 12px", borderRadius: 10, background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: dim ? 0.55 : 1 }}>
      <span style={{ fontSize: 15, color: "var(--color-bt-text)" }}>{name}</span>
      {sub && <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>{sub}</span>}
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
