"use client";

import { useState } from "react";
import { ChevronLeft, Table2, Equal, Check } from "lucide-react";
import { buildDecidedFromOutcomes, matchState, outcomeBottomState, type HoleOutcomeResult } from "@/lib/matchPlay";
import { NO_GLORIOUS, isGloriousHole, type GloriousConfig } from "@/lib/gloriousHoles";
import { MatchCard } from "./MatchCard";
import { HoleProgress, NavArrow, BottomCTA } from "./entryChrome";
import { Avatar } from "@/components/Avatar";
import { UnsavedScoresBanner } from "./UnsavedScoresBanner";
import { ScoreSaveBadge } from "./ScoreSaveBadge";
import {
  unconfirmedOnHole,
  unconfirmedCount,
  outcomeCellKey,
  type OutcomeValues,
  type SaveStatusMap,
  type CellSaveState,
} from "./types";
import type { MatchGroupData } from "./MatchEntryView";

/**
 * MatchOutcomeEntryView — the hole-outcome-entry counterpart to `MatchEntryView`
 * (Refactor B2, built to `hole_outcome_entry_mockup.html`). Reuses the SAME
 * scorecard chrome verbatim — app bar, `MatchCard` state band, hole nav, par,
 * Glorious banner, the unsaved-writes banner, the confirmation-gated bottom CTA
 * (`entryChrome`) — only the ENTRY ZONE differs: three stacked player-row-styled
 * choice buttons (side A won / Halved / side B won), tap-to-select, team-colored,
 * ✓, "Reset hole." No number pad — one tap records the whole hole.
 *
 * `strokesA`/`strokesB` on `MatchGroupData` are ignored here (unused — no
 * handicaps in outcome mode; the recorded outcome IS the decision).
 */
interface MatchOutcomeEntryViewProps {
  gameName: string;
  units: { label: string; par?: number }[];
  match: MatchGroupData;
  values: OutcomeValues;
  onChange: (matchId: string, hole: string, result: HoleOutcomeResult) => void;
  onClear?: (matchId: string, hole: string) => void;
  currentHole?: number;
  onHoleChange?: (hole: number) => void;
  onFinish?: () => void;
  onBack?: () => void;
  onOpenGrid?: () => void;
  subtitle?: string;
  finishLabel?: string;
  finishSubtext?: string;
  meId?: string;
  saveStatus?: SaveStatusMap;
  onRetryCell?: (matchId: string, hole: string) => void;
  hideHeader?: boolean;
  glorious?: GloriousConfig;
}

