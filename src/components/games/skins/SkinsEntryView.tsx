"use client";

import { useState } from "react";
import { ChevronLeft, Table2, Check, Settings } from "lucide-react";
import { tallyGrouping, type SkinsOutcomeRow } from "@/lib/skins";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { OutcomeChoiceRow } from "../OutcomeChoiceRow";
import { HoleProgress, NavArrow, BottomCTA } from "../entryChrome";
import { UnsavedScoresBanner } from "../UnsavedScoresBanner";
import { ScoreSaveBadge } from "../ScoreSaveBadge";
import { SkinsPotBanner } from "./SkinsPotBanner";
import type { CellSaveState, Participant } from "../types";

/**
 * SkinsEntryView — record who won each hole of one grouping.
 *
 * ── A NEW view over existing parts, not a variant of MatchOutcomeEntryView ──
 *
 * That file assumes two sides in six independent places: `MatchGroupData`'s
 * a/b pair, three hardcoded choice rows, `HoleOutcomeResult`'s closed enum,
 * `DecidedHole`'s A-perspective W/L/H, `matchState`'s A/B leader, and a
 * `canFinish` built on close-out. Widening it would make `MatchGroupData`,
 * `HoleOutcomeResult`, `DecidedHole` and `matchState` all N-way — four shared
 * types that match play is the only correct consumer of.
 *
 * What IS reused, unchanged: `OutcomeChoiceRow` (already generic, already shared
 * by two callers so they cannot drift), `entryChrome`'s `HoleProgress` /
 * `NavArrow` / `BottomCTA`, `UnsavedScoresBanner`, the hole navigator and its
 * Par · Yds · Hdcp line, and the local-pick-then-OK commit contract.
 *
 * What is new: a choice LIST instead of three literals, a winner id instead of a
 * side enum, and the pot banner.
 *
 * ── There is no close-out ─────────────────────────────────────────────────
 *
 * Match play can end on 15 because a lead can become unassailable. Every skins
 * hole pays, so all of them are played — `canFinish` is completeness alone.
 *
 * Persistence-agnostic (CLAUDE.md #7): all data by prop, all changes by
 * callback. No tRPC, no DB, no auth.
 */
export interface SkinsEntryViewProps {
  gameName: string;
  units: { label: string; par?: number | null; yardage?: number | null; strokeIndex?: number | null }[];
  /** The grouping being scored — its id, its name, and the players in it. */
  grouping: { id: string; name: string; players: Participant[] };
  /** This grouping's recorded holes. The fold runs over them on every render. */
  rows: SkinsOutcomeRow[];
  onChange: (groupingId: string, hole: number, result: "won" | "tied", winnerId: string | null) => void;
  onClear?: (groupingId: string, hole: number) => void;
  currentHole?: number;
  onHoleChange?: (hole: number) => void;
  onFinish?: () => void;
  onBack?: () => void;
  onOpenGrid?: () => void;
  onConfig?: () => void;
  subtitle?: string;
  finishLabel?: string;
  finishSubtext?: string;
  meId?: string;
  glorious?: GloriousConfig;
  /** cellKey (`groupingId:hole`) → in-flight save state, from the outbox. */
  saveStatus?: Record<string, CellSaveState>;
  /** cellKey → the server's own sentence for a terminally refused cell (#1230). */
  refusals?: Record<string, string>;
  onRetryCell?: (groupingId: string, hole: number) => void;
  banner?: React.ReactNode;
  hideHeader?: boolean;
  /** Not permitted to record — a viewer without rights, or a posted game. */
  readOnly?: boolean;
}

/** `groupingId:hole` — the same key the outbox and the RPC's row id use, so the
 *  three cannot address a cell differently. */
export function skinsCellKey(groupingId: string, hole: number): string {
  return `${groupingId}:${hole}`;
}

/** The local pick, before OK commits it. `tied` carries no winner, by
 *  construction rather than by convention — the same pairing the table's CHECK
 *  enforces, so an impossible selection is not representable here either. */
type LocalPick = { hole: number } & (
  | { result: "won"; winnerId: string }
  | { result: "tied"; winnerId: null }
);

