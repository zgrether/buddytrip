"use client";

import { useEffect, useRef, useState } from "react";
import { Hash, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
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
 *   - total          → `games.points_total`            (owner-set, via setPointsTotal)
 *   - even share     → `games.points_distribution.value` (derived, via setPointsDistribution)
 *   - per-match ovr  → `game_matches.point_value`       (via matches.setPointValue; null = even)
 * The award sites read `point_value ?? points_distribution.value` per match; the
 * leaderboard total reads `points_total` (authoritative). This component is the ONLY
 * writer of that trio for match play.
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
  tripId,
  gameId,
  competitionId,
  matches,
  pointsTotal,
  pointsDistributionValue,
  defaultTotal,
  canEdit,
  locked,
  expanded,
  onToggle,
  onChanged,
}: {
  tripId: string;
  gameId: string;
  competitionId: string | null;
  /** Paired matches only (both sides set) — the award/leaderboard denominator. */
  matches: PointsMatch[];
  /** Persisted owner total (null until first setup). */
  pointsTotal: number | null;
  /** Persisted even share (`points_distribution.value`) — for the drift reconcile. */
  pointsDistributionValue: number;
  /** Players-per-team = total competition players ÷ teams. The first-setup default. */
  defaultTotal: number;
  canEdit: boolean;
  /** Live-scoring freeze (#512) — read-only + lock icon. */
  locked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChanged?: () => void;
}) {
  const utils = trpc.useUtils();
  const setTotalM = trpc.games.setPointsTotal.useMutation();
  const setDistM = trpc.games.setPointsDistribution.useMutation();
  const setPvM = trpc.matches.setPointValue.useMutation();

  const matchCount = matches.length;
  // Effective total: the owner's set value, else the players-per-team default.
  const effectiveTotal = pointsTotal ?? defaultTotal;
  // Local total for snappy stepping; re-sync when the persisted value changes
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

  // Persist the even share for the given (total, overrides) — always derived.
  const persistEven = async (total: number, ovrs: number[]) => {
    const ev = evenShare(total, ovrs, matchCount);
    await setDistM.mutateAsync({ tripId, gameId, distribution: { type: "per_match", value: ev } });
  };
  const bumpBoard = () => {
    utils.games.listByTrip.invalidate({ tripId });
    utils.games.getById.invalidate({ tripId, gameId });
    utils.matches.listByGame.invalidate({ tripId, gameId });
    // CLAUDE.md #10: the Live face re-seeds child caches from faceBootstrap, so a
    // points change must invalidate faceBootstrap or the board reads stale until poll.
    if (competitionId) utils.competitions.faceBootstrap.invalidate({ tripId });
    onChanged?.();
  };

  // The owner steps the TOTAL. Optimistic local, then persist total + derived even share.
  const onTotalChange = async (next: number) => {
    setLocalTotal(next);
    try {
      await setTotalM.mutateAsync({ tripId, gameId, total: next });
      await persistEven(next, overrideValues);
      bumpBoard();
    } catch {
      utils.games.getById.invalidate({ tripId, gameId });
    }
  };

  // Set / clear one match's override, then redistribute the remainder (even share).
  const onOverride = async (matchId: string, value: number | null) => {
    try {
      await setPvM.mutateAsync({ tripId, gameId, matchId, value });
      const nextOvrs = matches
        .map((m) => (m.id === matchId ? value : m.pointValue))
        .filter((v): v is number => v != null);
      await persistEven(localTotal, nextOvrs);
      bumpBoard();
    } catch {
      utils.matches.listByGame.invalidate({ tripId, gameId });
    }
  };

  // Reconcile the PERSISTED even share with the derived value: (1) first-setup default
  // — no total yet → write players-per-team once; (2) keep points_distribution.value in
  // sync as matches are added/removed or overrides change (recompute-on-input). Based on
  // PERSISTED props (not local optimistic state) so it converges and never loops.
  const didDefault = useRef(false);
  useEffect(() => {
    if (!canEdit || locked || matchCount === 0) return;
    const persistedOvrs = matches.map((m) => m.pointValue).filter((v): v is number => v != null);
    if (pointsTotal == null) {
      if (defaultTotal > 0 && !didDefault.current) {
        didDefault.current = true;
        void (async () => {
          await setTotalM.mutateAsync({ tripId, gameId, total: defaultTotal });
          await persistEven(defaultTotal, persistedOvrs);
          bumpBoard();
        })();
      }
      return;
    }
    const ev = evenShare(pointsTotal, persistedOvrs, matchCount);
    if (Math.abs(ev - pointsDistributionValue) > 1e-9) {
      void (async () => {
        await persistEven(pointsTotal, persistedOvrs);
        bumpBoard();
      })();
    }
    // persistEven/bumpBoard are stable-enough closures; we react to the DATA inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsTotal, defaultTotal, matchCount, pointsDistributionValue, canEdit, locked, matches.map((m) => `${m.id}:${m.pointValue}`).join(",")]);

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
          onChange={locked || !canEdit ? () => {} : (v) => void onTotalChange(v)}
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
              onCommit={(v) => void onOverride(m.id, v)}
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
