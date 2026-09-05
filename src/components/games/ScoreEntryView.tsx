"use client";

import { useState } from "react";
import { ChevronLeft, Table2, Settings } from "lucide-react";
import { computeStrokePlayStandings, netStrokeEntries, netStrokeEntriesByHole, stablefordEntries, type RawStrokeEntry } from "@/lib/strokePlay";
import { stablefordPoints, type StablefordRubric } from "@/lib/stableford";
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
  unconfirmedOnHole,
  unconfirmedCount,
  type ScoreUnit,
  type Participant,
  type ScoreValues,
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
  /** cellKey → the server's own sentence for a TERMINALLY refused cell (#1230).
   *  Passed straight to the banner, which uses it to explain the failure and to
   *  hide a Retry that could not work. Persistence-agnostic: this view takes it
   *  as a prop like every other piece of save state. */
  refusals?: Record<string, string>;
  /** Re-fire the save for a flagged cell. */
  onRetryCell?: (participantId: string, unitLabel: string) => void;
  /** Handicap stroke holes per participant (`{ [pid]: Set<unitLabel> }`) — a pip
   *  on each stroked cell, a net hint in the row subtitle, AND the basis for the
   *  running total + "Leading" badge, which score NET so this screen can't crown
   *  a different player than the standings do. Omit for formats with no handicap
   *  (stroke play / Quick Game) → net ≡ gross and nothing changes. Net = gross −
   *  1 on a stroked hole. */
  /**
   * STABLEFORD only: the game’s rubric. With it the running total becomes a
   * POINTS total and “Leading” means the HIGHEST — without it this strip crowns
   * the low scorer while the scorecard, the board and the banked result all
   * score points. Two surfaces disagreeing about one game, which is the shape
   * this whole feature keeps having to guard against.
   */
  rubric?: StablefordRubric | null;
  pips?: Record<string, Set<string>>;
  /** #550: hide the view's own header — as a panel the app bar carries
   *  back/title (+ the config gear). The scorecard affordance relocates to the
   *  right of the "Scores" strip (mirrors match's card-header placement). */
  hideHeader?: boolean;
  /**
   * A strip rendered directly under the app bar, above the hole navigator —
   * the slot Quick Play's side-bet tracker occupies. A NODE, not data: this
   * view knows nothing about money, and a round with no bets passes nothing,
   * so the surface is byte-identical to what it was before side bets existed.
   */
  banner?: React.ReactNode;
  /** Bottom-CTA subtext once every hole is filled (mirrors MatchEntryView's
   *  `finishSubtext`). Defaults to the stroke-play copy ("Finish" here calls
   *  games.finish, which really does save results). Rack passes "" — its
   *  "Finish" is pure navigation back to the hub (no mutation), so the generic
   *  "Saves results · shows final standings" line doesn't apply. A save/error
   *  reason (`finishReason`) always overrides this regardless. */
  finishSubtext?: string;
}

/**
 * A points figure with its unit, singular where it should be. "1 pts" is the
 * kind of small wrongness that makes a screen feel unfinished, and a Stableford
 * rubric hands out exactly one point often enough for it to be seen constantly.
 */