export function MatchOutcomeEntryView({
  gameName,
  units,
  match: m,
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
}: MatchOutcomeEntryViewProps) {
  const [holeInternal, setHoleInternal] = useState(currentHole ?? 1);
  // Item 1: the pending LOCAL selection, hole-scoped so it auto-clears when the
  // hole changes (no effect needed — read only when localPick.hole === hole).
  // Tapping a choice sets this; nothing commits until OK.
  const [localPick, setLocalPick] = useState<{ hole: number; result: HoleOutcomeResult } | null>(null);
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
  const par = unit?.par;
  const holeIsGlorious = isGloriousHole(hole, glorious);

  const outcomeRows = Object.entries(values[m.matchId] ?? {}).map(([h, result]) => ({ hole: Number(h), result }));
  const decided = buildDecidedFromOutcomes(outcomeRows);
  const st = matchState(decided, units.length, glorious);
  const winner = st.leader === "A" ? m.a : st.leader === "B" ? m.b : null;
  const loser = st.leader === "A" ? m.b : st.leader === "B" ? m.a : null;

  // Item 1 — local-until-OK selection model (mirrors stroke/rack: pick is local,
  // OK commits). `committedForHole` is what's persisted; `localForHole` is the
  // uncommitted pick for THIS hole; `selected` (what the choice rows highlight)
  // shows the local pick over the committed one so you can change your mind
  // before OK. `dirty` = there's a new pick to commit.
  const committedForHole = values[m.matchId]?.[label] as HoleOutcomeResult | undefined;
  const localForHole = localPick?.hole === hole ? localPick.result : undefined;
  const selected = localForHole ?? committedForHole;

  // ── Save status (Connectivity Layer 1 — same discipline as score entry) ────
  const errorCount = Object.values(saveStatus).filter((s) => s === "error").length;
  const retryAll = () => {
    for (const [k, s] of Object.entries(saveStatus)) {
      if (s !== "error") continue;
      const { matchId, holeNumber } = parseKey(k);
      onRetryCell?.(matchId, String(holeNumber));
    }
  };
  const holeGate = unconfirmedOnHole(saveStatus, [m.matchId], label);
  const gameGate = unconfirmedCount(saveStatus);
  // Next Hole's gate is unchanged (still held until confirmed) — but unlike
  // score entry, one tap both completes AND saves the hole here, so the CTA
  // would otherwise render already-disabled with a "Saving…" caption on
  // basically every hole, reflowing the panel. The per-choice ScoreSaveBadge
  // below carries that feedback instead (in place, no new row); the CTA no
  // longer needs its own subtext for the routine save.
  const cellSaveState = saveStatus[outcomeCellKey(m.matchId, hole)];
  const retryThisHole = () => onRetryCell?.(m.matchId, label);
  const finishReason = gameGate.errored > 0
    ? "Some outcomes didn’t save — retry before finishing"
    : gameGate.saving > 0
      ? "Saving…"
      : undefined;

  // Progress + completion — a hole is complete once it HAS a recorded outcome
  // (unlike stroke entry, which needs both players; one tap decides the whole
  // hole here).
  const completedHoleNumbers = units
    .map((u, i) => (values[m.matchId]?.[u.label] != null ? i + 1 : 0))
    .filter((n) => n > 0);
  // Next Hole gates on the COMMITTED outcome (not the local pick) — it appears
  // only after OK commits (via `committedForHole` in the bottom section),
  // mirroring stroke's post-confirm advance.
  const allHolesComplete = completedHoleNumbers.length === units.length && units.length > 0;
  const canFinish = st.over || allHolesComplete;

  const pick = (result: HoleOutcomeResult) => {
    // Item 1: pure local selection — ZERO server write, zero advance on tap.
    setLocalPick({ hole, result });
  };
  const commitPick = () => {
    // OK — commit the selected outcome via the existing outbox path (onChange
    // fires the durable write), exactly like stroke/rack's check. The Next Hole
    // CTA then appears over this control, gated until the save confirms.
    if (localForHole == null) return;
    onChange(m.matchId, label, localForHole);
    setLocalPick(null);
  };
  const reset = () => {
    // Reset (bottom-left) clears the selection — the local pick AND any
    // committed outcome for this hole.
    setLocalPick(null);
    onClear?.(m.matchId, label);
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
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
          <button onClick={onOpenGrid} aria-label="Scorecard grid" className="flex h-9 w-9 items-center justify-center">
            <Table2 size={20} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </header>
      )}

      <UnsavedScoresBanner count={errorCount} onRetry={retryAll} />

      {/* Match board — the SAME MatchCard score entry uses, fed from outcome-
          derived DecidedHole[] instead of gross-derived. */}
      <div className="shrink-0" style={{ padding: "12px 12px 0" }}>
        <MatchCard
          a={m.a}
          b={m.b}
          results={decided}
          glorious={glorious}
          label={m.label}
          holeCount={units.length}
          youId={meId}
          leftColor={m.leftColor}
          rightColor={m.rightColor}
          hideFormat
          onScorecard={onOpenGrid}
        />
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
          </div>
        )}
      </div>

      {/* Hole navigation — verbatim reuse of entryChrome. */}
      <div className="flex shrink-0 items-center justify-between" style={{ padding: "8px 16px 12px" }}>
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          {par != null && (
            <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
              Par {par}
            </div>
          )}
          <HoleProgress count={units.length} currentHole={hole} completed={completedHoleNumbers} />
        </div>
        <NavArrow dir="next" disabled={hole >= units.length} onClick={() => goHole(hole + 1)} />
      </div>

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

      {/* Entry zone — three stacked player-row-styled choices. No number pad;
          one tap records the whole hole. */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 16px 8px" }}>
        <p
          className="text-center"
          style={{ fontSize: 12, fontWeight: 600, color: "var(--color-bt-text-dim)", letterSpacing: "0.02em", margin: "2px 0 10px" }}
        >
          Who won this hole?
        </p>
        <div className="flex flex-col" style={{ gap: 9 }}>
          <Choice
            selected={selected === "side_a"}
            dim={selected != null && selected !== "side_a"}
            color={m.leftColor}
            avatarName={m.a.name}
            avatarIcon={m.a.avatarIcon}
            label={m.a.name}
            sub={selected === "side_a" ? "Won the hole" : undefined}
            onClick={() => pick("side_a")}
            testId="outcome-choice-a"
            saveState={selected === "side_a" ? cellSaveState : undefined}
            onRetry={retryThisHole}
          />
          <Choice
            selected={selected === "halved"}
            dim={selected != null && selected !== "halved"}
            neutral
            label="Halved"
            sub={selected === "halved" ? "Hole halved" : undefined}
            onClick={() => pick("halved")}
            testId="outcome-choice-halved"
            saveState={selected === "halved" ? cellSaveState : undefined}
            onRetry={retryThisHole}
          />
          <Choice
            selected={selected === "side_b"}
            dim={selected != null && selected !== "side_b"}
            color={m.rightColor}
            avatarName={m.b.name}
            avatarIcon={m.b.avatarIcon}
            label={m.b.name}
            sub={selected === "side_b" ? "Won the hole" : undefined}
            onClick={() => pick("side_b")}
            testId="outcome-choice-b"
            saveState={selected === "side_b" ? cellSaveState : undefined}
            onRetry={retryThisHole}
          />
        </div>
      </div>

      {/* Bottom controls — item 1, mirroring stroke/rack. The pure
          `outcomeBottomState` model decides: while a hole is being selected (a
          dirty local pick) or is still empty, the `commit` bar shows Reset (left)
          + OK/check (right); on OK the outcome commits (outbox) and the Next Hole
          / Finish CTA appears OVER this control, held until the save confirms
          (honest advance). A settled, committed hole shows the CTA directly. */}
      {(() => {
        const bottom = outcomeBottomState({
          committed: committedForHole,
          localPick: localForHole,
          canFinish,
          isLastHole: hole >= units.length,
        });
        switch (bottom.kind) {
          case "commit":
            return (
              <OutcomeCommitBar canReset={bottom.canReset} onReset={reset} canOk={bottom.canOk} onOk={commitPick} />
            );
          case "finish":
            return (
              <BottomCTA
                label={finishLabel}
                icon
                onClick={() => onFinish?.()}
                disabled={gameGate.total > 0}
                subtext={finishReason ?? finishSubtext}
              />
            );
          case "next":
            return (
              <BottomCTA
                label={`Hole ${units[hole]?.label ?? hole + 1} ›`}
                onClick={() => goHole(hole + 1)}
                disabled={holeGate.blocked}
              />
            );
          default:
            return null;
        }
      })()}
    </div>
  );
}

