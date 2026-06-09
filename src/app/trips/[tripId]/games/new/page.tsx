"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { FinalStandings } from "@/components/games/FinalStandings";
import type { StrokeStanding } from "@/lib/strokePlay";
import { STROKE_PLAY_UNITS, PLAYER_COLORS, initialsOf } from "@/lib/strokePlayConfig";
import type { Participant, ScoreValues } from "@/components/games/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STROKE_PLAY = "gtt_stroke_play";

/**
 * Minimal "new stroke-play game" flow (Slice A, Task 6 create step). TEMPORARY —
 * the real Games tab is Slice E. Pick 2–4 crew → create game + participants →
 * land in the hole-by-hole entry view. Finish/Final + review grid are Task 7.
 */
export default function NewGamePage() {
  const { tripId: param } = useParams<{ tripId: string }>();
  const router = useRouter();

  const isId = UUID_RE.test(param);
  const resolved = trpc.trips.resolveSlug.useQuery(
    { slugOrId: param },
    { enabled: !isId, retry: false }
  );
  const tripId = isId ? param : resolved.data?.id;

  const crew = trpc.tripMembers.list.useQuery({ tripId: tripId! }, { enabled: !!tripId });

  const [selected, setSelected] = useState<string[]>([]);
  const [game, setGame] = useState<{ id: string; participants: Participant[] } | null>(null);
  const [values, setValues] = useState<ScoreValues>({});
  const [view, setView] = useState<"entry" | "grid" | "final">("entry");
  const [currentHole, setCurrentHole] = useState(1);
  const [standings, setStandings] = useState<StrokeStanding[]>([]);

  const createGame = trpc.games.create.useMutation();
  const addParticipants = trpc.games.addParticipants.useMutation();
  const upsertEntry = trpc.scores.upsertEntry.useMutation();
  const deleteEntry = trpc.scores.deleteEntry.useMutation();
  const finishGame = trpc.games.finish.useMutation();

  const memberById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const c of crew.data ?? []) m.set(c.user_id, { id: c.user_id, name: c.displayName ?? c.user?.name ?? "Player" });
    return m;
  }, [crew.data]);

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
    const g = await createGame.mutateAsync({ tripId, gameTypeId: STROKE_PLAY });
    await addParticipants.mutateAsync({ tripId, gameId: g.id, userIds: selected });
    const participants: Participant[] = selected.map((uid, i) => {
      const m = memberById.get(uid);
      const name = m?.name ?? "Player";
      return { id: uid, name, initials: initialsOf(name), color: PLAYER_COLORS[i % PLAYER_COLORS.length] };
    });
    setGame({ id: g.id, participants });
  }

  function handleChange(participantId: string, unitLabel: string, value: number) {
    if (!tripId || !game) return;
    const prev = values;
    setValues((v) => ({
      ...v,
      [participantId]: { ...(v[participantId] ?? {}), [unitLabel]: value },
    }));
    upsertEntry.mutate(
      { tripId, gameId: game.id, participantId, unitLabel, value },
      {
        onError: () => setValues(prev), // rollback
      }
    );
  }

  function handleClear(participantId: string, unitLabel: string) {
    if (!tripId || !game) return;
    const prev = values;
    setValues((v) => {
      const row = { ...(v[participantId] ?? {}) };
      delete row[unitLabel];
      return { ...v, [participantId]: row };
    });
    deleteEntry.mutate(
      { tripId, gameId: game.id, participantId, unitLabel },
      { onError: () => setValues(prev) }
    );
  }

  if (!tripId) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--color-bt-base)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  async function handleFinish() {
    if (!tripId || !game) return;
    const res = await finishGame.mutateAsync({ tripId, gameId: game.id });
    setStandings(res.standings);
    setView("final");
  }

  function playAgain() {
    setGame(null);
    setValues({});
    setStandings([]);
    setSelected([]);
    setCurrentHole(1);
    setView("entry");
  }

  // ── Play ──
  if (game) {
    return (
      <div className="fixed inset-0 z-50">
        {view === "final" ? (
          <FinalStandings
            participants={game.participants}
            standings={standings}
            unitCount={STROKE_PLAY_UNITS.length}
            dateLabel={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
          />
        ) : view === "grid" ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
              <button onClick={() => setView("entry")} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>Scorecard</span>
            </div>
            <div className="min-h-0 flex-1">
              <StandardGrid
                units={STROKE_PLAY_UNITS}
                participants={game.participants}
                values={values}
                direction="low_wins"
                onCellTap={(label) => {
                  setCurrentHole(Number(label) || 1);
                  setView("entry");
                }}
              />
            </div>
          </div>
        ) : (
          <ScoreEntryView
            gameName="Stroke Play"
            units={STROKE_PLAY_UNITS}
            participants={game.participants}
            values={values}
            direction="low_wins"
            currentHole={currentHole}
            onHoleChange={setCurrentHole}
            onChange={handleChange}
            onClear={handleClear}
            onBack={() => router.push(`/trips/${param}`)}
            onOpenGrid={() => setView("grid")}
            onFinish={handleFinish}
          />
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
