"use client";

import { useState } from "react";
import { Hash, Scale, X } from "lucide-react";
import { ChecklistRow } from "@/components/games/ChecklistRow";
import { Stepper } from "@/components/games/Stepper";
import { SideChips, type SidePlayer } from "@/components/games/MatchSides";
import { MatchGridRow } from "@/components/games/MatchGridRow";
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
  part,
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
  /** Freeze redesign §3.2: split into TWO rows in different zones.
   *  - "total" → the bare owner-set number (Game Management; no match dependency).
   *  - "distribution" → the per-match override panel (Match Settings; needs matches).
   *  Both render from the same props, so the derived even-share can't drift. */
  part: "total" | "distribution";
  /** Paired matches only (both sides set) — the award/leaderboard denominator. */
  matches: PointsMatch[];
  /** The owner total in force (null until first setup → `defaultTotal` shows). */
  pointsTotal: number | null;
  /** Players-per-team = total competition players ÷ teams. The first-setup default. */
  defaultTotal: number;
  canEdit: boolean;
  /** Live-scoring freeze (#512) — read-only + lock icon. Warned tier → always false now. */
  locked: boolean;
  /** "distribution" only: the accordion open state (the total row is a control row). */
  expanded?: boolean;
  onToggle?: () => void;
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

  // ── "total" — the bare owner-set number (Game Management zone). A control row: the
  //    ± stepper sits where the chevron would; no accordion. Subtitle is the derived
  //    per-match readout (the immediate consequence of the total).
  if (part === "total") {
    return (
      <ChecklistRow
        icon={Hash}
        title="Total Points"
        subtitle={
          <>
            Points per match:{" "}
            <span style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}>
              {anyOverride ? "Custom" : fmt(even)}
            </span>
          </>
        }
        state={effectiveTotal > 0 ? "resolved" : "empty"}
        disabled={!canEdit}
        locked={locked}
        testId="row-total-points"
        control={
          <Stepper
            size="inline"
            value={localTotal}
            min={0}
            max={MAX_TOTAL}
            onChange={locked || !canEdit ? () => {} : (v) => stepTotal(v)}
            disabled={locked || !canEdit}
            editable // tap the value → decimal entry (item 1); −/+ stay integer
            testId="total-points-stepper"
          />
        }
      />
    );
  }

  // ── "distribution" — the per-match override panel (Match Settings zone). The parent
  //    only renders this once matches exist, so it always has rows to show.
  return (
    <ChecklistRow
      icon={Scale}
      title="Point Distribution"
      subtitle={anyOverride ? "Custom — some matches overridden" : `Even — ${fmt(even)} per match`}
      // "Not set" ONLY when there are no matches. Once ≥1 match exists the even-share
      // default is already a valid distribution (fixed even when no override is set) —
      // there is no "matches exist but distribution unset" state. `matchCount` is the
      // DRAFT's filled-match count (this row is fed pointsMatches off configDraft), so
      // it's draft-derived, not serverMatches. (Bug: keying on anyOverride rendered a
      // 1-match game with points assigned as "not set".)
      state={matchCount > 0 ? "resolved" : "empty"}
      disabled={!canEdit}
      locked={locked}
      expanded={expanded}
      onToggle={onToggle}
      testId="row-point-distribution"
    >
      <div className="flex flex-col" data-testid="points-override-panel">
        {matches.map((m, idx) => {
          // The even share THIS match would get if it weren't overridden — computed
          // EXCLUDING its own override (the share it reverts to on ×). For a non-
          // overridden match this equals the pool `even`; for an overridden one it's the
          // correct "back to even" value (not the degenerate 0-remaining pool share).
          const otherOverrides = matches
            .filter((o) => o.id !== m.id)
            .map((o) => o.pointValue)
            .filter((v): v is number => v != null);
          const revertEven = evenShare(localTotal, otherOverrides, matchCount);
          return (
            <MatchGridRow
              key={m.id}
              number={m.number}
              playersPerSide={m.aPlayers.length}
              isFirst={idx === 0}
              sideA={<SideChips players={m.aPlayers} />}
              sideB={<SideChips players={m.bPlayers} />}
              value={
                <OverrideField
                  even={revertEven}
                  value={m.pointValue}
                  disabled={locked || !canEdit}
                  onCommit={(v) => onOverrideChange(m.id, v)}
                />
              }
            />
          );
        })}

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

/** One match's override control (E): a compact `value · ×` where the value is a TRIGGER —
 *  tapping it opens a popup with the Total Points picker (decimal tap-entry), which commits
 *  itself (no blur ambiguity, no inline Save). The even share is the dim default when unset;
 *  an amber value when overridden. `×` clears the override → back to the even share. */
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
  const [open, setOpen] = useState(false);
  const isOverridden = value != null;
  return (
    <div className="flex flex-shrink-0 items-center" style={{ gap: 5, width: 78, justifyContent: "flex-end" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="points-override-trigger"
        style={{
          width: 48,
          textAlign: "center",
          borderRadius: 8,
          padding: "5px 4px",
          fontSize: 13,
          fontWeight: 700,
          background: isOverridden ? "var(--color-bt-warning-faint)" : "var(--color-bt-base)",
          border: `1px solid ${isOverridden ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
          color: isOverridden ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {fmt(isOverridden ? (value as number) : even)}
      </button>
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
      {open && !disabled && (
        <OverridePopup
          even={even}
          value={value}
          onSet={(n) => onCommit(n)}
          onClear={() => { onCommit(null); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** The override picker popup (E): a centered card holding the Total Points `Stepper`
 *  (decimal tap-entry). It COMMITS ITSELF — each step/typed value reports the override up
 *  via `onSet`; there is no Save button. "Use even share" clears the override; the backdrop
 *  and "Done" just close (the value is already committed). */
function OverridePopup({
  even,
  value,
  onSet,
  onClear,
  onClose,
}: {
  even: number;
  value: number | null;
  onSet: (n: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      data-testid="points-override-popup"
    >
      <div
        className="w-full max-w-[280px] rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-1 text-center text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>Match points</p>
        <p className="mb-4 text-center text-[11.5px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Even share is {fmt(even)}. Set a custom value, or use the even share.
        </p>
        <div className="flex justify-center">
          <Stepper
            size="full"
            value={value ?? even}
            min={0}
            max={MAX_TOTAL}
            editable
            formatValue={fmt}
            onChange={onSet}
            testId="override-stepper"
          />
        </div>
        <div className="mt-5 flex flex-col gap-2">
          {value != null && (
            <button
              type="button"
              onClick={onClear}
              className="w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: "transparent", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
              data-testid="override-use-even"
            >
              Use even share ({fmt(even)})
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl py-2.5 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)", border: "none" }}
            data-testid="override-done"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
