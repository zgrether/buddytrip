"use client";

import { useState } from "react";
import { ChevronLeft, Grid3x3 } from "lucide-react";
import { buildDecided, matchState, strokeHoles } from "@/lib/matchPlay";
import { StrokeKeypad } from "./StrokeKeypad";
import { MatchCard } from "./MatchCard";
import { HoleProgress, NavArrow, BottomCTA } from "./entryChrome";
import { Avatar } from "@/components/Avatar";
import type { ScoreUnit, Participant, ScoreValues } from "./types";

/**
 * MatchEntryView — the per-hole entry surface for singles match play (Slice B).
 * It is the Slice A entry view with three things layered on (the only deltas):
 *   1. a MatchCard pinned per match group,
 *   2. a stroke pip + gross/net subtitle on the receiving player's cell,
 *   3. rows GROUPED by match (one strip + its two rows; repeats for a foursome).
 *
 * Everything else — keypad (tap-to-commit, no auto-advance), hole nav, segmented
 * progress — is Slice A verbatim (shared `entryChrome` + `StrokeKeypad`).
 *
 * Persistence-agnostic: data in via props, commits out via onChange/onClear; the
 * parent owns persistence. Match state is the SHARED, frozen `matchState`.
 */
export interface MatchGroupData {
  matchId: string;
  label: string;
  a: Participant;
  b: Participant;
  strokesA: number; // handicap strokes A receives (usually 0)
  strokesB: number;
}

interface MatchEntryViewProps {
  gameName: string;
  units: ScoreUnit[];
  matches: MatchGroupData[];
  values: ScoreValues;
  onChange: (participantId: string, unitLabel: string, value: number) => void;
  onClear?: (participantId: string, unitLabel: string) => void;
  currentHole?: number;
  onHoleChange?: (hole: number) => void;
  onFinish?: () => void;
  onBack?: () => void;
  onOpenGrid?: () => void;
  /** App-bar subtitle (defaults to "Hole N of N"). */
  subtitle?: string;
  /** Bottom-CTA label when the card is complete/over (defaults to "Finish"). */
  finishLabel?: string;
  finishSubtext?: string;
  /** Current user's id — appends "(you)" to their name on the board + rows. */
  meId?: string;
}

