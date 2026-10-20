/**
 * The CODE `save_game_config` attaches to its go-live refusal for a competition
 * game worth 0 points: `RAISE … USING HINT = 'point_value'` (migration 214),
 * which PostgREST passes through as the error's `hint`.
 *
 * This used to be keyed on the refusal's TEXT, because it had no code of its own
 * and redefining a function that size for one code wasn't worth it (ruling, PR
 * 6b): "the proper code lands the next time `save_game_config` is redefined".
 * 214 was that redefinition. The database's wording can now change without the
 * advice below silently reverting. `games.saveConfig.test.ts` pins the hint
 * end to end against the real refusal.
 */
export const POINT_VALUE_HINT = "point_value";

/**
 * What the Save banner says for a NOT_READY refusal.
 *
 * The point-value refusal adds "or play it as a side game" ONLY when that exit
 * is open to this person (Zach, the #1668 look): `sideGameExitOpen` decides,
 * from the same rule the go-live prompt reads plus the limits migration 218
 * enforces. Anywhere else, naming it would send the reader to a door they
 * cannot open. (It used to say "delete this game and add it again as a side
 * game"; 218 made that detour unnecessary.)
 *
 * Every other refusal passes through as before (093): the RPC's text is
 * specific when it has something specific to say.
 */
export function notReadyMessage(
  detail: string | undefined,
  hint: string | null | undefined,
  sideGameExit: boolean
): string {
  if (hint === POINT_VALUE_HINT) {
    return sideGameExit ? "Set a point value, or play it as a side game." : "Set a point value before enabling scoring.";
  }
  return detail || "Finish setting up this game before switching it to scoring.";
}
