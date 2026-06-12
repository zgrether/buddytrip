"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus, Minus } from "lucide-react";
import { Avatar } from "@/components/Avatar";
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

  // On unmount (Done / Back / nav-away) FLUSH any pending debounced edit so the
  // value survives leaving without tapping Done — never silently drop it.
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

  const allScratch = players.every((p) => strokesOf(p) === 0);

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

        <div className="mt-4 flex flex-col gap-2">
          {players.map((p) => {
            const strokes = strokesOf(p);
            const hint = strokeHint(strokes, holeCount, strokeIndex);
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border px-3" style={{ minHeight: 60, padding: "8px 12px", background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}>
                <Avatar name={p.name} avatarIcon={p.avatarIcon} sizePx={34} />
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {p.teamColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.teamColor, flexShrink: 0 }} />}
                    <span className="truncate" style={{ fontSize: 15, fontWeight: 500, color: "var(--color-bt-text)" }}>{p.name}</span>
                  </span>
                  {hint && <span className="block truncate" style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 1 }}>{hint}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StepBtn dir="dec" disabled={strokes <= 0} onClick={() => bump(p.id, strokes, -1)} />
                  <span style={{ minWidth: 34, textAlign: "center", fontSize: strokes === 0 ? 13 : 17, fontWeight: 700, color: strokes === 0 ? "var(--color-bt-text-dim)" : "var(--color-bt-text)", fontVariantNumeric: "tabular-nums" }}>
                    {strokes === 0 ? "SCR" : strokes}
                  </span>
                  <StepBtn dir="inc" disabled={strokes >= MAX_STROKES} onClick={() => bump(p.id, strokes, 1)} />
                </div>
              </div>
            );
          })}
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

function StepBtn({ dir, disabled, onClick }: { dir: "inc" | "dec"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center disabled:opacity-30"
      style={{ width: 34, height: 34, borderRadius: 9, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}
    >
      {dir === "inc" ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
}
