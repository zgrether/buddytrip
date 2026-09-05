/**
 * Glorious Finishing Holes — the per-hole 2× weight for match play.
 *
 * The mechanic (frozen): the last N holes of a match are worth DOUBLE. A won
 * glorious hole is a ±2 swing; a halved hole is still 0. The multiplier is a fixed
 * 2× — there is no 3× and no owner-set multiplier; the only config inputs are
 * `enabled` (presence of `glorious_holes` in `games.modifiers`) and `N` (its
 * `holes` count).
 *
 * DERIVED, never snapshotted. The weight is a pure function of the LIVE config read
 * at compute time — flip the flag or change N mid-round and the tally simply
 * recomputes; nothing is stored on a hole result and nothing migrates. Raw per-hole
 * outcomes stay raw in `score_entries` (engine decision #16); the weight lives only
 * in the compute path.
 *
 * Applies to match SINGLES/DOUBLES only. Stroke play has no per-hole win to double;
 * rack-n-stack is net-stroke ENTRY (it is `match_play` by COMPETITION scoring_model,
 * but that is NOT this — guard on the game_type_id, NEVER the scoring model);
 * manual/non-golf has no per-hole entry. The format guard lives in `gloriousConfig`
 * so the weight stays inert for every excluded format no matter what the modifiers
 * jsonb says — belt-and-suspenders on top of the fact that only singles/doubles ever
 * reach `matchState`.
 *
 * Pure + client-safe: the SAME helper feeds the live client strip and the server
 * result compute, so they can't diverge (CLAUDE.md pattern #8). When Skins ships it
 * reuses `holeWeight` unchanged.
 */
import { isMatchPlayFormat } from "./gameRoutes";
import { isModifierEnabled, gloriousHolesCount, type ModifiersMap } from "./modifiers";

/**
 * The mechanic is frozen as "last N of an 18-hole match" → a hole is glorious when
 * its number is > 18 − N. This is deliberately the literal 18 from the spec, not the
 * round's own hole count: match play is 18-hole, and on a shorter round no hole
 * clears `18 − N` so glorious is simply inert (revisit only if 9-hole match play +
 * glorious ever becomes a real case).
 */
const ROUND_HOLES = 18;

export interface GloriousConfig {
  enabled: boolean;
  /** Trailing holes worth 2×. Meaningless (0) when `!enabled`. */
  n: number;
}

/** The inert config — every hole weighs 1. Default for callers with no glorious. */
export const NO_GLORIOUS: GloriousConfig = { enabled: false, n: 0 };

/**
 * Read the LIVE glorious config off a game, FORMAT- and ENTRY-MODE-GUARDED.
 *
 * **Format guard.** Returns `NO_GLORIOUS` for any game_type_id outside match
 * singles/doubles (via `isMatchPlayFormat`) — so stroke/rack/manual stay inert even
 * if their `modifiers` jsonb somehow carries `glorious_holes`. Guarded on the id,
 * NEVER the competition `scoring_model`: rack is `match_play` by scoring_model yet
 * is excluded here, by design (the §2 trap).
 *
 * **Entry-mode guard.** Glorious is valid ONLY with outcome entry. Outcome entry
 * records who won each hole, so doubling a hole's value means something. Score
 * entry records a stroke total — you cannot double the value of a hole whose
 * outcome you never recorded, and the combination is invalid.
 *
 * The engine derives per-hole W/L/H from strokes (`buildDecided`) and hands the
 * SAME `DecidedHole[]` to `matchState` either way, so nothing downstream can tell
 * the two apart. That equivalence is correct for the parity it was built for — one
 * engine, two decided-hole sources — and wrong as a licence to weight a score
 * game. Prevention (availability + the `save_game_config` refusal) stops new
 * instances; this guard stops the four existing ones recomputing the wrong answer.
 * `75c95f02` is the measured case: 7W/6L/5H is a 1up win unweighted, and doubling
 * its lost 18th turns it into a halve.
 *
 * `entryMode` is optional and defaults to outcome-permissive, because only match
 * play has the column — a caller that genuinely has no entry mode (a format that
 * never had one) is already excluded by the format guard above.
 */
