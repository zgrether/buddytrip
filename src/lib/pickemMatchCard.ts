import type { DecidedHole } from "./matchPlay";
import type { UnitWeight } from "./gloriousHoles";
import type { BoardRow } from "./pickemBoard";

/**
 * A pick'em head-to-head, in the shape the MATCH-PLAY card already reads.
 *
 * ── A pick'em match without confidence IS match play ──────────────────────
 *
 *   hole                  ->  game
 *   hole won              ->  picked correctly, opponent didn't
 *   halved                ->  both right, or both wrong
 *   glorious hole (2x)    ->  game multiplier
 *   holes remaining       ->  games remaining
 *   dormie / closed out   ->  unchanged
 *
 * The only structural difference is that the count is not 18 — and that, plus
 * the positional selector and the `1 | 2` return type, is exactly what the
 * `weightOf` seam removed from `matchState`. So this file is an ADAPTER and not
 * an engine: it says who won each game and what each game is worth, and the
 * shared engine does the rest. There is no second scoring implementation here,
 * which is the whole reason for taking the seam rather than building a parallel
 * card.
 *
 * ── ONLY with confidence off ──────────────────────────────────────────────
 *
 * With confidence ON a game can swing up to 32, and a segment bar draws every
 * unit the same width — so a 1-point game and a 32-point game would be the same
 * mark, and the bar would be actively misleading about where the match was won.
 * That is a property of the scoring, not a preference: with confidence off every
 * game is worth one before its multiplier, so equal-width segments are honest.
 * The caller branches on it; this adapter is only ever fed the honest case.
 */
export interface PickemCardModel {
  /** Played games only, in slate order — the engine's `DecidedHole[]`. */
  results: DecidedHole[];
  /** Per-game multiplier. The seam's whole purpose. */
  weightOf: UnitWeight;
  /**
   * Games that resolved with NO STAKE on them, 1-based and sparse.
   *
   * Two kinds, and they must not look like each other or like a halve:
   *   `void` — the game was CANCELLED; something was here and its stake struck.
   *   `none` — NOBODY picked it; nothing was ever placed.
   *
   * A halve (both right, both wrong, or a push) is a contested draw and is
   * absent from this map — it is the ordinary grey segment. Grey for the other
   * two would claim a contest that did not happen.
   */
  decidedStake: Record<number, "void" | "none">;
  /** Slate length — the engine's `holeCount`. */
  unitCount: number;
}

/** A slate game, in the shape the board already holds. */
export interface PickemCardSlateGame {
  id: string;
  multiplier?: number | null;
}

export function pickemCardModel(
  slate: PickemCardSlateGame[],
  rows: BoardRow[]
): PickemCardModel {
  const byGame = new Map(rows.map((r) => [r.slateGameId, r]));
  const results: DecidedHole[] = [];
  const decidedStake: Record<number, "void" | "none"> = {};
  const weights = new Map<number, number>();

  slate.forEach((game, i) => {
    const unit = i + 1;
    /**
     * Absent reads as 1, NEVER as 0. A missing multiplier must produce a normal
     * game rather than a worthless one — the same rule `ScoredSlateGame`'s own
     * comment states, restated here because this is a second reader of the
     * column and a `?? 0` would silently delete a game from the match.
     */
    weights.set(unit, game.multiplier ?? 1);

    const row = byGame.get(game.id);
    // No row, or no result yet — an UNPLAYED unit. Absent from `results`, which
    // is how the engine already distinguishes "still to come" from "drawn".
    if (!row || row.result == null) return;

    /**
     * `swing` is the signed points this game moved the match, and its sign
     * convention is the board's: positive means A gained. The MAGNITUDE is
     * deliberately discarded — the engine re-derives it from `weightOf`, so
     * there is one weighting path rather than two that must agree.
     */
    if (row.swing > 0) {
      results.push({ hole: unit, result: "W" });
      return;
    }
    if (row.swing < 0) {
      results.push({ hole: unit, result: "L" });
      return;
    }

    // Resolved and level. It still counts as PLAYED — it consumes a unit and
    // reduces what is left — but why it is level decides how it draws.
    results.push({ hole: unit, result: "H" });
    if (row.zeroKind === "cancelled") decidedStake[unit] = "void";
    else if (row.zeroKind === "unpicked") decidedStake[unit] = "none";
    // `push`, `both` and `neither` are contested draws and stay grey.
  });

  return {
    results,
    weightOf: (unit: number) => weights.get(unit) ?? 1,
    decidedStake,
    unitCount: slate.length,
  };
}

/** Which units carry a multiplier — the per-unit selector `MatchCard` takes in
 *  place of golf's positional trailing window. */
export function pickemWeightedUnit(model: PickemCardModel): (unit: number) => boolean {
  return (unit: number) => model.weightOf(unit) > 1;
}
