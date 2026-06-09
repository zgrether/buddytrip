"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Grid3x3, Check } from "lucide-react";
import { computeStrokePlayStandings, type StrokeEntry } from "@/lib/strokePlay";
import { StrokeKeypad } from "./StrokeKeypad";
import type { ScoreUnit, Participant, ScoreValues, ScoreDirection } from "./types";

/**
 * ScoreEntryView — the per-unit (hole-by-hole) score-entry surface (Slice A,
 * Task 6). The ONLY entry path; the review grid (Task 7) is read-only.
 *
 * Persistence-agnostic: data in via props, commits out via `onChange`. No tRPC,
 * no DB, no auth — the parent (trip game OR local Quick Game) owns persistence.
 * The live standings strip uses the SHARED `computeStrokePlayStandings`, the
 * same logic the Final screen uses.
 *
 * Unit count / labels / sections all come from props (scorecard_schema) — never
 * a literal 18 or the word "hole".
 */
interface ScoreEntryViewProps {
  gameName: string;
  units: ScoreUnit[];
  participants: Participant[];
  values: ScoreValues;
  direction: ScoreDirection;
  onChange: (participantId: string, unitLabel: string, value: number) => void;
  onClear?: (participantId: string, unitLabel: string) => void;
  currentHole?: number; // 1-based index into units; defaults to 1
  onHoleChange?: (hole: number) => void;
  onFinish?: () => void;
  onBack?: () => void;
  onOpenGrid?: () => void;
}

