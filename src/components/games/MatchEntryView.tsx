"use client";

import { useState } from "react";
import { ChevronLeft, Table2 } from "lucide-react";
import { buildDecided, matchState, strokeHoles } from "@/lib/matchPlay";
import { NO_GLORIOUS, isGloriousHole, type GloriousConfig } from "@/lib/gloriousHoles";
import { StrokeKeypad } from "./StrokeKeypad";
import { MatchCard } from "./MatchCard";
import type { SidePlayer } from "./MatchSides";
import { HoleProgress, NavArrow, BottomCTA } from "./entryChrome";
import { Avatar } from "@/components/Avatar";
import { GolfChip } from "./GolfChip";
import { ScoreSaveBadge } from "./ScoreSaveBadge";
import { UnsavedScoresBanner } from "./UnsavedScoresBanner";
import { golfWord } from "./golfScore";
import { strokeIndexOf } from "@/lib/strokePlayConfig";
import {
  parseScoreCellKey,
  scoreCellKey,
  unconfirmedOnHole,
  unconfirmedCount,
  type ScoreUnit,
  type Participant,
  type ScoreValues,
  type CellSaveState,
  type SaveStatusMap,
} from "./types";

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
  /** Per-side player lists (Match-Play Parity item 3) — one entry for a 1v1,
   *  two for a 2v2 — so surfaces can render the shared stacked `SideChips`
   *  renderer instead of the collapsed "R & B" single-line name on `a`/`b`.
   *  Optional: absent (or single-entry) falls back to the compact single name. */
  aPlayers?: SidePlayer[];
  bPlayers?: SidePlayer[];
  strokesA: number; // handicap strokes A receives (usually 0)
  strokesB: number;
  /** Team colors (Slice D) — the strip tints the leader in the side's team
   *  color. Omit for the neutral standalone (non-team) default. */
  leftColor?: string;
  rightColor?: string;
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
  /** Per-cell save state (Connectivity Layer 1) — drives the cell badges + the
   *  unsaved-scores banner. Keyed by `${participantId}:${unitLabel}`. */
  saveStatus?: SaveStatusMap;
  /** Re-fire the save for a flagged cell. */
  onRetryCell?: (participantId: string, unitLabel: string) => void;
  /** #550: hide the view's own header — as a panel the app bar carries
   *  back/title + the scorecard action, so this second header is dropped. */
  hideHeader?: boolean;
  /** Glorious Finishing Holes weight (2× the last N) for the live match state.
   *  Omit for standard match play. */
  glorious?: GloriousConfig;
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
  saveStatus = {},
  onRetryCell,
  hideHeader = false,
  glorious = NO_GLORIOUS,
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
  // The ONE predicate — `hole` here IS the engine position (units[hole-1] is the
  // current unit), so no label-parsing/re-derivation needed.
  const holeIsGlorious = isGloriousHole(hole, glorious);

  // The course's per-hole stroke index (from the snapshot units). Threading it
  // into the live display makes pips + the live net land on the COURSE's
  // handicap holes — matching the server's scoring — instead of falling back to
  // sequential "first N holes" (the bug: strokeHoles/buildDecided were called
  // with no index here, while the board + server pass it).
  const scIndex = strokeIndexOf(units);

  // Opt-in "play it out" for decided matches (dead holes become editable again).
  const [playOut, setPlayOut] = useState<Set<string>>(new Set());

  // Per-match derived state (from the SHARED frozen matchState).
  const groups = matches.map((m) => {
    const decided = buildDecided(values[m.a.id] ?? {}, values[m.b.id] ?? {}, m.strokesA, m.strokesB, scIndex, units.length);
    const st = matchState(decided, units.length, glorious);
    const strokeHolesA = strokeHoles(m.strokesA, scIndex);
    const strokeHolesB = strokeHoles(m.strokesB, scIndex);
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
  // The cell just committed — gets the one-shot eagle/birdie celebration.
  const [lastCommit, setLastCommit] = useState<{ hole: number; pid: string } | null>(null);
  const interactiveHere = allParticipants.filter((p) => isInteractive(p.id, hole));
  const activePid =
    override && override.hole === hole && interactiveHere.some((p) => p.id === override.pid)
      ? override.pid
      : (interactiveHere.find((p) => valueFor(p.id, label) == null)?.id ?? null);
  const activeParticipant = allParticipants.find((p) => p.id === activePid) ?? null;
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

  // ── Confirmation gate (Spec 1a — honest advance) ──────────────────────────
  // Gate on the cells that must be scored THIS hole (interactive, non-dead ones).
  const holeGate = unconfirmedOnHole(saveStatus, interactiveHere.map((p) => p.id), label);
  const gameGate = unconfirmedCount(saveStatus);
  const advanceReason = holeGate.errored > 0
    ? `${holeGate.errored} score${holeGate.errored > 1 ? "s" : ""} didn’t save — retry above`
    : holeGate.saving > 0
      ? "Saving scores…"
      : undefined;
  const finishReason = gameGate.errored > 0
    ? `${gameGate.errored} score${gameGate.errored > 1 ? "s" : ""} didn’t save — retry before finishing`
    : gameGate.saving > 0
      ? "Saving scores…"
      : undefined;

  // The board reflects a hole only once it's confirmed: while the keypad is open
  // on the current hole (activePid set), exclude that hole from the match-state
  // computation so a tentative tap can't flash a wrong "X UP"/win before the ✓.
  const editing = activePid != null;
  const committedGross = (pid: string) => {
    const v = values[pid] ?? {};
    if (!editing) return v;
    const { [label]: _omit, ...rest } = v;
    return rest;
  };

  // Progress + completion (dead holes don't require scores).
  const holeComplete = (h: number, l: string) => requiredOn(h, l).length === 0;
  const completedHoleNumbers = units
    .map((u, i) => (holeComplete(i + 1, u.label) ? i + 1 : 0))
    .filter((n) => n > 0);
  const currentComplete = holeComplete(hole, label);
  const allHolesComplete = completedHoleNumbers.length === units.length && units.length > 0;
  const allMatchesOver = groups.every((g) => g.st.over);
  const canFinish = allMatchesOver || allHolesComplete;

  const par = unit?.par;
  const commit = (v: number) => {
    if (!activePid) return;
    onChange(activePid, label, v);
    setLastCommit({ hole, pid: activePid });
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
      {/* App bar — suppressed as a panel (#550): the shared TopNav carries
          back/title + the scorecard action. Kept for standalone routes (no bar). */}
      {!hideHeader && (
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
          {/* Scorecard relocated to the hole-navigator meta line (thumb zone),
              matching stroke/rack — spacer keeps the title centered (Wave 2). */}
          <div className="h-9 w-9" />
        </header>
      )}

      {/* Unsaved-scores safety net (Connectivity Layer 1) */}
      <UnsavedScoresBanner count={errorCount} onRetry={retryAll} />

      {/* Match board(s) — pinned at the top, above the hole selector */}
      <div className="shrink-0" style={{ padding: "12px 12px 0" }}>
        {groups.map((g) => {
          const { m } = g;
          // Board state excludes the in-progress hole (computes on ✓, not on tap).
          const boardDecided = buildDecided(committedGross(m.a.id), committedGross(m.b.id), m.strokesA, m.strokesB, scIndex, units.length);
          const st = matchState(boardDecided, units.length, glorious);
          const winner = st.leader === "A" ? m.a : st.leader === "B" ? m.b : null;
          const loser = st.leader === "A" ? m.b : st.leader === "B" ? m.a : null;
          return (
            <div key={m.matchId} style={{ marginBottom: 8 }}>
              <MatchCard
                a={m.a}
                b={m.b}
                aPlayers={m.aPlayers}
                bPlayers={m.bPlayers}
                results={boardDecided}
                glorious={glorious}
                label={m.label}
                holeCount={units.length}
                youId={meId}
                leftColor={m.leftColor}
                rightColor={m.rightColor}
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

      {/* Hole navigation — header parity with stroke/rack (Wave 2): tightened
          padding + a single meta line (Par · Yds · Hdcp) with the scorecard
          button relocated inline (thumb zone), not on the MatchCard band. */}
      <div className="flex shrink-0 items-center justify-between" style={{ padding: "10px 16px 6px" }}>
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          <div className="flex items-center justify-center" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {[
                par != null ? `Par ${par}` : null,
                unit?.yardage != null ? `${unit.yardage} yds` : null,
                unit?.strokeIndex != null ? `Hdcp ${unit.strokeIndex}` : null,
              ].filter(Boolean).join(" · ")}
            </span>
            {onOpenGrid && (
              <button
                type="button"
                onClick={onOpenGrid}
                aria-label="Scorecard"
                data-testid="entry-scorecard"
                className="inline-flex shrink-0 items-center justify-center rounded-md"
                style={{ width: 28, height: 28, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
              >
                <Table2 size={15} style={{ color: "var(--color-bt-accent)" }} />
              </button>
            )}
          </div>
          <HoleProgress count={units.length} currentHole={hole} completed={completedHoleNumbers} />
        </div>
        <NavArrow dir="next" disabled={hole >= units.length} onClick={() => goHole(hole + 1)} />
      </div>

      {/* Glorious banner — announces (unlike the scorecard's quiet diamond/wash),
          shown ONLY on a glorious hole, pure config+format (no score dependency). */}
      {holeIsGlorious && (
        <div
          data-testid="glorious-entry-banner"
          style={{
            margin: "0 16px 10px",
            padding: "8px 12px",
            borderRadius: 10,
            textAlign: "center",
            background: "var(--color-bt-glorious-faint)",
            border: "1px solid var(--color-bt-glorious-border)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-bt-glorious)" }}>
            Glorious Finishing Hole · Worth Double
          </span>
        </div>
      )}

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
                par={par}
                celebrate={lastCommit?.pid === m.a.id && lastCommit?.hole === hole}
                saveState={saveStatus[scoreCellKey(m.a.id, label)]}
                onRetry={() => onRetryCell?.(m.a.id, label)}
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
                par={par}
                celebrate={lastCommit?.pid === m.b.id && lastCommit?.hole === hole}
                saveState={saveStatus[scoreCellKey(m.b.id, label)]}
                onRetry={() => onRetryCell?.(m.b.id, label)}
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
        <BottomCTA
          label={finishLabel}
          icon
          onClick={() => onFinish?.()}
          disabled={gameGate.total > 0}
          subtext={finishReason ?? finishSubtext}
        />
      ) : currentComplete && hole < units.length ? (
        <BottomCTA
          label={`Hole ${units[hole]?.label ?? hole + 1} ›`}
          onClick={() => goHole(hole + 1)}
          disabled={holeGate.blocked}
          subtext={advanceReason}
        />
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
  par,
  celebrate,
  last,
  saveState,
  onRetry,
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
  par?: number;
  celebrate?: boolean;
  last?: boolean;
  saveState?: CellSaveState;
  onRetry?: () => void;
}) {
  const v = valueFor(player.id, label);
  const stroked = (isA ? group.strokeHolesA : group.strokeHolesB).has(hole);

  // Score entry only cares about THIS hole — never the match state. Awaiting a
  // score until one is entered; then the golf word for the GROSS, and on a
  // stroke hole the bold NET word (what counts): "Bogey · net Par".
  let subtitle: React.ReactNode = "Awaiting score";
  if (v != null && par != null) {
    const gw = golfWord(v, par);
    subtitle = stroked ? (
      <>
        {gw} · net <span style={{ fontWeight: 700, color: "var(--color-bt-text)" }}>{golfWord(v - 1, par)}</span>
      </>
    ) : (
      gw
    );
  } else if (v != null) {
    subtitle = stroked ? `Gross ${v} · net ${v - 1}` : "";
  }

  return (
    // role=button (not <button>) so the per-cell Retry button can nest without
    // invalid button-in-button markup.
    <div
      role="button"
      tabIndex={dead ? -1 : 0}
      aria-disabled={dead}
      onClick={dead ? undefined : onTap}
      className="flex w-full items-center gap-3 text-left"
      style={{
        height: 62,
        padding: "0 14px 0 0",
        cursor: dead ? "default" : "pointer",
        opacity: dead ? 0.55 : 1,
        background: active ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
        borderTop: last ? "1px solid var(--color-bt-subtle-border)" : undefined,
        borderLeft: `3px solid ${active ? "var(--color-bt-accent)" : "transparent"}`,
        paddingLeft: 11,
      }}
    >
      <Avatar name={player.name} avatarIcon={player.avatarIcon} teamColor={player.color} sizePx={34} />
      <div className="min-w-0 flex-1">
        <span style={{ fontSize: 17, fontWeight: 500, color: "var(--color-bt-text)" }}>
          {player.name}
          {isMe && <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}> (you)</span>}
        </span>
        <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
      </div>
      <ScoreSaveBadge state={saveState} onRetry={onRetry} />
      <MatchScoreCell value={v} active={active} stroked={stroked} par={par} celebrate={celebrate} />
    </div>
  );
}

function MatchScoreCell({
  value,
  active,
  stroked,
  par,
  celebrate,
}: {
  value: number | undefined;
  active: boolean;
  stroked: boolean;
  par?: number;
  celebrate?: boolean;
}) {
  const base: React.CSSProperties = {
    position: "relative",
    width: 52,
    height: 46,
    borderRadius: 10,
    flexShrink: 0,
  };
  const pip = stroked ? <StrokePip /> : null;
  // Committed (not being edited) + par known → color the GROSS with the golf
  // shape; the stroke pip stays in the corner (net is stated in the subtitle).
  if (!active && value != null && par != null) {
    return (
      <span className="flex items-center justify-center" style={{ ...base }}>
        <GolfChip value={value} par={par} size={42} fontSize={22} celebrate={celebrate} />
        {pip}
      </span>
    );
  }
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
