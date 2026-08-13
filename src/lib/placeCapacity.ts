import type { PlaceCapacity } from "@/lib/gameConfig";
import type { BracketSide } from "@/lib/bracket";

/**
 * How many finishing places a game HAS — the ceiling a placement split is
 * validated against (`validatePlacement`).
 *
 * ── Why this is one module and not five expressions ─────────────────────────
 * The answer was `teams.length` at every call site, spelled slightly differently
 * each time: `teams.length || null` in one view, `teamsQ.data?.length ?? null` in
 * another, `teamCountForGame()` on the server, and an `entityCount` prop threaded
 * through a third. Five derivations of one number is how a sixth gets it wrong —
 * and the bracket is the sixth, because it is the first format whose answer is
 * NOT the team count.
 *
 * Callers ask this module; they do not assemble a `PlaceCapacity` inline.
 */

/**
 * The default: formats whose places are TEAMS in the competition.
 *
 * `computeCompetitionLeaderboard` ranks team ids and reads only
 * `entity_type='team'` results, so for stroke and non-golf the number of
 * distinguishable finishing positions is exactly the number of teams.
 *
 * A null/absent count means "not knowable yet" — a game configured before its
 * competition has teams, or a query in flight — and never refuses.
 */
export function teamPlaceCapacity(teamCount: number | null | undefined): PlaceCapacity {
  return { count: teamCount ?? null, source: "teams" };
}

/**
 * A bracket's places come from its TREE, not its roster.
 *
 * Single elimination distinguishes only the finalists — 1st and 2nd — because
 * everyone knocked out earlier lost to someone who also lost, and the draw never
 * separates them. A consolation match adds exactly 3rd and 4th. So the answer is
 * 2, or 4 with a 3rd-place match, and it does NOT scale with the field: a
 * 32-entrant bracket still finishes 2 (or 4).
 *
 * Read from the DRAW rather than from `bracket_config.consolation`, deliberately.
 * The flag is a request; the draw is what the request produced. `buildDraw`
 * refuses a consolation match below three entrants — a two-entrant bracket is one
 * match, so its "losing semi-finalists" are a single person — and reading the flag
 * would promise 4 places to a bracket that will only ever finish 2.
 *
 * An EMPTY draw (fewer than two entrants, so nothing to play) yields null rather
 * than 0: the pool is still being built, which is incomplete, not wrong.
 *
 * Takes only `{ bracket }` rather than a whole `BracketDrawMatch` because that is
 * all it reads — which lets the server hand it `bracket_matches` rows straight
 * from a `select("bracket")` without rebuilding the tree.
 */
export function bracketPlaceCapacity(draw: readonly { bracket: BracketSide }[]): PlaceCapacity {
  if (draw.length === 0) return { count: null, source: "bracket" };
  const hasConsolation = draw.some((m) => m.bracket === "consolation");
  return { count: hasConsolation ? 4 : 2, source: "bracket" };
}

/**
 * The capacity for a game, given what is known about it.
 *
 * `draw` is present only for a bracket; every other format falls through to the
 * team count. Kept as one entry point so a call site does not have to know which
 * formats are special — it passes what it has and gets the right ceiling.
 */
export function placeCapacityFor(
  { draw, teamCount }: { draw?: readonly { bracket: BracketSide }[] | null; teamCount?: number | null }
): PlaceCapacity {
  if (draw && draw.length > 0) return bracketPlaceCapacity(draw);
  return teamPlaceCapacity(teamCount);
}
