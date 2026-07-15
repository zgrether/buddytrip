"use client";

import { useState } from "react";
import { Hash, X } from "lucide-react";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { Stepper } from "@/components/games/Stepper";
import { MatchupChips, type SidePlayer } from "@/components/games/MatchSides";
import { evenShare } from "@/lib/pointsDistribution";

/**
 * MatchPointsRow — the A2b **Total Points** row (Refactor A2b — the last piece of
 * Refactor A). Inverts match-play points config: the owner sets a TOTAL; the
 * per-match value DERIVES (total ÷ matches, the "even share"); individual matches
 * can be OVERRIDDEN and the remainder REDISTRIBUTES to keep the total locked.
 * "Counts double" is just an override — there is no separate multiplier.
 *
 * Storage (locked by Phase 0, unchanged field names — `per_match` is REUSED, never
 * renamed):
 *   - total          → `games.points_total`            (owner-set)
 *   - even share     → `games.points_distribution.value` (derived, never authored)
 *   - per-match ovr  → `game_matches.point_value`       (null = even share)
 * The award sites read `point_value ?? points_distribution.value` per match; the
 * leaderboard total reads `points_total` (authoritative).
 *
 * PRESENTATIONAL (Draft-Then-Save P1): this row owns NO persistence — it renders the
 * values it's given and reports edits via `onTotalChange` / `onOverrideChange`. The
 * parent decides what an edit means (today: the existing mutations; after the flip: a
 * draft edit committed by the page's single Save). The even share shown here is
 * DERIVED for display only (`evenShare(total, overrides, matchCount)`) and is never
 * written from this component — that's what made the old reconcile effect able to
 * auto-persist a wrong share off a stale match count.
 *
 * Header: title "Total Points" + a ± stepper (sets the total) + "Points per match: X"
 * subtext (flips to "Custom" when any override exists). Expanded = the override list
 * ONLY (via the shared `MatchupChips` renderer): the even share as the dim default,
 * amber when overridden, × to reset. Honest fractions are shown (amber hint), never
 * auto-rounded. No "Total allocated" row — locked-total redistribution makes
 * mis-allocation impossible, so showing it would imply a failure mode that can't occur.
 */

const MAX_TOTAL = 999;

/** One paired match, resolved to its display players + current override. */
export interface PointsMatch {
  id: string;
  number: number;
  aPlayers: SidePlayer[];
  bPlayers: SidePlayer[];
  /** game_matches.point_value — null = uses the even share. */
  pointValue: number | null;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function MatchPointsRow({
  matches,
  pointsTotal,
  defaultTotal,
  canEdit,
  locked,
  expanded,
  onToggle,
  onTotalChange,
  onOverrideChange,
}: {
  /** Paired matches only (both sides set) — the award/leaderboard denominator. */
  matches: PointsMatch[];
  /** The owner total in force (null until first setup → `defaultTotal` shows). */
  pointsTotal: number | null;
  /** Players-per-team = total competition players ÷ teams. The first-setup default. */
  defaultTotal: number;
  canEdit: boolean;
  /** Live-scoring freeze (#512) — read-only + lock icon. */
  locked: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** The owner stepped the TOTAL. The parent decides what that means. */
  onTotalChange: (next: number) => void;
  /** One match's override set (a number) or cleared (null → back to the even share). */
  onOverrideChange: (matchId: string, value: number | null) => void;
}) {
  const matchCount = matches.length;
  // Effective total: the owner's set value, else the players-per-team default.
  const effectiveTotal = pointsTotal ?? defaultTotal;
  // Local total for snappy stepping; re-sync when the value in force changes
  // (render-phase adjust-on-prop-change, no effect).
  const [localTotal, setLocalTotal] = useState(effectiveTotal);
  const [lastEffectiveTotal, setLastEffectiveTotal] = useState(effectiveTotal);
  if (effectiveTotal !== lastEffectiveTotal) {
    setLastEffectiveTotal(effectiveTotal);
    setLocalTotal(effectiveTotal);
  }

  const overrideValues = matches.map((m) => m.pointValue).filter((v): v is number => v != null);
  const even = evenShare(localTotal, overrideValues, matchCount);
  const anyOverride = overrideValues.length > 0;
  const cleanEven = Number.isInteger(even);

  // The owner steps the TOTAL: optimistic local (snappy stepper), then report it.
  // No persistence here and NO reconcile effect — the even share is derived for
  // display above and re-derived from the FINAL state at write time, so this row
  // can never auto-persist a share computed off a stale match count.
  const stepTotal = (next: number) => {
    setLocalTotal(next);
    onTotalChange(next);
  };

  const subtitle = (
    <>
      Points per match:{" "}
      <span style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}>
        {anyOverride ? "Custom" : fmt(even)}
      </span>
    </>
  );