export function SkinsEntryView({
  gameName,
  units,
  grouping,
  rows,
  onChange,
  onClear,
  currentHole,
  onHoleChange,
  onFinish,
  onBack,
  onOpenGrid,
  onConfig,
  subtitle,
  finishLabel = "Finish",
  // Empty by default. `Finish` on a skins card means "this GROUP is done" and
  // hands back to the board; it banks nothing, because one grouping finishing is
  // not the game finishing. The borrowed "Saves results" caption described
  // stroke's old game-level Finish and was the reason this one was wired to a
  // finalize.
  finishSubtext = "",
  meId,
  glorious = NO_GLORIOUS,
  saveStatus = {},
  refusals,
  onRetryCell,
  banner,
  hideHeader = false,
  readOnly = false,
}: SkinsEntryViewProps) {
  const [holeInternal, setHoleInternal] = useState(currentHole ?? 1);
  const [localPick, setLocalPick] = useState<LocalPick | null>(null);

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

  // The fold, over the WHOLE grouping — every pot in front of this hole depends
  // on every tie behind it, so there is nothing to compute incrementally.
  const tally = tallyGrouping(grouping.id, rows, units.length, glorious);
  const line = tally.lines[hole - 1];

  const committed = rows.find((r) => r.hole === hole);
  const local = localPick?.hole === hole ? localPick : null;
  // The local pick shows over the committed one, so a correction reads back
  // before OK writes it.
  const selectedWinner = local ? local.winnerId : committed?.result === "won" ? committed.winnerId : null;
  const selectedTied = local ? local.result === "tied" : committed?.result === "tied";
  const anySelected = selectedWinner != null || selectedTied;

  const cellKey = skinsCellKey(grouping.id, hole);
  const cellSaveState = saveStatus[cellKey];
  const errorCount = Object.values(saveStatus).filter((s) => s === "error").length;
  const savingCount = Object.values(saveStatus).filter((s) => s === "saving").length;
  const retryAll = () => {
    for (const [k, s] of Object.entries(saveStatus)) {
      if (s !== "error") continue;
      const i = k.lastIndexOf(":");
      onRetryCell?.(k.slice(0, i), Number(k.slice(i + 1)));
    }
  };

  const playedHoleNumbers = tally.lines.filter((l) => l.status !== "unplayed").map((l) => l.hole);
  // No close-out: every hole pays, so finishing means every hole is in.
  const canFinish = playedHoleNumbers.length === units.length && units.length > 0;

  const dirty =
    local != null &&
    (committed == null ||
      committed.result !== local.result ||
      (committed.winnerId ?? null) !== local.winnerId);

  const commit = () => {
    if (!local || !dirty) return;
    onChange(grouping.id, hole, local.result, local.winnerId);
    setLocalPick(null);
  };
  const reset = () => {
    setLocalPick(null);
    if (committed) onClear?.(grouping.id, hole);
  };

  const pickWinner = (winnerId: string) => setLocalPick({ hole, result: "won", winnerId });
  const pickTied = () => setLocalPick({ hole, result: "tied", winnerId: null });

  const finishReason =
    errorCount > 0
      ? "Some holes didn’t save — retry before finishing"
      : savingCount > 0
        ? "Saving…"
        : undefined;

  /**
   * "Clear hole", not "Reset" — the same split `MatchOutcomeEntryView` makes and
   * for the same reason. On the commit bar the word discards a pick that has not
   * left the device; here it deletes a row that is in the database and re-folds
   * every pot in front of it.
   */
  const clearHoleAction = {
    label: "Clear hole",
    onClick: reset,
    ariaLabel: "Clear this hole's recorded result",
    testId: "skins-clear-hole",
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
              {subtitle ?? `${grouping.name} · Hole ${hole} of ${units.length}`}
            </div>
          </div>
          {onConfig ? (
            <button onClick={onConfig} aria-label="Configuration" className="flex h-9 w-9 items-center justify-center">
              <Settings size={19} style={{ color: "var(--color-bt-text-dim)" }} />
            </button>
          ) : (
            <div className="h-9 w-9" />
          )}
        </header>
      )}

      <UnsavedScoresBanner count={errorCount} onRetry={retryAll} refusals={refusals} />
      {banner}

      {/* Hole navigation — the same chrome stroke, rack and match entry share. */}
      <div className="flex shrink-0 items-center justify-between" style={{ padding: "10px 16px 6px" }}>
        <NavArrow dir="prev" disabled={hole <= 1} onClick={() => goHole(hole - 1)} />
        <div className="flex flex-col items-center" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-bt-text)" }}>
            Hole {label}
          </div>
          <div className="flex items-center justify-center" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {[
                unit?.par != null ? `Par ${unit.par}` : null,
                unit?.yardage != null ? `${unit.yardage} yds` : null,
                // The stroke index is the ONE handicap surface this format has.
                // Nothing is computed from it — the group applies it in their
                // heads before deciding who won — so showing it is not
                // decoration, it is the input.
                unit?.strokeIndex != null ? `Hdcp ${unit.strokeIndex}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
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
          <HoleProgress count={units.length} currentHole={hole} completed={playedHoleNumbers} />
        </div>
        <NavArrow dir="next" disabled={hole >= units.length} onClick={() => goHole(hole + 1)} />
      </div>

      <SkinsPotBanner
        line={line}
        isFinalHole={hole === units.length}
        nextHoleLabel={units[hole]?.label}
      />

      {/* The choice LIST — one row per player, then Tied. Ordered players-first
          because that is what is tapped: a hole is usually won. */}
      <div className="shrink-0" style={{ padding: "0 16px 8px" }}>
        <div className="flex flex-col" style={{ gap: 9 }}>
          {grouping.players.map((p) => (
            <OutcomeChoiceRow
              key={p.id}
              selected={selectedWinner === p.id}
              dim={anySelected && selectedWinner !== p.id}
              color={p.color}
              avatarName={p.name}
              avatarIcon={p.avatarIcon}
              label={p.name}
              sub={p.id === meId ? "You" : undefined}
              onClick={() => pickWinner(p.id)}
              testId={`skins-choice-${p.id}`}
              saveState={selectedWinner === p.id ? cellSaveState : undefined}
              onRetry={() => onRetryCell?.(grouping.id, hole)}
              disabled={readOnly}
            />
          ))}
          <OutcomeChoiceRow
            selected={selectedTied}
            dim={anySelected && !selectedTied}
            neutral
            label="Tied"
            // Says what happens next rather than restating the word, and it is
            // the only place the consequence is stated before it is chosen.
            sub={
              hole === units.length
                ? "Nobody is paid — the pot is gone"
                : `Carries ${line.pot} to hole ${units[hole]?.label ?? hole + 1}`
            }
            onClick={pickTied}
            testId="skins-choice-tied"
            saveState={selectedTied ? cellSaveState : undefined}
            onRetry={() => onRetryCell?.(grouping.id, hole)}
            disabled={readOnly}
          />
        </div>
      </div>

      {/* Pushes the bottom control to the viewport bottom (CLAUDE.md #14 — a
          content-anchored CTA falls below the fold on a tall hole). */}
      <div className="flex-1" />

      {readOnly ? null : dirty || !committed ? (
        <SkinsCommitBar canReset={anySelected} onReset={reset} canOk={dirty} onOk={commit} />
      ) : canFinish ? (
        <BottomCTA
          label={finishLabel}
          icon
          onClick={() => onFinish?.()}
          disabled={errorCount + savingCount > 0}
          subtext={finishReason ?? finishSubtext}
          secondary={clearHoleAction}
        />
      ) : hole < units.length ? (
        <BottomCTA
          label={`Hole ${units[hole]?.label ?? hole + 1} ›`}
          onClick={() => goHole(hole + 1)}
          disabled={cellSaveState === "saving" || cellSaveState === "error"}
          secondary={clearHoleAction}
        />
      ) : (
        // The last hole of a round that cannot finish. No advance to offer, but a
        // recorded hole is still clearable — otherwise this is the one dead end
        // on the screen.
        <BottomCTA label="Clear hole" onClick={reset} />
      )}
    </div>
  );
}

/** The pre-commit bar — Reset (left) + OK (right), the same pairing match
 *  play's outcome entry and the stroke keypad use. Anchored to the viewport
 *  bottom as the last flex child. */
function SkinsCommitBar({
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
          data-testid="skins-reset"
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
          aria-label="Confirm result"
          data-testid="skins-ok"
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

/** Re-exported so a caller can render the badge in its own chrome without
 *  reaching into the entry view. */
export { ScoreSaveBadge };