/** The pre-commit bottom bar (item 1) — Reset (left) + OK/check (right), the
 *  outcome-entry counterpart to the stroke keypad's Delete + Confirm. Anchored to
 *  the viewport bottom (last flex child) like the keypad. OK carries the same
 *  teal check treatment `BottomCTA`/`StrokeKeypad` use; both buttons dim when
 *  their action is unavailable (nothing to reset / no new pick to commit). */
function OutcomeCommitBar({
  canReset,
  onReset,
  canOk,
  onOk,
}: {
  canReset: boolean;
  onReset: () => void;
  canOk: boolean;
  onOk: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--color-bt-card-float)",
        borderTop: "1px solid var(--color-bt-border)",
        padding: "12px 16px 24px",
      }}
    >
      <div className="flex items-center" style={{ gap: 10 }}>
        <button
          type="button"
          onClick={canReset ? onReset : undefined}
          disabled={!canReset}
          aria-label="Reset hole"
          data-testid="outcome-reset"
          className="flex items-center justify-center transition-transform active:scale-[0.98] disabled:cursor-default"
          style={{
            height: 54,
            flex: "0 0 auto",
            padding: "0 22px",
            borderRadius: 12,
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            color: canReset ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
            fontSize: 15,
            fontWeight: 600,
            opacity: canReset ? 1 : 0.6,
          }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={canOk ? onOk : undefined}
          disabled={!canOk}
          aria-label="Confirm outcome"
          data-testid="outcome-ok"
          className="flex flex-1 items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:cursor-default"
          style={{
            height: 54,
            borderRadius: 12,
            background: canOk ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
            color: canOk ? "var(--color-bt-on-accent)" : "var(--color-bt-text-dim)",
            fontSize: 17,
            fontWeight: 600,
            opacity: canOk ? 1 : 0.75,
          }}
        >
          {canOk && <Check size={20} strokeWidth={2.2} />}
          OK
        </button>
      </div>
    </div>
  );
}

