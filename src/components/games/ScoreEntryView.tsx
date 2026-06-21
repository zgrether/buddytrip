"use client";

import { useState } from "react";
import { ChevronLeft, Grid3x3, Settings } from "lucide-react";
import { computeStrokePlayStandings, type StrokeEntry } from "@/lib/strokePlay";
import { Avatar } from "@/components/Avatar";
import { StrokeKeypad } from "./StrokeKeypad";
import { HoleProgress, NavArrow, BottomCTA } from "./entryChrome";
import { GolfChip } from "./GolfChip";
import { ScoreSaveBadge } from "./ScoreSaveBadge";
import { UnsavedScoresBanner } from "./UnsavedScoresBanner";
import { golfWord, golfResult, GOLF_STYLE } from "./golfScore";
import {
  parseScoreCellKey,
  scoreCellKey,
  type ScoreUnit,
  type Participant,
  type ScoreValues,
  type ScoreDirection,
  type SaveStatusMap,
} from "./types";

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
  /** §B 2B.3: open the Configuration page from the score-entry hub (top-right).
   *  Omit where there's nothing to configure (Quick Game). */
  onConfig?: () => void;
  /** Per-cell save state (Connectivity Layer 1) — drives the cell badges + the
   *  unsaved-scores banner. Keyed by `${participantId}:${unitLabel}`. */
  saveStatus?: SaveStatusMap;
  /** Re-fire the save for a flagged cell. */
  onRetryCell?: (participantId: string, unitLabel: string) => void;
  /** Handicap stroke holes per participant (`{ [pid]: Set<unitLabel> }`) — a pip
   *  on each stroked cell + a net hint in the row subtitle. Omit for formats
   *  with no handicap (stroke play / Quick Game). Net = gross − 1 on a stroked
   *  hole. */
  pips?: Record<string, Set<string>>;
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
  onConfig,
  saveStatus = {},
  onRetryCell,
  pips,
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
  // The cell just committed — gets the one-shot eagle/birdie celebration.
  const [lastCommit, setLastCommit] = useState<{ hole: number; pid: string } | null>(null);
  const par = unit?.par;
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
    setLastCommit({ hole, pid: activePid });
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

  // ── Save status (Connectivity Layer 1) ────────────────────────────────
  const errorCount = Object.values(saveStatus).filter((s) => s === "error").length;
  const retryAll = () => {
    for (const [k, s] of Object.entries(saveStatus)) {
      if (s !== "error") continue;
      const { participantId, unitLabel } = parseScoreCellKey(k);
      onRetryCell?.(participantId, unitLabel);
    }
  };

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
        <div className="flex items-center">
          {onConfig && (
            <button onClick={onConfig} aria-label="Configuration" className="flex h-9 w-9 items-center justify-center">
              <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
            </button>
          )}
          <button onClick={onOpenGrid} aria-label="Scorecard grid" className="flex h-9 w-9 items-center justify-center">
            <Grid3x3 size={20} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </div>
      </header>

      {/* ── Unsaved-scores safety net (Connectivity Layer 1) ── */}
      <UnsavedScoresBanner count={errorCount} onRetry={retryAll} />

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
          {par != null && (
            <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
              Par {par}
              {unit?.strokeIndex != null && ` · Hdcp ${unit.strokeIndex}`}
            </div>
          )}
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
          // Handicap: does this player get a stroke on THIS hole? (course index)
          const stroked = pips?.[p.id]?.has(label) ?? false;
          return (
            <div key={p.id}>
              {/* role=button (not <button>) so the per-cell Retry button can
                  nest without invalid button-in-button markup. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setOverride({ hole, pid: p.id })}
                className="flex w-full cursor-pointer items-center gap-3 text-left"
                style={{
                  height: 62,
                  padding: "0 16px 0 0",
                  background: active ? "var(--color-bt-accent-faint)" : "transparent",
                  borderBottom: "1px solid var(--color-bt-subtle-border)",
                  borderLeft: `3px solid ${active ? "var(--color-bt-accent)" : "transparent"}`,
                  paddingLeft: 13,
                }}
              >
                <Avatar name={p.name} teamColor={p.color} avatarIcon={p.avatarIcon} sizePx={34} />
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
                      fontWeight: par != null && v != null ? 600 : 400,
                      color:
                        par != null && v != null
                          ? GOLF_STYLE[golfResult(v, par)!].fg
                          : lead
                            ? "var(--color-bt-place-1-text)"
                            : "var(--color-bt-text-dim)",
                    }}
                  >
                    {par != null && v != null
                      ? stroked
                        ? `${golfWord(v, par)} · net ${golfWord(v - 1, par)}`
                        : golfWord(v, par)
                      : total === 0
                        ? "No scores yet"
                        : lead
                          ? `${total} total · Leading`
                          : `${total} total`}
                  </div>
                </div>
                <ScoreSaveBadge
                  state={saveStatus[scoreCellKey(p.id, label)]}
                  onRetry={() => onRetryCell?.(p.id, label)}
                />
                <ScoreCell value={v} active={active} par={par} stroked={stroked} celebrate={lastCommit?.pid === p.id && lastCommit?.hole === hole} />
              </div>
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

function ScoreCell({
  value,
  active,
  par,
  stroked,
  celebrate,
}: {
  value: number | undefined;
  active: boolean;
  par?: number;
  /** Player gets a handicap stroke on this hole (course index) → corner pip. */
  stroked?: boolean;
  celebrate?: boolean;
}) {
  const pip = stroked ? <StrokePip /> : null;
  // Committed (not being edited) + par known → the golf shape IS the cell.
  if (!active && value != null && par != null) {
    return (
      <span className="relative flex items-center justify-center" style={{ width: 52, height: 46, flexShrink: 0 }}>
        <GolfChip value={value} par={par} size={42} fontSize={22} celebrate={celebrate} />
        {pip}
      </span>
    );
  }
  if (active && value == null) {
    return (
      <span
        className="relative flex items-center justify-center"
        style={{
          width: 52,
          height: 46,
          borderRadius: 10,
          border: "2px solid var(--color-bt-accent)",
          boxShadow: "0 0 0 3px rgba(45,212,191,0.12)",
          color: "var(--color-bt-accent)",
          fontSize: 24,
          flexShrink: 0,
        }}
      >
      +{pip}
      </span>
    );
  }
  if (value != null) {
    return (
      <span
        className="relative flex items-center justify-center"
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
        {pip}
      </span>
    );
  }
  return (
    <span
      className="relative flex items-center justify-center"
      style={{
        width: 52,
        height: 46,
        borderRadius: 10,
        border: "1.5px dashed var(--color-bt-border)",
        color: "var(--color-bt-border)",
        fontSize: 24,
        flexShrink: 0,
      }}
    >
      +{pip}
    </span>
  );
}

/** Handicap stroke pip — a player receives a stroke on this hole (course index). */
function StrokePip() {
  return (
    <span
      style={{
        position: "absolute",
        top: -3,
        right: -3,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--color-bt-warning)",
        boxShadow: "0 0 0 1.5px var(--color-bt-base)",
      }}
    />
  );
}

