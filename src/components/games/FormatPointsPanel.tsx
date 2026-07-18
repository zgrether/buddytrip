"use client";

import { useState } from "react";
import { GAME_TYPES } from "@/lib/gameTypes";
import { validatePlacement } from "@/lib/gameConfig";
import {
  PointStepper, PlacementEditor,
  type GameRow,
} from "@/components/competition/CompetitionGamesPanel";
import type { PointsDistribution } from "@/lib/pointsDistribution";

/**
 * Points accordion body for **placement** (stroke/non-golf) games — the point value
 * + the placement split. Phase C narrowed this: the competition-format picker is
 * removed (not re-homed — the Add/Edit modal still sets `competition_format`), and
 * match-format games (1v1/2v2/rack) no longer use this panel at all — they carry an
 * INLINE per-match stepper in the row (`GameSetupRows` → `PointsPerMatchControl`).
 * So this is now JUST the placement points editor.
 *
 * Draft-then-save only (#626 scaffolding retirement): the panel reports the
 * total+distribution PAIR via `controlled.onChange` and never persists itself — the
 * parent's `save_game_config` owns the write. Points report as the PAIR (never one
 * without the other), and it re-seeds off `controlled.value` when the draft resets on
 * Save/Cancel. (The old self-persisting `setPointsTotal`/`setPointsDistribution` path
 * is gone — every render site is controlled.)
 */
export function FormatPointsPanel({
  game, canEdit, matchCount, controlled, pointsLabel = "Point value",
}: {
  game: GameRow;
  canEdit: boolean;
  /** Valid (fully-paired) match count — drives the "Total points available"
   *  readout for match-format games (W-GAMEPAGE-01 §6.2). Derived, not snapshotted:
   *  Total = matchCount × points-per-match, recomputing as matches are added. */
  matchCount?: number;
  /** The draft slice this panel edits: reports the total+distribution PAIR via
   *  `onChange` and seeds off `value` (re-syncing when it changes — so a Save/Cancel
   *  that resets the draft re-seeds the editor). */
  controlled: {
    value: { total: number | null; distribution: PointsDistribution | null };
    onChange: (total: number | null, distribution: PointsDistribution | null) => void;
  };
  /** The placement-branch PointStepper's field label. Defaults to "Point value" (its
   *  existing text — used as-is by Stroke, whose OUTER "Total Points" ChecklistRow
   *  already titles this panel, so the inner control keeps its more specific label).
   *  Non-Golf has no such outer wrapper — this panel's own label IS its points row's
   *  title there, so it passes "Total Points" explicitly (cross-format consistency). */
  pointsLabel?: string;
}) {
  const type = GAME_TYPES.find((t) => t.id === game.game_type_id);
  const isMatchPlay = type?.resultStrategy === "match_play" || type?.resultStrategy === "rack_n_stack";

  const seedTotal = controlled.value.total;
  const seedDist = controlled.value.distribution;
  const [perMatchValue, setPerMatchValue] = useState<number>(seedDist?.type === "per_match" ? seedDist.value : 1);
  const [total, setTotal] = useState<number>(seedTotal ?? 8);
  const [placeInputs, setPlaceInputs] = useState<string[]>(
    seedDist?.type === "placement" && seedDist.values.length > 0 ? seedDist.values.map(String) : [""]
  );
  // Re-sync the editor when the controlled value changes underneath it (a draft reset on
  // Save/Cancel) — render-phase adjust-on-prop-change, no effect.
  const seedKey = `${seedTotal}|${JSON.stringify(seedDist)}`;
  const [lastSeed, setLastSeed] = useState(seedKey);
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setTotal(seedTotal ?? 8);
    setPerMatchValue(seedDist?.type === "per_match" ? seedDist.value : 1);
    setPlaceInputs(seedDist?.type === "placement" && seedDist.values.length > 0 ? seedDist.values.map(String) : [""]);
  }

  const started = !isMatchPlay && (placeInputs[0]?.trim() ?? "") !== "";
  const enteredValues = started ? placeInputs.map((s) => Number(s.trim() || "0")) : [];
  const placement = validatePlacement(total, enteredValues);

  // Report the total + distribution PAIR together (never one without the other) to the
  // parent draft; `save_game_config` commits it.
  function savePoints(nextDist: PointsDistribution | null, nextTotal: number | null) {
    controlled.onChange(nextTotal, nextDist);
  }

  function onPerMatch(v: number) {
    setPerMatchValue(v);
    savePoints({ type: "per_match", value: v > 0 ? v : 1 }, null);
  }
  function onTotal(v: number) {
    setTotal(v);
    // Re-report the placement pair against the new total (only when it still fits — an
    // invalid intermediate keeps the last valid pair in the draft rather than reporting
    // a distribution that doesn't sum to the total).
    const d: PointsDistribution | null = started ? { type: "placement", values: enteredValues } : null;
    if (!started || validatePlacement(v, enteredValues).saveable) savePoints(d, v);
  }
  function onPlaceInputs(next: string[]) {
    setPlaceInputs(next);
    const startedNext = (next[0]?.trim() ?? "") !== "";
    const vals = startedNext ? next.map((s) => Number(s.trim() || "0")) : [];
    const p = validatePlacement(total, vals);
    if (!startedNext) savePoints(null, total);
    else if (p.saveable) savePoints({ type: "placement", values: vals }, total);
  }

  const readOnly = !canEdit;
  return (
    <div className="flex flex-col gap-4" data-testid="format-points-panel">
      {/* Points (Phase C: the competition-format picker is gone — removed, not
          re-homed; the Add/Edit modal still sets competition_format). */}
      {isMatchPlay ? (
        <>
          <PointStepper
            label="Points per match"
            caption="POINTS PER MATCH"
            value={perMatchValue}
            onChange={readOnly ? () => {} : onPerMatch}
          />
          {/* Total points available (W-GAMEPAGE-01 §6.2) — derived live from the
              valid match count × per-match value, so it tracks matches as they're
              added (never snapshotted). Hidden until at least one match resolves. */}
          {matchCount != null && matchCount > 0 && (
            <div
              className="flex items-center justify-between rounded-lg px-3 py-2.5"
              style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
              data-testid="total-points-available"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                Total points available
              </span>
              <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                {matchCount * perMatchValue}
                <span className="ml-1 text-[11px] font-normal" style={{ color: "var(--color-bt-text-dim)" }}>
                  {matchCount} × {perMatchValue}
                </span>
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <PointStepper
            label={pointsLabel}
            caption="POINTS FOR THIS GAME"
            value={total}
            onChange={readOnly ? () => {} : onTotal}
          />
          <PlacementEditor total={total} placeInputs={placeInputs} setPlaceInputs={readOnly ? () => {} : onPlaceInputs} placement={placement} />
        </>
      )}
    </div>
  );
}