  return (
    <ChecklistRow
      icon={Hash}
      title="Total Points"
      subtitle={subtitle}
      state={effectiveTotal > 0 ? "resolved" : "empty"}
      disabled={!canEdit}
      locked={locked}
      expanded={expanded}
      onToggle={onToggle}
      testId="row-total-points"
      headerControl={
        <Stepper
          size="inline"
          value={localTotal}
          min={0}
          max={MAX_TOTAL}
          onChange={locked || !canEdit ? () => {} : (v) => stepTotal(v)}
          disabled={locked || !canEdit}
          testId="total-points-stepper"
        />
      }
    >
      <div className="flex flex-col" data-testid="points-override-panel">
        {matches.map((m, idx) => (
          <div
            key={m.id}
            className="flex items-center gap-3"
            style={{
              borderTop: idx > 0 ? "1px solid var(--color-bt-border)" : undefined,
              paddingTop: idx > 0 ? 12 : 0,
              paddingBottom: 12,
            }}
          >
            <span
              className="flex flex-shrink-0 items-center justify-center"
              style={{ width: 18, height: 18, borderRadius: 5, background: "var(--color-bt-card-raised)", fontSize: 10, fontWeight: 800, color: "var(--color-bt-text-dim)" }}
            >
              {m.number}
            </span>
            <div className="min-w-0 flex-1">
              <MatchupChips a={m.aPlayers} b={m.bPlayers} />
            </div>
            <OverrideField
              even={even}
              value={m.pointValue}
              disabled={locked || !canEdit}
              onCommit={(v) => onOverrideChange(m.id, v)}
            />
          </div>
        ))}

        {/* Honest fraction (never rounded): shown when the even share isn't whole and
            no override is masking it — nudge a divisible total or an override. */}
        {!cleanEven && !anyOverride && matchCount > 0 && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-warning)", lineHeight: 1.4, marginTop: 4 }} data-testid="points-fraction-hint">
            {fmt(localTotal)} ÷ {matchCount} = {fmt(even)} — not whole. Pick a total divisible by the match count, or override a match to clean up the rest.
          </p>
        )}
      </div>
    </ChecklistRow>
  );
}

/** One match's override input: the even share as a dim default when unset; an amber
 *  value + × reset when overridden. Commits on blur / Enter. */
function OverrideField({
  even,
  value,
  disabled,
  onCommit,
}: {
  even: number;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const isOverridden = value != null;
  const [draft, setDraft] = useState(isOverridden ? String(value) : "");
  // Resync when the persisted override changes externally — React's render-phase
  // "adjust state on prop change" pattern (no effect, no cascading-render lint trip).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value != null ? String(value) : "");
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (isOverridden) onCommit(null); // cleared → back to the even share
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(isOverridden ? String(value) : ""); // reject → revert
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <div className="flex flex-shrink-0 items-center" style={{ gap: 5, width: 78, justifyContent: "flex-end" }}>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={fmt(even)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        data-testid="points-override-input"
        style={{
          width: 48,
          textAlign: "center",
          borderRadius: 8,
          padding: "5px 4px",
          fontSize: 13,
          fontWeight: 700,
          background: isOverridden ? "var(--color-bt-warning-faint)" : "var(--color-bt-base)",
          border: `1px solid ${isOverridden ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
          color: isOverridden ? "var(--color-bt-warning)" : "var(--color-bt-text)",
          outline: "none",
        }}
      />
      <button
        type="button"
        aria-label="Reset to even share"
        onClick={() => onCommit(null)}
        disabled={disabled}
        className="flex items-center justify-center"
        style={{ width: 12, visibility: isOverridden ? "visible" : "hidden", color: "var(--color-bt-text-dim)" }}
        data-testid="points-override-reset"
      >
        <X size={12} />
      </button>
    </div>
  );
}
