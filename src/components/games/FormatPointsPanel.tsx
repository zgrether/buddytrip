"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
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
 * Persistence: points save as the **total + distribution PAIR** (`setPointsTotal` +
 * `setPointsDistribution` together — never one without the other). Saved on-change
 * rather than on-collapse: every intermediate points value is VALID (unlike the
 * draft editors' half-filled matches), so there's no invalid-intermediate to hide,
 * and it sidesteps fragile cross-component collapse-flush coordination. The pair
 * is what matters, and it's always written atomically. Optimistic via `setData`.
 */
export function FormatPointsPanel({
  tripId, game, canEdit, matchCount, controlled,
}: {
  tripId: string;
  game: GameRow;
  canEdit: boolean;
  /** Valid (fully-paired) match count — drives the "Total points available"
   *  readout for match-format games (W-GAMEPAGE-01 §6.2). Derived, not snapshotted:
   *  Total = matchCount × points-per-match, recomputing as matches are added. */
  matchCount?: number;
  /** Draft-then-save mode (P2): when passed, the panel reports the total+distribution
   *  PAIR via `onChange` instead of self-persisting, and seeds off `value` (re-syncing
   *  when it changes — so a Save/Cancel that resets the draft re-seeds the editor).
   *  Omit and it keeps its own on-change mutations (the stroke/self-persisting path). */
  controlled?: {
    value: { total: number | null; distribution: PointsDistribution | null };
    onChange: (total: number | null, distribution: PointsDistribution | null) => void;
  };
}) {
  const gameId = game.id;
  const utils = trpc.useUtils();

  const type = GAME_TYPES.find((t) => t.id === game.game_type_id);
  const isMatchPlay = type?.resultStrategy === "match_play" || type?.resultStrategy === "rack_n_stack";

  // Seed off the controlled value when drafting, else the persisted game.
  const seedTotal = controlled ? controlled.value.total : game.points_total;
  const seedDist = controlled ? controlled.value.distribution : game.points_distribution;
  const [perMatchValue, setPerMatchValue] = useState<number>(seedDist?.type === "per_match" ? seedDist.value : 1);
  const [total, setTotal] = useState<number>(seedTotal ?? 8);
  const [placeInputs, setPlaceInputs] = useState<string[]>(
    seedDist?.type === "placement" && seedDist.values.length > 0 ? seedDist.values.map(String) : [""]
  );
  // Re-sync the editor when the controlled value changes underneath it (a draft reset on
  // Save/Cancel) — render-phase adjust-on-prop-change, no effect.
  const seedKey = controlled ? `${seedTotal}|${JSON.stringify(seedDist)}` : "";
  const [lastSeed, setLastSeed] = useState(seedKey);
  if (controlled && seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setTotal(seedTotal ?? 8);
    setPerMatchValue(seedDist?.type === "per_match" ? seedDist.value : 1);
    setPlaceInputs(seedDist?.type === "placement" && seedDist.values.length > 0 ? seedDist.values.map(String) : [""]);
  }

  const setTotalM = trpc.games.setPointsTotal.useMutation();
  const setDistM = trpc.games.setPointsDistribution.useMutation();

  const started = !isMatchPlay && (placeInputs[0]?.trim() ?? "") !== "";
  const enteredValues = started ? placeInputs.map((s) => Number(s.trim() || "0")) : [];
  const placement = validatePlacement(total, enteredValues);

  function optimisticGame(patch: Partial<GameRow>) {
    const cur = utils.games.getById.getData({ tripId, gameId });
    if (cur) utils.games.getById.setData({ tripId, gameId }, { ...cur, ...patch } as typeof cur);
  }
  function refresh() {
    utils.games.getById.invalidate({ tripId, gameId });
    utils.games.listByTrip.invalidate({ tripId });
    if (game.competition_id) utils.competitions.faceBootstrap.invalidate({ tripId });
  }

  // Save the total + distribution PAIR together (never one without the other). In
  // controlled mode this reports to the parent draft instead of persisting.
  async function savePoints(nextDist: PointsDistribution | null, nextTotal: number | null) {
    if (controlled) { controlled.onChange(nextTotal, nextDist); return; }
    optimisticGame({ points_total: nextTotal, points_distribution: nextDist } as Partial<GameRow>);
    try {
      await setTotalM.mutateAsync({ tripId, gameId, total: nextTotal });
      await setDistM.mutateAsync({ tripId, gameId, distribution: nextDist });
      refresh();
    } catch { refresh(); }
  }

  function onPerMatch(v: number) {
    setPerMatchValue(v);
    void savePoints({ type: "per_match", value: v > 0 ? v : 1 }, null);
  }
  function onTotal(v: number) {
    setTotal(v);
    // Re-save the placement pair against the new total (valid only if it still fits).
    const d: PointsDistribution | null = started ? { type: "placement", values: enteredValues } : null;
    if (!started || validatePlacement(v, enteredValues).saveable) void savePoints(d, v);
    else optimisticGame({ points_total: v } as Partial<GameRow>);
  }
  function onPlaceInputs(next: string[]) {
    setPlaceInputs(next);
    const startedNext = (next[0]?.trim() ?? "") !== "";
    const vals = startedNext ? next.map((s) => Number(s.trim() || "0")) : [];
    const p = validatePlacement(total, vals);
    if (!startedNext) void savePoints(null, total);
    else if (p.saveable) void savePoints({ type: "placement", values: vals }, total);
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
            label="Point value"
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
