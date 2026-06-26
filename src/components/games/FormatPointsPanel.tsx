"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { GAME_TYPES } from "@/lib/gameTypes";
import { validatePlacement } from "@/lib/gameConfig";
import {
  Field, PointStepper, PlacementEditor, FormatSheet, formatLabel,
  type GameRow,
} from "@/components/competition/CompetitionGamesPanel";
import { ChevronRight } from "lucide-react";
import type { PointsDistribution } from "@/lib/pointsDistribution";

/**
 * Zone 2 "Format · Points" accordion body (W-EDITMODAL-01) — the focused points +
 * competition-format editor that replaces the old Edit-Game modal for this row.
 * Name moved to the Zone-1 header; Course/Matches/Modifiers/Rules/Delegate live in
 * their own rows/zones — so this panel is JUST format + points.
 *
 * Persistence: format saves on pick (independent `update{competitionFormat}`);
 * points save as the **total + distribution PAIR** (`setPointsTotal` +
 * `setPointsDistribution` together — never one without the other). Saved on-change
 * rather than on-collapse: every intermediate points value is VALID (unlike the
 * draft editors' half-filled matches), so there's no invalid-intermediate to hide,
 * and it sidesteps fragile cross-component collapse-flush coordination. The pair
 * is what matters, and it's always written atomically. Optimistic via `setData`.
 */
export function FormatPointsPanel({
  tripId, game, canEdit, matchCount,
}: {
  tripId: string;
  game: GameRow;
  canEdit: boolean;
  /** Valid (fully-paired) match count — drives the "Total points available"
   *  readout for match-format games (W-GAMEPAGE-01 §6.2). Derived, not snapshotted:
   *  Total = matchCount × points-per-match, recomputing as matches are added. */
  matchCount?: number;
}) {
  const gameId = game.id;
  const utils = trpc.useUtils();

  const type = GAME_TYPES.find((t) => t.id === game.game_type_id);
  const isMatchPlay = type?.resultStrategy === "match_play" || type?.resultStrategy === "rack_n_stack";

  const dist0 = game.points_distribution;
  const [perMatchValue, setPerMatchValue] = useState<number>(dist0?.type === "per_match" ? dist0.value : 1);
  const [total, setTotal] = useState<number>(game.points_total ?? 8);
  const [placeInputs, setPlaceInputs] = useState<string[]>(
    dist0?.type === "placement" && dist0.values.length > 0 ? dist0.values.map(String) : [""]
  );
  const [compFormat, setCompFormat] = useState<string | null>(game.competition_format ?? null);
  const [formatSheetOpen, setFormatSheetOpen] = useState(false);

  const update = trpc.games.update.useMutation();
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

  // Save the total + distribution PAIR together (never one without the other).
  async function savePoints(nextDist: PointsDistribution | null, nextTotal: number | null) {
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
  function onFormat(key: string | null) {
    setCompFormat(key);
    setFormatSheetOpen(false);
    optimisticGame({ competition_format: key } as Partial<GameRow>);
    update.mutate({ tripId, gameId, competitionFormat: (key as never) ?? null }, { onSuccess: refresh });
  }

  const readOnly = !canEdit;
  return (
    <div className="flex flex-col gap-4" data-testid="format-points-panel">
      {/* Competition format */}
      <Field label="Competition format">
        <button
          type="button"
          onClick={() => { if (!readOnly) setFormatSheetOpen(true); }}
          disabled={readOnly}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--color-bt-card-raised)", color: compFormat ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}
        >
          <span>{formatLabel(compFormat) ?? "How's it played?"}</span>
          <ChevronRight size={15} style={{ color: "var(--color-bt-text-dim)" }} />
        </button>
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Sets the label on the leaderboard. Running it up in-app comes later — until then you enter results by hand.
        </p>
      </Field>

      {/* Points */}
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

      {formatSheetOpen && (
        <FormatSheet current={compFormat} onPick={(k) => onFormat(k)} onClose={() => setFormatSheetOpen(false)} />
      )}
    </div>
  );
}