export function MatchEntryView({
  gameName,
  units,
  matches,
  values,
  onChange,
  onClear,
  currentHole,
  onHoleChange,
  onFinish,
  onBack,
  onOpenGrid,
  subtitle,
  finishLabel = "Finish",
  finishSubtext = "Saves results · shows final standings",
  meId,
}: MatchEntryViewProps) {
  const [holeInternal, setHoleInternal] = useState(currentHole ?? 1);
  const hole = currentHole ?? holeInternal;
  const setHole = (h: number) => {
    if (onHoleChange) onHoleChange(h);
    else setHoleInternal(h);
  };
  const goHole = (h: number) => {
    if (h >= 1 && h <= units.length) setHole(h);
  };

  const unit = units[hole - 1];
  const label = unit?.label ?? String(hole);
  const valueFor = (pid: string, l: string) => values[pid]?.[l];

  // Opt-in "play it out" for decided matches (dead holes become editable again).
  const [playOut, setPlayOut] = useState<Set<string>>(new Set());

  // Per-match derived state (from the SHARED frozen matchState).
  const groups = matches.map((m) => {
    const decided = buildDecided(values[m.a.id] ?? {}, values[m.b.id] ?? {}, m.strokesA, m.strokesB);
    const st = matchState(decided);
    const strokeHolesA = strokeHoles(m.strokesA);
    const strokeHolesB = strokeHoles(m.strokesB);
    // A hole is "dead" for a decided match once it's past the close-out hole.
    const isDeadHole = (h: number) => st.closed && h > st.thru;
    return { m, decided, st, strokeHolesA, strokeHolesB, isDeadHole };
  });

  const participantMatch = new Map<string, (typeof groups)[number]>();
  for (const g of groups) {
    participantMatch.set(g.m.a.id, g);
    participantMatch.set(g.m.b.id, g);
  }
  const allParticipants = matches.flatMap((m) => [m.a, m.b]);

  const isInteractive = (pid: string, h: number) => {
    const g = participantMatch.get(pid)!;
    if (g.isDeadHole(h) && !playOut.has(g.m.matchId)) return false;
    return true;
  };
  // Participants who still need to score hole h (their match isn't decided-dead there).
  const requiredOn = (h: number, l: string) =>
    allParticipants.filter((p) => {
      const g = participantMatch.get(p.id)!;
      return !(g.isDeadHole(h)) && valueFor(p.id, l) == null;
    });

  // Active player (keypad target) — DERIVED, hole-scoped override (Slice A pattern).
  const [override, setOverride] = useState<{ hole: number; pid: string } | null>(null);
  const interactiveHere = allParticipants.filter((p) => isInteractive(p.id, hole));
  const activePid =
    override && override.hole === hole && interactiveHere.some((p) => p.id === override.pid)
      ? override.pid
      : (interactiveHere.find((p) => valueFor(p.id, label) == null)?.id ?? null);
  const activeParticipant = allParticipants.find((p) => p.id === activePid) ?? null;
  const isCorrection = activePid != null && valueFor(activePid, label) != null;

  // Progress + completion (dead holes don't require scores).
  const holeComplete = (h: number, l: string) => requiredOn(h, l).length === 0;
  const completedHoleNumbers = units
    .map((u, i) => (holeComplete(i + 1, u.label) ? i + 1 : 0))
    .filter((n) => n > 0);
  const currentComplete = holeComplete(hole, label);
  const allHolesComplete = completedHoleNumbers.length === units.length && units.length > 0;
  const allMatchesOver = groups.every((g) => g.st.over);
  const canFinish = allMatchesOver || allHolesComplete;

  const commit = (v: number) => {
    if (!activePid) return;
    onChange(activePid, label, v);
    setOverride({ hole, pid: activePid }); // pin — no auto-advance (waits for ✓)
  };
  const confirmAdvance = () => {
    const next = interactiveHere.find((p) => p.id !== activePid && valueFor(p.id, label) == null);
    setOverride(next ? { hole, pid: next.id } : null);
  };
  const clear = () => {
    if (activePid) onClear?.(activePid, label);
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      {/* App bar */}
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
            {subtitle ?? `Hole ${hole} of ${units.length}`}
          </div>
        </div>
        <button onClick={onOpenGrid} aria-label="Scorecard grid" className="flex h-9 w-9 items-center justify-center">
          <Grid3x3 size={20} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
      </header>

      {/* Match board(s) — pinned at the top, above the hole selector */}
      <div className="shrink-0" style={{ padding: "12px 12px 0" }}>
        {groups.map((g) => {
          const { m, decided, st } = g;
          const winner = st.leader === "A" ? m.a : st.leader === "B" ? m.b : null;
          const loser = st.leader === "A" ? m.b : st.leader === "B" ? m.a : null;
          return (
            <div key={m.matchId} style={{ marginBottom: 8 }}>
              <MatchCard
                a={m.a}
                b={m.b}
                results={decided}
                label={m.label}
                holeCount={units.length}
                youId={meId}
                hideFormat
              />

              {/* Closed-out result banner (§4) */}
              {st.over && (
                <div
                  className="flex items-center justify-between"
                  style={{
                    marginTop: 6,
                    padding: "7px 12px",
                    borderRadius: 10,
                    background: "var(--color-bt-place-1-bg)",
                    border: "1px solid rgba(34,197,94,0.25)",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-place-1-text)" }}>
                    {winner && loser ? `${winner.name} def. ${loser.name} · ${st.margin}` : `Match halved · ${st.margin}`}
                  </span>
                  {st.closed && g.isDeadHole(hole) && (
                    <button
                      onClick={() =>
                        setPlayOut((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.matchId)) next.delete(m.matchId);
                          else next.add(m.matchId);
                          return next;
                        })
                      }
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--color-bt-text-dim)",
                        textDecoration: "underline",
                      }}
                    >
                      {playOut.has(m.matchId) ? "Stop" : "Play it out"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hole navigation */}
      <div className="flex shrink-0 items-center justify-between" style={{ padding: "8px 16px 12px" }}>
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          <HoleProgress count={units.length} currentHole={hole} completed={completedHoleNumbers} />
        </div>
        <NavArrow dir="next" disabled={hole >= units.length} onClick={() => goHole(hole + 1)} />
      </div>

      {/* Player rows */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 12px 8px" }}>
        {groups.map((g) => {
          const { m } = g;
          const deadHere = g.isDeadHole(hole) && !playOut.has(m.matchId);
          return (
            <div key={m.matchId} style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--color-bt-border)" }}>
              <PlayerRow
                group={g}
                player={m.a}
                isA
                label={label}
                hole={hole}
                active={activePid === m.a.id}
                dead={deadHere}
                valueFor={valueFor}
                onTap={() => setOverride({ hole, pid: m.a.id })}
                isMe={!!meId && m.a.id === meId}
              />
              <PlayerRow
                group={g}
                player={m.b}
                isA={false}
                label={label}
                hole={hole}
                active={activePid === m.b.id}
                dead={deadHere}
                valueFor={valueFor}
                onTap={() => setOverride({ hole, pid: m.b.id })}
                isMe={!!meId && m.b.id === meId}
                last
              />
            </div>
          );
        })}
        {activePid && isCorrection && (
          <div
            className="flex items-center gap-1.5"
            style={{
              marginTop: 8,
              padding: "6px 12px",
              borderRadius: 8,
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              color: "var(--color-bt-warning)",
              fontSize: 13,
            }}
          >
            Tap a new number to update
          </div>
        )}
      </div>

      {/* Bottom: keypad | Next Hole | Finish */}
      {activeParticipant ? (
        <StrokeKeypad
          participantName={activeParticipant.name}
          value={valueFor(activeParticipant.id, label) ?? null}
          onCommit={commit}
          onClear={clear}
          onConfirm={confirmAdvance}
        />
      ) : canFinish ? (
        <BottomCTA label={finishLabel} icon onClick={() => onFinish?.()} subtext={finishSubtext} />
      ) : currentComplete && hole < units.length ? (
        <BottomCTA label={`Hole ${units[hole]?.label ?? hole + 1} ›`} onClick={() => goHole(hole + 1)} />
      ) : null}
    </div>
  );
}

function PlayerRow({
  group,
  player,
  isA,
  label,
  hole,
  active,
  dead,
  valueFor,
  onTap,
  isMe,
  last,
}: {
  group: { st: ReturnType<typeof matchState>; strokeHolesA: Set<number>; strokeHolesB: Set<number> };
  player: Participant;
  isA: boolean;
  label: string;
  hole: number;
  active: boolean;
  dead: boolean;
  valueFor: (pid: string, l: string) => number | undefined;
  onTap: () => void;
  isMe?: boolean;
  last?: boolean;
}) {
  const v = valueFor(player.id, label);
  const stroked = (isA ? group.strokeHolesA : group.strokeHolesB).has(hole);

  // Score entry only cares about THIS hole — never the match state. Awaiting a
  // score until one is entered; then the gross/net (stroke holes only).
  const subtitle = v == null ? "Awaiting score" : stroked ? `Gross ${v} · net ${v - 1}` : "";

  return (
    <button
      onClick={dead ? undefined : onTap}
      disabled={dead}
      className="flex w-full items-center gap-3 text-left"
      style={{
        height: 62,
        padding: "0 14px 0 0",
        opacity: dead ? 0.55 : 1,
        background: active ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        borderTop: last ? "1px solid var(--color-bt-subtle-border)" : undefined,
        borderLeft: `3px solid ${active ? "var(--color-bt-accent)" : "transparent"}`,
        paddingLeft: 11,
      }}
    >
      <Avatar name={player.name} avatarIcon={player.avatarIcon} sizePx={34} />
      <div className="min-w-0 flex-1">
        <span style={{ fontSize: 17, fontWeight: 500, color: "var(--color-bt-text)" }}>
          {player.name}
          {isMe && <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}> (you)</span>}
        </span>
        <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
      </div>
      <MatchScoreCell value={v} active={active} stroked={stroked} />
    </button>
  );
}

function MatchScoreCell({ value, active, stroked }: { value: number | undefined; active: boolean; stroked: boolean }) {
  const base: React.CSSProperties = {
    position: "relative",
    width: 52,
    height: 46,
    borderRadius: 10,
    flexShrink: 0,
  };
  const pip = stroked ? <StrokePip /> : null;
  if (active && value == null) {
    return (
      <span
        className="flex items-center justify-center"
        style={{
          ...base,
          border: "2px solid var(--color-bt-accent)",
          boxShadow: "0 0 0 3px rgba(45,212,191,0.12)",
          color: "var(--color-bt-accent)",
          fontSize: 24,
        }}
      >
        +{pip}
      </span>
    );
  }
  if (value != null) {
    return (
      <span
        className="flex items-center justify-center"
        style={{
          ...base,
          border: active ? "2px solid var(--color-bt-accent)" : "1px solid var(--color-bt-border)",
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          fontSize: 26,
          fontWeight: 700,
        }}
      >
        {value}
        {pip}
      </span>
    );
  }
  return (
    <span
      className="flex items-center justify-center"
      style={{
        ...base,
        border: "1.5px dashed var(--color-bt-border)",
        color: "var(--color-bt-border)",
        fontSize: 24,
      }}
    >
      +{pip}
    </span>
  );
}

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