function ptsLabel(points: number): string {
  return `${points} ${points === 1 ? "pt" : "pts"}`;
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
  refusals,
  onRetryCell,
  pips,
  rubric = null,
  banner,
  hideHeader = false,
  finishSubtext = "Saves results · shows final standings",
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
  // Run on NET, via the SAME `netStrokeEntries` the persisted result uses — a
  // handicap game's running total and "Leading" badge otherwise rank on gross
  // while every standings surface ranks on net, so the entry screen crowns a
  // different player than the board (the illegibility that read as a
  // double-applied handicap). No handicaps / no `pips` → net ≡ gross and this is
  // byte-identical to summing gross directly.
  const rawEntries: RawStrokeEntry[] = [];
  for (const p of participants) {
    for (const u of units) {
      const v = valueFor(p.id, u.label);
      if (v != null) rawEntries.push({ participant_id: p.id, unit_label: u.label, value: v });
    }
  }
  const entries = netStrokeEntries(rawEntries, pips ?? {});
  /** Any stroke in play → the running total is a NET total and says so. */
  const anyStrokes = participants.some((p) => (pips?.[p.id]?.size ?? 0) > 0);
  const scoredIds = participants
    .filter((p) => Object.keys(values[p.id] ?? {}).length > 0)
    .map((p) => p.id);
  // Under Stableford the strip ranks POINTS, highest first — same rubric, same
  // shared functions the scorecard and the persisted result use, so the three
  // cannot disagree about who is leading.
  const parByHole = Object.fromEntries(units.map((u) => [u.label, u.par ?? 0]));
  const standings = rubric
    ? computeStrokePlayStandings(
        scoredIds,
        stablefordEntries(netStrokeEntriesByHole(rawEntries, pips ?? {}), parByHole, rubric),
        { scoring: "stableford" }
      )
    : computeStrokePlayStandings(scoredIds, entries);
  const standingById = new Map(standings.map((s) => [s.entityId, s]));
  const totalOf = (pid: string) => standingById.get(pid)?.rawScore ?? 0;
  /**
   * WHAT THIS HOLE WAS WORTH — the points for one player on one hole.
   *
   * The running total beside it answers "where am I", and a bucket name answers
   * "how did I play it", but neither says what the hole PAID. Under a rubric
   * where a blow-up stops costing past the floor, those come apart: a triple
   * and a quintuple read differently and score the same, and the row could not
   * tell you that.
   *
   * ── Two things it must not get wrong ────────────────────────────────────
   *
   * It is scored off the NET value, not the gross one shown in the keypad. A
   * stroked hole is worth its net bucket, which is exactly why the row already
   * prints "Bogey · net Par" — the points belong to the second word, not the
   * first.
   *
   * And it goes through `netStrokeEntriesByHole` + `stablefordPoints`, the same
   * two functions in the same order the running total above is built from,
   * rather than an inline `value - par` that would agree with them today. A
   * per-hole figure that disagreed with the total it sums into is worse than no
   * per-hole figure.
   *
   * `null` for a Traditional game (no rubric), an unscored cell, or a hole with
   * no par in the snapshot — the last matching `stablefordEntries`, which skips
   * such a hole rather than scoring it against a par of 0.
   */
  const holePointsOf = (pid: string, unitLabel: string, unitPar: number | null | undefined) => {
    if (!rubric || unitPar == null) return null;
    const gross = valueFor(pid, unitLabel);
    if (gross == null) return null;
    const [netted] = netStrokeEntriesByHole(
      [{ participant_id: pid, unit_label: unitLabel, value: gross }],
      pips ?? {}
    );
    return netted ? stablefordPoints(netted.value - unitPar, rubric) : null;
  };
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

  // ── Confirmation gate (Spec 1a — honest advance) ──────────────────────────
  // Never advance past / finish over scores that aren't CONFIRMED on the server.
  const participantIds = participants.map((p) => p.id);
  const holeGate = unconfirmedOnHole(saveStatus, participantIds, label);
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

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      {/* ── App bar — suppressed as a panel (#550): the shared TopNav carries
          back/title (+ the config gear published by the parent). Kept for
          standalone routes (no bar). ── */}
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
              Hole {hole} of {units.length}
            </div>
          </div>
          <div className="flex items-center">
            {onConfig && (
              <button onClick={onConfig} aria-label="Configuration" className="flex h-9 w-9 items-center justify-center">
                <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
              </button>
            )}
            {/* Scorecard now lives in the hole-navigator meta line (thumb zone),
                not this hard-to-reach top-right corner — one location for both the
                panel and standalone-route chrome (Wave 2). */}
          </div>
        </header>
      )}

      {/* ── Unsaved-scores safety net (Connectivity Layer 1) ── */}
      <UnsavedScoresBanner count={errorCount} onRetry={retryAll} refusals={refusals} />
      {banner}

      {/* ── Hole navigation ── (Wave 2: the redundant SCORES summary strip was
          removed — each player's running total now shows on their own row — and
          the meta line gained Yards + the relocated scorecard button, tightened.) */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ padding: "10px 16px 6px" }}
      >
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          {/* Meta line: Par · Yards · Hdcp · [scorecard icon]. Yards/Hdcp only
              when the game has a course/tee snapshot; the scorecard button is
              icon-only (relocated here from the app bar — thumb zone). */}
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

      {/* ── Player rows ── */}
      <div className="shrink-0">
        {participants.map((p) => {
          const active = p.id === activePid;
          const v = valueFor(p.id, label);
          const total = totalOf(p.id);
          // "No scores yet" keys on HAVING a score, not on a 0 total: a net total
          // of 0 is reachable (an ace on a stroked hole) where a gross one wasn't.
          const hasAnyScore = Object.keys(values[p.id] ?? {}).length > 0;
          const lead = isLeading(p.id);
          const done = doneCount(p.id) === units.length;
          // Handicap: does this player get a stroke on THIS hole? (course index)
          const stroked = pips?.[p.id]?.has(label) ?? false;
          const holePts = holePointsOf(p.id, label, par);
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
                  {/* Wave 2: the running total now shows on EVERY row (it used to
                      live only in the removed SCORES strip, or on the row only
                      while the current hole was unscored). Total leads; the hole's
                      golf word (or "Leading") follows, keeping its own color. */}
                  <div style={{ fontSize: 13 }}>
                    {!hasAnyScore ? (
                      <span style={{ fontWeight: 400, color: "var(--color-bt-text-dim)" }}>No scores yet</span>
                    ) : (
                      <>
                        <span style={{ fontWeight: 400, color: lead ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)" }}>
                          {total} {rubric ? "pts" : anyStrokes ? "net" : "total"}
                        </span>
                        {par != null && v != null && golfWord(v, par) ? (
                          <span style={{ fontWeight: 600, color: GOLF_STYLE[golfResult(v, par)!].fg }}>
                            {" · "}
                            {/* Gross and net are named independently. Either can be
                                unnamed (past ±3), in which case that half is simply
                                omitted rather than printed as a bucket's word. */}
                            {stroked && golfWord(v - 1, par)
                              ? `${golfWord(v, par)} · net ${golfWord(v - 1, par)}`
                              : golfWord(v, par)}
                            {/* What the hole PAID, after the word that earned it —
                                so a stroked row reads "Bogey · net Par · 3 pts"
                                and the points sit against the net word they are
                                actually scored from. Same colour, because the word
                                and its value are one fact about one hole. */}
                            {holePts != null && ` · ${ptsLabel(holePts)}`}
                          </span>
                        ) : holePts != null && par != null && v != null ? (
                          /* SCORED, but past ±3 so golf has no name worth printing
                             (`golfWord` returns null on purpose). The points still
                             exist, and this is the hole where "what was that worth?"
                             matters MOST — a rubric's whole point is that a blow-up
                             stops costing, and the row used to say nothing at all
                             here. The signed differential stands in for the name,
                             which is the fallback `bucketLabel` already uses. */
                          <span style={{ fontWeight: 600, color: "var(--color-bt-text-dim)" }}>
                            {` · ${v - par > 0 ? "+" : ""}${v - par} · ${ptsLabel(holePts)}`}
                          </span>
                        ) : lead ? (
                          <span style={{ fontWeight: 600, color: "var(--color-bt-place-1-text)" }}> · Leading</span>
                        ) : null}
                      </>
                    )}
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
        <BottomCTA
          label="Finish"
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

