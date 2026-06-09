"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { computeStrokePlayStandings, type StrokeEntry, type StrokeStanding } from "@/lib/strokePlay";
import { STROKE_PLAY_UNITS, PLAYER_COLORS, initialsOf } from "@/lib/strokePlayConfig";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { FinalStandings } from "@/components/games/FinalStandings";
import type { Participant, ScoreValues } from "@/components/games/types";

const STORAGE_KEY = "bt-quick-game";

/**
 * Quick Game ⚡ (Slice A2) — a context-free stroke-play game.
 *
 * Reuses ScoreEntryView / StandardGrid / FinalStandings UNCHANGED — only the
 * persistence backend differs: the whole game state lives in **local storage**,
 * no DB row, no tRPC, no auth, free-text player names. Finish computes standings
 * client-side via the SAME shared `computeStrokePlayStandings`. This is exactly
 * what the persistence-agnostic split (CLAUDE.md pattern #7/#8) was built for.
 */
interface QuickGameState {
  players: Participant[];
  values: ScoreValues;
  finished: boolean;
}

function gridStandings(state: QuickGameState): StrokeStanding[] {
  const entries: StrokeEntry[] = [];
  for (const p of state.players)
    for (const u of STROKE_PLAY_UNITS) {
      const v = state.values[p.id]?.[u.label];
      if (v != null) entries.push({ participant_id: p.id, value: v });
    }
  return computeStrokePlayStandings(
    state.players.map((p) => p.id),
    entries
  );
}

export default function QuickGamePage() {
  const router = useRouter();
  const [state, setState] = useState<QuickGameState | null>(null);
  const [names, setNames] = useState<string[]>(["", ""]);
  const [view, setView] = useState<"entry" | "grid">("entry");
  const [currentHole, setCurrentHole] = useState(1);
  const loaded = useRef(false);

  // Resume any in-progress game from local storage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Load persisted state on mount. Must be in an effect (not a useState
      // initializer) so it stays client-only — localStorage is undefined during
      // SSR. The set-state-in-effect rule over-flags this legitimate case.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setState(JSON.parse(raw) as QuickGameState);
    } catch {
      /* ignore corrupt storage */
    }
    loaded.current = true;
  }, []);

  // Persist (after the initial load, so we don't clobber on mount).
  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [state]);

  function start() {
    const valid = names.map((n) => n.trim()).filter(Boolean).slice(0, 4);
    if (valid.length < 2) return;
    const players: Participant[] = valid.map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      initials: initialsOf(name),
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    }));
    setState({ players, values: {}, finished: false });
    setCurrentHole(1);
    setView("entry");
  }

  function onChange(pid: string, label: string, value: number) {
    setState((s) => (s ? { ...s, values: { ...s.values, [pid]: { ...(s.values[pid] ?? {}), [label]: value } } } : s));
  }
  function onClear(pid: string, label: string) {
    setState((s) => {
      if (!s) return s;
      const row = { ...(s.values[pid] ?? {}) };
      delete row[label];
      return { ...s, values: { ...s.values, [pid]: row } };
    });
  }
  function finish() {
    setState((s) => (s ? { ...s, finished: true } : s));
  }
  function playAgain() {
    setState(null);
    setNames(["", ""]);
    setView("entry");
    setCurrentHole(1);
  }
  function discard() {
    setState(null);
    router.push("/dashboard");
  }

  const gridHeader = (
    <div className="flex shrink-0 items-center gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
      <button onClick={() => setView("entry")} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>‹ Back</button>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>Scorecard</span>
    </div>
  );

  // ── Setup ──
  if (!state) {
    return (
      <div className="mx-auto max-w-md px-4 py-6" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
        <div className="flex items-center justify-between">
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>⚡ Quick Game</h1>
          <button onClick={() => router.push("/dashboard")} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4 }}>Stroke play · name 2–4 players.</p>

        <div className="mt-4 flex flex-col gap-2">
          {names.map((n, i) => (
            <input
              key={i}
              value={n}
              onChange={(e) => setNames((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Player ${i + 1}`}
              style={{ height: 46, borderRadius: 12, padding: "0 14px", background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 15 }}
            />
          ))}
        </div>

        {names.length < 4 && (
          <button
            onClick={() => setNames((n) => [...n, ""])}
            className="mt-2 flex items-center gap-1.5"
            style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px dashed var(--color-bt-accent)", color: "var(--color-bt-accent)", fontSize: 13, fontWeight: 600 }}
          >
            <Plus size={15} /> Add player
          </button>
        )}

        <button
          onClick={start}
          disabled={names.map((n) => n.trim()).filter(Boolean).length < 2}
          className="mt-5 w-full disabled:opacity-40"
          style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
        >
          Start game
        </button>
      </div>
    );
  }

  // ── Final ──
  if (state.finished) {
    if (view === "grid") {
      return (
        <div className="fixed inset-0 z-50 flex flex-col">
          {gridHeader}
          <div className="min-h-0 flex-1">
            <StandardGrid units={STROKE_PLAY_UNITS} participants={state.players} values={state.values} direction="low_wins" />
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-50">
        <FinalStandings
          participants={state.players}
          standings={gridStandings(state)}
          unitCount={STROKE_PLAY_UNITS.length}
          dateLabel={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          onScorecard={() => setView("grid")}
          onPlayAgain={playAgain}
          onDiscard={discard}
        />
      </div>
    );
  }

  // ── Playing ──
  return (
    <div className="fixed inset-0 z-50">
      {view === "grid" ? (
        <div className="flex h-full flex-col">
          {gridHeader}
          <div className="min-h-0 flex-1">
            <StandardGrid
              units={STROKE_PLAY_UNITS}
              participants={state.players}
              values={state.values}
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
          gameName="Quick Game"
          units={STROKE_PLAY_UNITS}
          participants={state.players}
          values={state.values}
          direction="low_wins"
          currentHole={currentHole}
          onHoleChange={setCurrentHole}
          onChange={onChange}
          onClear={onClear}
          onBack={() => router.push("/dashboard")}
          onOpenGrid={() => setView("grid")}
          onFinish={finish}
        />
      )}
    </div>
  );
}
