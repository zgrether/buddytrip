import { canBeSideGame } from "@/lib/gameTypes";

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
 * The point-value refusal gets the one piece of advice the database cannot
 * give: a game that was meant as a practice round and was added to the cup by
 * mistake can be re-added as a side game, where no point value is asked for.
 * That half is offered only when the FORMAT can be a side game, read from its
 * `recordsPerPersonResults` declaration (`canBeSideGame`) rather than a list of
 * names, so a format that gains a per-person writer gets the advice by editing
 * the declaration alone.
 *
 * Every other refusal passes through as before (093): the RPC's text is
 * specific when it has something specific to say.
 */
export function notReadyMessage(
  detail: string | undefined,
  hint: string | null | undefined,
  gameTypeId: string | null
): string {
  if (hint === POINT_VALUE_HINT) {
    return canBeSideGame(gameTypeId)
      ? "Set a point value, or delete this game and add it again as a side game."
      : "Set a point value before enabling scoring.";
  }
  return detail || "Finish setting up this game before switching it to scoring.";
}