export function ScoreEntryView({
  gameName,
  units,
  participants,
  values,
  onChange,
  onClear,
  currentHole,
  onHoleChange,
  onFinish,
  onBack,
  onOpenGrid,
}: ScoreEntryViewProps) {
  const [holeInternal, setHoleInternal] = useState(currentHole ?? 1);
  const hole = currentHole ?? holeInternal;
  const setHole = (h: number) => {
    if (onHoleChange) onHoleChange(h);
    else setHoleInternal(h);
  };

  const unit = units[hole - 1];
  const label = unit?.label ?? String(hole);

  const valueFor = (pid: string, l: string): number | undefined => values[pid]?.[l];
  const holeComplete = (l: string) => participants.every((p) => valueFor(p.id, l) != null);
  const completedHoles = units.filter((u) => holeComplete(u.label)).length;
  // 1-based numbers of fully-scored holes — drives the progress bar (a GAP
  // before the furthest-reached hole renders amber = skipped).
  const completedHoleNumbers = units
    .map((u, i) => (holeComplete(u.label) ? i + 1 : 0))
    .filter((n) => n > 0);
  const allComplete = completedHoles === units.length && units.length > 0;
  const currentComplete = holeComplete(label);

  // Active player (keypad target). DERIVED, not stored: default is the first
  // unscored player on the current hole; a row tap sets an explicit `override`
  // scoped to that hole. Because the override is hole-scoped, it auto-clears
  // when the hole changes — whether via the nav here OR a parent-controlled
  // `currentHole` (e.g. tapping a cell in the review grid) — with no
  // render-phase setState to reset it.
  const [override, setOverride] = useState<{ hole: number; pid: string } | null>(null);
  const activePid =
    override && override.hole === hole && participants.some((p) => p.id === override.pid)
      ? override.pid
      : (participants.find((p) => valueFor(p.id, label) == null)?.id ?? null);

  // ── Live standings (shared logic) ────────────────────────────────────
  const entries: StrokeEntry[] = [];
  for (const p of participants) {
    for (const u of units) {
      const v = valueFor(p.id, u.label);
      if (v != null) entries.push({ participant_id: p.id, value: v });
    }
  }
  const scoredIds = participants
    .filter((p) => Object.keys(values[p.id] ?? {}).length > 0)
    .map((p) => p.id);
  const standings = computeStrokePlayStandings(scoredIds, entries);
  const standingById = new Map(standings.map((s) => [s.entityId, s]));
  const totalOf = (pid: string) => standingById.get(pid)?.rawScore ?? 0;
  const isLeading = (pid: string) =>
    scoredIds.length > 0 && standingById.get(pid)?.position === 1;
  const doneCount = (pid: string) =>
    units.filter((u) => valueFor(pid, u.label) != null).length;

  // ── Handlers ─────────────────────────────────────────────────────────
  const commit = (v: number) => {
    if (!activePid) return;
    onChange(activePid, label, v);
    // Pin this player as active so a committed score does NOT auto-advance.
    // Advancing waits for ✓ (confirmAdvance) — lets the user validate/edit the
    // number first. Applies equally to a new entry and an edit.
    setOverride({ hole, pid: activePid });
  };
  const confirmAdvance = () => {
    const next = participants.find(
      (p) => p.id !== activePid && valueFor(p.id, label) == null
    );
    setOverride(next ? { hole, pid: next.id } : null);
  };
  const clear = () => {
    // Delete the active cell's score; keypad stays open on this participant so
    // they can re-enter. The cell reverts to empty once the value is gone.
    if (activePid) onClear?.(activePid, label);
  };
  const goHole = (h: number) => {
    if (h >= 1 && h <= units.length) setHole(h);
  };

  const activeParticipant = participants.find((p) => p.id === activePid) ?? null;
  const isCorrection = activePid != null && valueFor(activePid, label) != null;

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      {/* ── App bar ── */}
      <header
        className="flex shrink-0 items-center justify-between"
        style={{
          height: 52,
          padding: "0 12px",
          background: "var(--color-bt-nav-bg)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--color-bt-subtle-border)",
        }}
      >
        <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft size={20} style={{ color: "var(--color-bt-text)" }} />
        </button>
        <div className="text-center">
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-bt-text)" }}>{gameName}</div>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>
            Hole {hole} of {units.length}
          </div>
        </div>
        <button onClick={onOpenGrid} aria-label="Scorecard grid" className="flex h-9 w-9 items-center justify-center">
          <Grid3x3 size={20} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
      </header>

      {/* ── Standings strip ── */}
      <div
        className="flex shrink-0 items-center gap-2 overflow-x-auto"
        style={{
          minHeight: 42,
          padding: "0 14px",
          background: "var(--color-bt-card)",
          borderBottom: "1px solid var(--color-bt-border)",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-bt-text-dim)",
            flexShrink: 0,
          }}
        >
          Scores
        </span>
        {scoredIds.length === 0 ? (
          <span style={{ fontStyle: "italic", fontSize: 14, color: "var(--color-bt-text-dim)" }}>
            Teeing off
          </span>
        ) : (
          [...participants]
            .filter((p) => scoredIds.includes(p.id))
            .sort((a, b) => totalOf(a.id) - totalOf(b.id))
            .map((p) => {
              const lead = isLeading(p.id);
              return (
                <span
                  key={p.id}
                  className="flex shrink-0 items-center gap-1.5"
                  style={{
                    padding: "3px 9px",
                    borderRadius: 9999,
                    background: lead ? "var(--color-bt-place-1-bg)" : "transparent",
                    fontWeight: lead ? 600 : 400,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color }} />
                  <span style={{ fontSize: 14, color: lead ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)" }}>
                    {p.name}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: lead ? "var(--color-bt-place-1-text)" : "var(--color-bt-text)" }}>
                    {totalOf(p.id)}
                  </span>
                </span>
              );
            })
        )}
      </div>

      {/* ── Hole navigation ── */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ padding: "16px 16px" }}
      >
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 12, flex: 1, minWidth: 0 }}>
          {/* The ONLY thing the bigger-fonts pass leaves alone — the main title. */}
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          <HoleProgress count={units.length} currentHole={hole} completed={completedHoleNumbers} />
        </div>
        <NavArrow dir="next" disabled={hole >= units.length} onClick={() => goHole(hole + 1)} />
      </div>

      {/* ── Player rows ── */}
      <div className="shrink-0">
        {participants.map((p) => {
          const active = p.id === activePid;
          const v = valueFor(p.id, label);
          const total = totalOf(p.id);
          const lead = isLeading(p.id);
          const done = doneCount(p.id) === units.length;
          return (
            <div key={p.id}>
              <button
                onClick={() => setOverride({ hole, pid: p.id })}
                className="flex w-full items-center gap-3 text-left"
                style={{
                  height: 62,
                  padding: "0 16px 0 0",
                  background: active ? "var(--color-bt-accent-faint)" : "transparent",
                  borderBottom: "1px solid var(--color-bt-subtle-border)",
                  borderLeft: `3px solid ${active ? "var(--color-bt-accent)" : "transparent"}`,
                  paddingLeft: 13,
                }}
              >
                <span
                  className="flex items-center justify-center"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: `${p.color}22`,
                    border: `1.5px solid ${p.color}55`,
                    color: p.color,
                    fontSize: 15,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {p.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 17, fontWeight: 500, color: "var(--color-bt-text)" }}>{p.name}</span>
                    {done && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          color: "var(--color-bt-accent)",
                          background: "var(--color-bt-accent-faint)",
                          border: "1px solid var(--color-bt-accent-border)",
                          borderRadius: 4,
                          padding: "1px 5px",
                        }}
                      >
                        DONE
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: lead ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)",
                    }}
                  >
                    {total === 0 ? "No scores yet" : lead ? `${total} total · Leading` : `${total} total`}
                  </div>
                </div>
                <ScoreCell value={v} active={active} />
              </button>
              {active && isCorrection && (
                <div
                  className="flex items-center gap-1.5"
                  style={{
                    padding: "6px 16px 6px 74px",
                    background: "var(--color-bt-warning-faint)",
                    borderBottom: "1px solid var(--color-bt-warning-border)",
                    color: "var(--color-bt-warning)",
                    fontSize: 13,
                  }}
                >
                  Tap a new number to update
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* ── Bottom: keypad | Next Hole | Finish ── */}
      {activeParticipant ? (
        <StrokeKeypad
          participantName={activeParticipant.name}
          value={valueFor(activeParticipant.id, label) ?? null}
          onCommit={commit}
          onClear={clear}
          onConfirm={confirmAdvance}
        />
      ) : allComplete ? (
        <BottomCTA label="Finish" icon onClick={() => onFinish?.()} subtext="Saves results · shows final standings" />
      ) : currentComplete && hole < units.length ? (
        <BottomCTA label={`Hole ${units[hole]?.label ?? hole + 1} ›`} onClick={() => goHole(hole + 1)} />
      ) : null}
    </div>
  );
}

