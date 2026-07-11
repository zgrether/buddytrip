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
 * Read the LIVE glorious config off a game, FORMAT-GUARDED. Returns `NO_GLORIOUS`
 * for any game_type_id outside match singles/doubles (via `isMatchPlayFormat`) — so
 * stroke/rack/manual stay inert even if their `modifiers` jsonb somehow carries
 * `glorious_holes`. Guarded on the id, NEVER the competition `scoring_model`: rack is
 * `match_play` by scoring_model yet is excluded here, by design (the §2 trap).
 */
export function gloriousConfig(
  gameTypeId: string | null | undefined,
  modifiers: ModifiersMap | null | undefined
): GloriousConfig {
  if (!isMatchPlayFormat(gameTypeId ?? null)) return NO_GLORIOUS;
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
 * Weighted swing still on the table = Σ weight over the UNPLAYED holes. Takes the
 * actual unplayed-hole SET (not a scalar count) so a mid-round gap — match play
 * allows partial / out-of-order entry — is counted with each unplayed hole's real
 * weight, not "holes 1..k done, the rest remaining". This is the value close-out and
 * dormie compare against (§4): `matchClosed = holesUp > remainingSwing`.
 */
export function remainingSwing(unplayedHoles: Iterable<number>, cfg: GloriousConfig): number {
  let sum = 0;
  for (const h of unplayedHoles) sum += holeWeight(h, cfg);
  return sum;
}
