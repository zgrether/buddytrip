/**
 * Game-configuration validation + derivation (Slice D add-game flow) — PURE,
 * client-safe. No server/DB deps so the Configuration screen (client), the
 * server enforcement (`games.setPointsDistribution`), and the leaderboard
 * available-points (`competitionLeaderboard.ts`) all use the SAME primitives and
 * can't diverge (CLAUDE.md enforced patterns #8/#9).
 *
 * Two points models, owner-set on the Game tab:
 *  - PLACEMENT (golf placement, manual/generic): owner sets a TOTAL; the
 *    Configuration tab distributes it across places (`points_distribution`
 *    values) and MUST sum to the total once distribution begins.
 *  - MATCH (singles/doubles match play): owner sets a PER-MATCH value; the
 *    total is DERIVED = value × matchCount, where matchCount comes from team
 *    SIZES (the smaller team bounds it) — knowable before pairings, so the
 *    available total is stable across the week (#357/#358 model, kept).
 *
 * `deriveMatchCount` is the single match-count primitive — the UI readout AND
 * the leaderboard available-points both call it (one derivation, two consumers).
 */

export type MatchFormat = "singles" | "doubles";

/**
 * Match count from team sizes — the cap bounded by the smaller team:
 *   singles = min(sizes); doubles = floor(min(sizes) / 2).
 * Needs ≥2 sized teams to cross the team line. Returns `null` when it can't be
 * known yet (fewer than 2 teams have members) — the "matches not set" /
 * calm-pending state. Zero-size teams are treated as not-yet-sized.
 */
export function deriveMatchCount(
  teamSizes: number[],
  format: MatchFormat
): number | null {
  const sized = teamSizes.filter((n) => n > 0);
  if (sized.length < 2) return null; // not enough defined to know
  const min = Math.min(...sized);
  return format === "doubles" ? Math.floor(min / 2) : min;
}

// ── Placement distribution validation ────────────────────────────────────────

export type PlacementState = "undistributed" | "partial" | "complete";

export interface PlacementValidation {
  state: PlacementState;
  /** Sum of entered place values. */
  allocated: number;
  /** Owner-set total the split must reach. */
  total: number;
  /** total − allocated (how many points are left to place). */
  remaining: number;
  /** Saveable when undistributed (not started) OR complete (sum === total). */
  saveable: boolean;
}

/**
 * Validate a placement split against the owner-set total. The trigger is
 * "distribution has begun" = `values` non-empty (1st place entered) — NOT
 * "> 0", so a typed 0 still counts as started.
 *
 *  - values EMPTY (1st place nil / untouched)      → undistributed → saveable
 *  - values non-empty, sum === total               → complete      → saveable
 *  - values non-empty, sum !== total               → partial       → BLOCKED
 *
 * 0-value LOWER places are fine as long as the sum still equals the total
 * (e.g. total 8 → [5,3,0] is complete). The caller maps "1st place empty" to an
 * empty array; any entered value (incl. 0) yields a non-empty array.
 */
export function validatePlacement(
  total: number,
  values: number[]
): PlacementValidation {
  if (values.length === 0) {
    return { state: "undistributed", allocated: 0, total, remaining: total, saveable: true };
  }
  const allocated = values.reduce((sum, v) => sum + (v || 0), 0);
  const complete = allocated === total;
  return {
    state: complete ? "complete" : "partial",
    allocated,
    total,
    remaining: total - allocated,
    saveable: complete,
  };
}

// ── Match readout (retires "projected") ──────────────────────────────────────

export interface MatchReadout {
  /** Derived match count, or null when teams aren't sized yet. */
  matchCount: number | null;
  /** value × matchCount, or null when the count is unknown. */
  available: number | null;
  /** "N matches ready" when known, else "matches not set". */
  label: string;
}

/**
 * The match-game points readout: the available total = per-match value ×
 * matchCount, shown concretely ("8 matches ready") or pending ("matches not
 * set"). Uses the SAME `deriveMatchCount` the leaderboard uses. No "projected".
 */
export function matchReadout(
  value: number,
  teamSizes: number[],
  format: MatchFormat
): MatchReadout {
  const matchCount = deriveMatchCount(teamSizes, format);
  if (matchCount == null) {
    return { matchCount: null, available: null, label: "matches not set" };
  }
  return {
    matchCount,
    available: value * matchCount,
    label: `${matchCount} match${matchCount === 1 ? "" : "es"} ready`,
  };
}

// ── Fits-roster soft flag ─────────────────────────────────────────────────────

export type FitState = "ok" | "warn" | "pending";

export interface FitResult {
  state: FitState;
  /** Human-readable warning, null unless state === "warn". */
  message: string | null;
}

const OK: FitResult = { state: "ok", message: null };
const PENDING: FitResult = { state: "pending", message: null };

/**
 * Placement fit: warns when MORE places are configured than teams defined (the
 * extra places can never be awarded). Calm-PENDING when no teams are defined yet
 * (not enough to know). Self-clears as the roster/distribution changes to fit.
 */
export function placementFit(values: number[], numTeams: number): FitResult {
  if (numTeams <= 0) return PENDING; // no teams yet — calm, not a warning
  if (values.length > numTeams) {
    const extra = values.length - numTeams;
    return {
      state: "warn",
      message: `${values.length} places but ${numTeams} team${numTeams === 1 ? "" : "s"} — ${extra} place${extra === 1 ? "" : "s"} can't be awarded`,
    };
  }
  return OK;
}

/**
 * Match fit: doubles warns when a defined team has an ODD member count (someone
 * can't be paired). Singles never warns on parity (min bounds it). Calm-PENDING
 * when fewer than 2 teams are sized.
 */
export function matchFit(teamSizes: number[], format: MatchFormat): FitResult {
  const sized = teamSizes.filter((n) => n > 0);
  if (sized.length < 2) return PENDING; // not enough defined to know
  if (format === "doubles" && sized.some((n) => n % 2 !== 0)) {
    return {
      state: "warn",
      message: "Doubles needs even teams — a team has an odd number, so someone won't be paired",
    };
  }
  return OK;
}