function ScoreCell({ value, active }: { value: number | undefined; active: boolean }) {
  if (active && value == null) {
    return (
      <span
        className="flex items-center justify-center"
        style={{
          width: 52,
          height: 46,
          borderRadius: 10,
          border: "2px solid var(--color-bt-accent)",
          boxShadow: "0 0 0 3px rgba(45,212,191,0.12)",
          color: "var(--color-bt-accent)",
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        ···
      </span>
    );
  }
  if (value != null) {
    return (
      <span
        className="flex items-center justify-center"
        style={{
          width: 52,
          height: 46,
          borderRadius: 10,
          border: active ? "2px solid var(--color-bt-accent)" : "1px solid var(--color-bt-border)",
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          fontSize: 26,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {value}
      </span>
    );
  }
  return (
    <span
      className="flex items-center justify-center"
      style={{
        width: 52,
        height: 46,
        borderRadius: 10,
        border: "1.5px dashed var(--color-bt-border)",
        color: "var(--color-bt-text-dim)",
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      —
    </span>
  );
}

/**
 * Segmented hole-progress bar. `completed` is the set of fully-scored hole
 * numbers (not a count) — so a GAP before the furthest-reached hole renders
 * AMBER (= skipped). Done = quiet slate, current = teal (current always wins
 * over missing, since a current hole is never "missing"), future = faint.
 */
function HoleProgress({
  count,
  currentHole,
  completed,
}: {
  count: number;
  currentHole: number;
  completed: number[];
}) {
  const reached = Math.max(currentHole, ...(completed.length ? completed : [currentHole]));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2.5,
        height: 4,
        width: "100%",
        maxWidth: 232,
        margin: "0 auto",
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const h = i + 1;
        const isDone = completed.includes(h);
        const isCurrent = h === currentHole;
        const isMissing = !isDone && !isCurrent && h < reached;
        let bg = "var(--color-bt-card-raised)"; // future
        let op = 0.6;
        if (isDone) {
          bg = "var(--color-bt-text-dim)"; // slate — quiet
          op = 0.85;
        } else if (isMissing) {
          bg = "var(--color-bt-warning)"; // amber — skipped
          op = 1;
        } else if (isCurrent) {
          bg = "var(--color-bt-accent)"; // teal — you are here
          op = 1;
        }
        return <div key={h} style={{ flex: 1, height: 4, borderRadius: 2, background: bg, opacity: op }} />;
      })}
    </div>
  );
}

function NavArrow({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous hole" : "Next hole"}
      className="flex items-center justify-center"
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: disabled ? "transparent" : "var(--color-bt-card)",
        border: disabled ? "1px solid transparent" : "1px solid var(--color-bt-border)",
        color: disabled ? "transparent" : "var(--color-bt-text)",
      }}
    >
      {dir === "prev" ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );
}

function BottomCTA({ label, onClick, subtext, icon }: { label: string; onClick: () => void; subtext?: string; icon?: boolean }) {
  return (
    <div
      style={{
        background: "var(--color-bt-card-float)",
        borderTop: "1px solid var(--color-bt-border)",
        padding: "12px 16px 24px",
      }}
    >
      <button
        onClick={onClick}
        className="flex w-full items-center justify-center gap-2 transition-transform active:scale-[0.98]"
        style={{
          height: 54,
          borderRadius: 12,
          background: "var(--color-bt-accent)",
          color: "#0d1f1a",
          fontSize: 17,
          fontWeight: 600,
        }}
      >
        {icon && <Check size={20} strokeWidth={2.2} />}
        {label}
      </button>
      {subtext && (
        <div className="text-center" style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 8 }}>
          {subtext}
        </div>
      )}
    </div>
  );
}