export function gloriousConfig(
  gameTypeId: string | null | undefined,
  modifiers: ModifiersMap | null | undefined,
  entryMode?: string | null
): GloriousConfig {
  if (!isMatchPlayFormat(gameTypeId ?? null)) return NO_GLORIOUS;
  if (entryMode === "score") return NO_GLORIOUS;
  const m = modifiers ?? {};
  if (!isModifierEnabled(m, "glorious_holes")) return NO_GLORIOUS;
  return { enabled: true, n: gloriousHolesCount(m) };
}

/** Per-hole weight: `(enabled && hole > 18 − n) ? 2 : 1`. The ONE home of the
 *  mechanic; Skins will reuse it. */
export function holeWeight(hole: number, cfg: GloriousConfig): 1 | 2 {
  return cfg.enabled && hole > ROUND_HOLES - cfg.n ? 2 : 1;
}

/**
 * What one UNIT of a match is worth — the generalisation that lets a non-golf
 * format drive the match-play engine.
 *
 * ── Why this exists, and what it removed ──────────────────────────────────
 *
 * `matchState` used to weight its units by calling `holeWeight(hole, cfg)`
 * directly, which baked three of GOLF's assumptions into the shared engine:
 *
 *   1. the return type is the literal `1 | 2` — there is no third weight;
 *   2. the SELECTOR is positional (`hole > 18 − n`, a trailing window);
 *   3. `ROUND_HOLES` is a hardcoded 18, so on a shorter unit count the
 *      weighting is silently INERT rather than wrong.
 *
 * All three are the same shape: golf's mechanic hardcoded into the engine
 * rather than passed into it. Pick'em is match play with games for holes and a
 * per-game multiplier for glorious — its weights are 1..4 (`MULTIPLIER_MAX`,
 * and the DB allows any positive numeric), chosen per game rather than by
 * position, over a slate that is not 18 long. Every one of the three blocked
 * it, and a function replaces all three at once.
 *
 * Golf is unchanged: `toUnitWeight` turns a `GloriousConfig` into one of these,
 * so every existing caller keeps passing exactly what it passed before.
 */
export type UnitWeight = (unit: number) => number;

/** Either form the engine accepts — golf's config, or an arbitrary per-unit
 *  weight. A function and an object, so the discrimination is `typeof`. */
export type Weighting = GloriousConfig | UnitWeight;

/** Normalise to a weight function. The ONE place the two forms meet. */
export function toUnitWeight(weighting: Weighting): UnitWeight {
  return typeof weighting === "function"
    ? weighting
    : (unit: number) => holeWeight(unit, weighting);
}

/**
 * Weighted swing still on the table = Σ weight over the UNPLAYED holes. Takes the
 * actual unplayed-hole SET (not a scalar count) so a mid-round gap — match play
 * allows partial / out-of-order entry — is counted with each unplayed hole's real
 * weight, not "holes 1..k done, the rest remaining". This is the value close-out and
 * dormie compare against (§4): `matchClosed = holesUp > remainingSwing`.
 */
export function remainingSwing(unplayedHoles: Iterable<number>, weighting: Weighting): number {
  const weightOf = toUnitWeight(weighting);
  let sum = 0;
  for (const h of unplayedHoles) sum += weightOf(h);
  return sum;
}

/**
 * Is this hole glorious (worth 2×)? The ONE predicate the visual layer (scorecard
 * diamond/bracket/wash, score-entry banner) must call — never re-inline
 * `hole > 18 − n` in a component. `hole` is the engine's POSITION (1-based), the
 * same numbering `holeWeight`/`buildDecided` use, not a display label.
 */
export function isGloriousHole(hole: number, cfg: GloriousConfig): boolean {
  return holeWeight(hole, cfg) === 2;
}
