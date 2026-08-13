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

export type PlacementState =
  | "undistributed"
  | "partial"
  | "complete"
  | "too_many_places";

/**
 * What decides how many finishing places a game HAS. The count alone is not
 * enough: the refusal has to name the thing the reader can go and change, and
 * those are different things per source ("add teams" is useless advice for a
 * bracket, whose place count comes from its own shape).
 */
export type PlaceCapacitySource = "teams" | "bracket";

/**
 * How many places this game can distribute across, and what decides it.
 *
 * `count: null` means "not knowable yet" — a query in flight, or a game with no
 * competition — and never refuses anything.
 */
export interface PlaceCapacity {
  count: number | null;
  source: PlaceCapacitySource;
}

export interface PlacementValidation {
  state: PlacementState;
  /** Sum of entered place values. */
  allocated: number;
  /** Owner-set total the split must reach. */
  total: number;
  /** total − allocated (how many points are left to place). */
  remaining: number;
  /** Saveable when undistributed (not started) OR complete (sum === total),
   *  AND the split doesn't configure more places than the game HAS. */
  saveable: boolean;
  /** Places configured (`values.length`) — echoed so callers can build the
   *  message without re-deriving it. */
  places: number;
  /** The ceiling this was checked against, and what set it. `count: null` =
   *  not supplied / not yet knowable. */
  capacity: PlaceCapacity;
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
 *
 * ── `capacity` — more places than the game HAS ──────────────────────────────
 * This parameter used to be `entityCount`, and it used to mean one thing:
 * TEAMS IN THE COMPETITION. That was right for every format that reached here,
 * because a placement split is applied to scoring entities and
 * `computeCompetitionLeaderboard` reads only `entity_type='team'` results
 * (stroke aggregates players into their team first, non-golf records team
 * placings directly). Match and rack don't reach here at all — they use
 * `per_match`, which has no place list.
 *
 * It stopped being the only answer with the BRACKET format. A bracket's places
 * come from its TREE, not its roster: single elimination distinguishes only the
 * finalists, so it has 2 places, or 4 when a consolation match adds 3rd/4th.
 * That is independent of team count — a two-team cup can run a four-place
 * bracket, because the places are finishing positions among ENTRANTS and several
 * entrants can belong to one team. Counting teams there would refuse a legal
 * setup, and the refusal would tell the reader to add teams, which would not
 * help and is not what they want.
 *
 * So the parameter now carries WHAT THE CEILING IS and WHERE IT CAME FROM.
 * Formats that rank teams pass the team count as before; a bracket passes its
 * tree arity. Callers should build this with `placeCapacity.ts` rather than
 * assembling the object inline, so a new format answers the question once.
 *
 * Configuring MORE places than the game has is unsatisfiable, and it fails
 * quietly rather than loudly: `placementPoints` walks the STANDINGS, not the
 * distribution, so trailing values are simply never read. Two teams with
 * 5/4/3/2/1 award 5 and 4 — the other 6 points go nowhere. Worse, points
 * -AVAILABLE still counts the owner-set total (15), so the cup's clinch number
 * is computed against points that cannot be awarded.
 *
 * FEWER places is LEGITIMATE and must keep saving — `dist()` returns 0 out of
 * range, so 4 teams on a 2-value split means 3rd and 4th earn nothing, which is
 * #807's established behaviour. Only the excess is refused.
 *
 * `capacity` is OPTIONAL and a null/0 count NEVER refuses. A game can be
 * configured before its competition has teams (or before its draw exists), and
 * refusing there would block a setup that is merely incomplete rather than wrong.
 */
export function validatePlacement(
  total: number,
  values: number[],
  capacity?: PlaceCapacity | null
): PlacementValidation {
  const cap: PlaceCapacity = capacity ?? { count: null, source: "teams" };
  const ceiling = cap.count ?? null;
  const places = values.length;

  if (places === 0) {
    return {
      state: "undistributed",
      allocated: 0,
      total,
      remaining: total,
      saveable: true,
      places,
      capacity: cap,
    };
  }

  const allocated = values.reduce((sum, v) => sum + (v || 0), 0);

  // Checked BEFORE the sum: a split with too many places is wrong even when it
  // adds up, and "5 places, 2 teams" is the more useful thing to say than
  // "3 left to place".
  if (ceiling != null && ceiling > 0 && places > ceiling) {
    return {
      state: "too_many_places",
      allocated,
      total,
      remaining: total - allocated,
      saveable: false,
      places,
      capacity: cap,
    };
  }

  const complete = allocated === total;
  return {
    state: complete ? "complete" : "partial",
    allocated,
    total,
    remaining: total - allocated,
    saveable: complete,
    places,
    capacity: cap,
  };
}

/**
 * The one message for a refused split, so the client gate and both server
 * gates can't word it differently. Returns null when the split is saveable.
 *
 * Names the control to use, not just the state (#809) — a message that only
 * reports "5 places, 2 teams" leaves the reader to work out that places are
 * what should change.
 *
 * The too-many-places copy branches on the capacity SOURCE, because the second
 * half of that advice is only true for one of them. "or add teams" is a real
 * option when teams set the ceiling; for a bracket it is not — the ceiling is
 * the shape of the draw, and the way to get a 3rd and 4th place is the
 * consolation match. Naming the wrong lever is worse than naming none.
 */
export function placementRefusalMessage(v: PlacementValidation): string | null {
  if (v.saveable) return null;
  if (v.state === "too_many_places") {
    const n = v.capacity.count;
    if (v.capacity.source === "bracket") {
      return (
        `${v.places} places configured, but this bracket finishes ${n} — ` +
        `remove places until there are at most ${n}, or turn on the 3rd-place match to finish 4. ` +
        `Places past the last finisher are never awarded.`
      );
    }
    return (
      `${v.places} places configured, ${n} ${n === 1 ? "team" : "teams"} in this competition — ` +
      `remove places until there are at most ${n}, or add teams. ` +
      `Places past the last team are never awarded.`
    );
  }
  const over = v.remaining < 0;
  return (
    `Points must total ${v.total} exactly — ${v.allocated} allocated, ` +
    `${over ? `${-v.remaining} over` : `${v.remaining} left to place`}.`
  );
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