function parseKey(key: string): { matchId: string; holeNumber: number } {
  const i = key.indexOf(":");
  return { matchId: key.slice(0, i), holeNumber: Number(key.slice(i + 1)) };
}

/** One outcome choice — a player-row-styled button (avatar-left OR a neutral
 *  glyph for "Halved") + label + a trailing check-circle. Selected = team-colored
 *  wash + border + filled check (or teal for Halved); the other rows dim once
 *  something is picked. */
function Choice({
  selected,
  dim,
  color,
  neutral,
  avatarName,
  avatarIcon,
  label,
  sub,
  onClick,
  testId,
  saveState,
  onRetry,
}: {
  selected: boolean;
  dim: boolean;
  color?: string;
  neutral?: boolean;
  avatarName?: string;
  avatarIcon?: string | null;
  label: string;
  sub?: string;
  onClick: () => void;
  testId: string;
  /** In-flight save state for THIS choice's hole, only when it's the selected
   *  one (mirrors PlayerRow's inline `ScoreSaveBadge` — score entry's same
   *  feedback, in the same footprint, so the panel below never reflows). */
  saveState?: CellSaveState;
  onRetry?: () => void;
}) {
  const tint = neutral ? "var(--color-bt-accent)" : color ?? "var(--color-bt-accent)";
  // Only the transient states borrow the badge — once saved, this settles
  // back to the plain team-colored ✓ below (a "saved" badge would lose the
  // team-color meaning the solid check carries).
  const showBadge = saveState === "saving" || saveState === "error";
  return (
    // role=button (not <button>) so ScoreSaveBadge's error-state Retry button
    // can nest without invalid button-in-button markup — same pattern as
    // score entry's PlayerRow.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="flex w-full items-center gap-3 text-left transition-opacity"
      data-testid={testId}
      style={{
        padding: 14,
        borderRadius: 12,
        cursor: "pointer",
        background: selected ? `color-mix(in srgb, ${tint} 14%, transparent)` : "var(--color-bt-card)",
        border: `1.5px solid ${selected ? tint : "var(--color-bt-border)"}`,
        opacity: dim ? 0.5 : 1,
      }}
    >
      {neutral ? (
        <span
          className="flex flex-shrink-0 items-center justify-center"
          style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
        >
          <Equal size={14} />
        </span>
      ) : (
        <Avatar name={avatarName ?? label} avatarIcon={avatarIcon} teamColor={color} sizePx={30} />
      )}
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)", fontWeight: 600 }}>{sub}</div>}
      </div>
      {showBadge ? (
        <ScoreSaveBadge state={saveState} onRetry={onRetry} />
      ) : (
        <span
          className="flex flex-shrink-0 items-center justify-center"
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `2px solid ${selected ? tint : "var(--color-bt-border)"}`,
            background: selected ? tint : "transparent",
            color: selected ? "var(--color-bt-on-accent)" : "transparent",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          ✓
        </span>
      )}
    </div>
  );
}
