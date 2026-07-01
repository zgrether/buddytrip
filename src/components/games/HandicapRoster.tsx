"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Stepper } from "@/components/games/Stepper";
import { clampStrokes, strokeHint, MAX_STROKES } from "@/lib/handicap";

/**
 * Handicaps setup step (Slice C, Mode A) — the per-player ABSOLUTE handicap
 * roster. Captures an integer 0–18 per participant (0 = SCR/scratch); net is
 * derived downstream. Each stepper change is optimistic + debounced (~400ms) and
 * persists via `onSetStrokes` without tapping Done — Done only advances. A row
 * rolls back on a persist error.
 *
 * Persistence-agnostic per CLAUDE.md #7: data in via props, changes out via
 * `onSetStrokes`; no tRPC here. Team dots are READ from props (the competition),
 * never set here.
 */

export interface HandicapPlayer {
  id: string;
  name: string;
  avatarIcon?: string | null;
  /** Team color in a competition; null/undefined → standalone (no dot). */
  teamColor?: string | null;
  strokes: number;
}

const DEBOUNCE_MS = 400;

/**
 * HandicapList — the per-player stepper cards + their optimistic/debounced persist,
 * lifted out of HandicapRoster so the SAME cards render inline in a settings-panel
 * (rack's Handicaps accordion) as well as full-screen (stroke's roster). `raised`
 * lifts each card to `card-raised` when it sits ON a card surface (an accordion
 * panel); the default `card` is for a base-background full-screen roster.
 */
export function HandicapList({
  players,
  holeCount,
  strokeIndex,
  onSetStrokes,
  raised = false,
}: {
  players: HandicapPlayer[];
  holeCount: number;
  strokeIndex: number[] | null;
  onSetStrokes: (userId: string, strokes: number) => Promise<unknown>;
  raised?: boolean;
}) {
  // `local` holds only EDITED rows; an unedited row reads the prop value. So a
  // background refetch (after persist) flows through props without an effect.
  const [local, setLocal] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, number>>({}); // edits not yet persisted
  const onSetRef = useRef(onSetStrokes);
  useEffect(() => {
    onSetRef.current = onSetStrokes;
  });
  const strokesOf = (p: HandicapPlayer) => local[p.id] ?? p.strokes;

  const persist = (id: string, value: number) => {
    delete pending.current[id];
    onSetRef.current(id, value).catch(() => {
      // Rollback: drop the local override → the row falls back to the prop
      // (the server value, unchanged by the failed write).
      setLocal((l) => {
        const copy = { ...l };
        delete copy[id];
        return copy;
      });
    });
  };

  // On unmount (Done / Back / nav-away / accordion collapse) FLUSH any pending
  // debounced edit so the value survives leaving — never silently drop it.
  useEffect(() => {
    const t = timers.current;
    const p = pending.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
      for (const [id, v] of Object.entries(p)) persist(id, v);
    };
  }, []);

  const bump = (id: string, base: number, delta: number) => {
    // Read the freshest value (a rapid second tap before re-render) from the
    // pending ref, then local, then the prop — so fast +/+ increments correctly.
    const cur = pending.current[id] ?? local[id] ?? base;
    const next = clampStrokes(cur + delta);
    if (next === cur) return;
    pending.current[id] = next;
    setLocal((l) => ({ ...l, [id]: next })); // optimistic
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => persist(id, next), DEBOUNCE_MS);
  };

  return (
    <div className="flex flex-col gap-2">
      {players.map((p) => {
        const strokes = strokesOf(p);
        const hint = strokeHint(strokes, holeCount, strokeIndex);
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border px-3" style={{ minHeight: 60, padding: "8px 12px", background: raised ? "var(--color-bt-card-raised)" : "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}>
            <Avatar name={p.name} avatarIcon={p.avatarIcon} teamColor={p.teamColor} sizePx={34} />
            <div className="min-w-0 flex-1">
              {/* The avatar carries the team color now (solid disc) — no
                  separate team dot needed. */}
              <span className="truncate block" style={{ fontSize: 15, fontWeight: 500, color: "var(--color-bt-text)" }}>{p.name}</span>
              {hint && <span className="block truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 1 }}>{hint}</span>}
            </div>
            {/* Delta callbacks (not onChange) so bump's pending-ref rapid-tap
                handling is preserved; formatValue keeps "SCR" at 0 (P-B). */}
            <Stepper
              size="full"
              value={strokes}
              min={0}
              max={MAX_STROKES}
              onDecrement={() => bump(p.id, strokes, -1)}
              onIncrement={() => bump(p.id, strokes, 1)}
              formatValue={(n) => (n === 0 ? "SCR" : String(n))}
            />
          </div>
        );
      })}
    </div>
  );
}

export function HandicapRoster({
  players,
  holeCount,
  strokeIndex,
  onSetStrokes,
  onDone,
  onBack,
}: {
  players: HandicapPlayer[];
  holeCount: number;
  strokeIndex: number[] | null;
  onSetStrokes: (userId: string, strokes: number) => Promise<unknown>;
  onDone: () => void;
  onBack: () => void;
}) {
  const allScratch = players.every((p) => p.strokes === 0);

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      <header className="flex shrink-0 items-center justify-between" style={{ height: 52, padding: "0 8px", background: "var(--color-bt-nav-bg)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
        <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
        </button>
        <div className="min-w-0 text-center">
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>Handicaps</div>
          <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
            <span style={{ color: "var(--color-bt-accent)" }}>Pairings ✓</span> › Handicaps › Course
          </div>
        </div>
        <div className="h-9 w-9" />
      </header>

      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-bt-text)" }}>Strokes for this game</div>
        <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 4, lineHeight: 1.5 }}>
          Strokes come off gross and land on the hardest holes — a guess to keep it competitive, not an official handicap.
        </p>

        {allScratch && (
          <p style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "var(--color-bt-card)" }}>
            Everyone&apos;s scratch — net plays as gross. Set strokes below, or leave it and tap Done.
          </p>
        )}

        <div className="mt-4">
          <HandicapList players={players} holeCount={holeCount} strokeIndex={strokeIndex} onSetStrokes={onSetStrokes} />
        </div>
      </div>

      <div className="shrink-0" style={{ padding: 16, borderTop: "1px solid var(--color-bt-subtle-border)" }}>
        <button onClick={onDone} className="w-full" style={{ height: 52, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}>
          Done
        </button>
      </div>
    </div>
  );
}

