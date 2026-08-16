"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, RotateCcw } from "lucide-react";
import { computeStrokePlayStandings, type StrokeEntry, type StrokeStanding } from "@/lib/strokePlay";
import { STROKE_PLAY_UNITS, PLAYER_COLORS } from "@/lib/strokePlayConfig";
import { QUICK_GAME_STORAGE_KEY, type QuickGameState } from "@/lib/quickGame";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { FinalStandings } from "@/components/games/FinalStandings";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";
import type { Participant } from "@/components/games/types";

/**
 * Quick Stroke Play ⚡ (Slice A2) — a context-free stroke-play game. Renamed
 * from "Quick Game" (#879 item 1a): the old name promised a format picker that
 * doesn't exist — it only ever does stroke play. The route (`/quick-game`) and
 * the localStorage key stay as they were; those are identifiers, not the
 * user-facing name.
 *
 * Reuses ScoreEntryView / StandardGrid / FinalStandings UNCHANGED — only the
 * persistence backend differs: the whole game state lives in **local storage**,
 * no DB row, no tRPC, no auth, free-text player names. Finish computes standings
 * client-side via the SAME shared `computeStrokePlayStandings`. This is exactly
 * what the persistence-agnostic split (CLAUDE.md pattern #7/#8) was built for.
 *
 * `QuickGameState` and the storage key now live in `@/lib/quickGame` — the
 * dashboard card (#879 item 1c) reads the same saved state to show what's in
 * progress, and needed the type/key without importing this page component.
 */
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
  // currentHole lives IN the persisted state so a refresh resumes on the same
  // hole (not just the scores).
  const setCurrentHole = (h: number) =>
    setState((s) => (s ? { ...s, currentHole: h } : s));
  const [hydrated, setHydrated] = useState(false);
  // Settings gear (#879 item 1b) — a lightweight panel with one action.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Resume any in-progress game from local storage. Must be in an effect (not a
  // useState initializer) so it stays client-only — localStorage is undefined
  // during SSR. The set-state-in-effect rule over-flags this legitimate case.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUICK_GAME_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setState(JSON.parse(raw) as QuickGameState);
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change — gated on `hydrated` STATE (not a ref) so the mount pass,
  // where `state` is still null before the load's setState applies, can't
  // removeItem and wipe a saved game.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (state) localStorage.setItem(QUICK_GAME_STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(QUICK_GAME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  function start() {
    // Floor of 1 (#954/#955): a solo round is a real round — there was never a
    // reason for 2, it was the other half of a sentence describing a foursome
    // (COMPETITION_ENGINE.md:88-89). Cap of 4 stays: the entry grid shows one
    // card's players on one screen, and past four you scroll past people
    // you're directly comparing. Different justifications — don't reason
    // about them together.
    const valid = names.map((n) => n.trim()).filter(Boolean).slice(0, 4);
    if (valid.length < 1) return;
    const players: Participant[] = valid.map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    }));
    setState({ players, values: {}, finished: false, currentHole: 1 });
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
  }
  function discard() {
    setState(null);
    router.push("/dashboard");
  }
  /**
   * Reset Game (#879 item 1b) — clears scores and hole progress, KEEPS the
   * players. This is the ONE reset path Quick Stroke Play has: before this
   * there was no way to start over mid-round short of playing to Finish
   * (which unlocks `playAgain`, and that one wipes the roster too) or leaving
   * via `discard`, which exits to the dashboard entirely.
   *
   * "Clear scores, keep players" over "delete the game" to match the app's
   * one other reset ladder (`games.resetScoring` — "clears this game's
   * results; config kept", `GameDangerZone.tsx`): reset means start the SAME
   * game over, not lose it. It also means not re-typing 2–4 names.
   *
   * Not a `useScoreSaver.clearAll` situation (#807's fix target): that bug was
   * specific to `reconcileScores`' overlay-only merge dropping an empty SERVER
   * response — there is no server here, no reconcile, no outbox. Quick Stroke
   * Play's whole state is one local object with no other writer, so replacing
   * it is atomic and there is nothing this can race against.
   */
  function resetGame() {
    setState((s) => (s ? { ...s, values: {}, finished: false, currentHole: 1 } : s));
    setView("entry");
    setConfirmReset(false);
    setSettingsOpen(false);
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
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>⚡ Quick Stroke Play</h1>
          <button onClick={() => router.push("/dashboard")} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4 }}>Stroke play · name 1–4 players.</p>

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
          disabled={names.map((n) => n.trim()).filter(Boolean).length < 1}
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
          gameName="Quick Stroke Play"
          units={STROKE_PLAY_UNITS}
          participants={state.players}
          values={state.values}
          direction="low_wins"
          currentHole={state.currentHole}
          onHoleChange={setCurrentHole}
          onChange={onChange}
          onClear={onClear}
          onBack={() => router.push("/dashboard")}
          onOpenGrid={() => setView("grid")}
          onFinish={finish}
          onConfig={() => setSettingsOpen(true)}
        />
      )}

      {/* Settings gear (#879 item 1b) — top-right of the game page header, same
          affordance every other game surface uses (`ScoreEntryView`'s existing
          `onConfig` slot — no new chrome). One action for now: Reset Game. The
          gear is placed here, not a bare Reset in the header, so the row below
          (hole-navigation chevron) doesn't have to share the corner — and so a
          format picker has somewhere to land later without moving anything. */}
      {settingsOpen && (
        <SettingsSlideOver
          title="Quick Stroke Play settings"
          onClose={() => setSettingsOpen(false)}
          testId="quick-game-settings-panel"
        >
          <SectionLabel danger>Danger zone</SectionLabel>
          <div className="mt-2">
            <DangerRow
              icon={<RotateCcw size={16} />}
              tone="warning"
              label="Reset game"
              blurb="Clears all scores. Players stay — it's ready to score again."
              onClick={() => setConfirmReset(true)}
              testId="quick-game-reset-btn"
            />
          </div>

          {/* Nested INSIDE the panel, not a sibling — `SettingsSlideOver` portals
              to `document.body` and `DangerConfirmModal` does not, so a sibling
              render loses the stacking fight (same z-50, but the portal's DOM
              node lands later in `body` and paints over it). `GameConfigurationView`
              nests `GameDangerZone`'s confirm the same way; this follows it. */}
          {confirmReset && (
            <DangerConfirmModal
              tone="warning"
              icon={<RotateCcw size={18} />}
              title="Reset this game?"
              body="Clears every score and returns to hole 1. Your players stay — it's ready to score again."
              confirmLabel="Reset game"
              pendingLabel="Resetting…"
              isPending={false}
              testId="quick-game-reset-confirm"
              onCancel={() => setConfirmReset(false)}
              onConfirm={resetGame}
            />
          )}
        </SettingsSlideOver>
      )}
    </div>
  );
}
