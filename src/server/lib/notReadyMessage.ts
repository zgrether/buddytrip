import { getGameTypeDefinition } from "@/lib/gameTypes";

/**
 * The go-live refusal `save_game_config` raises for a competition game worth 0
 * points, EXACTLY as the database words it (the text after `NOT_READY:`).
 *
 * Keyed on the TEXT because the refusal has no code of its own yet, and
 * redefining a function that size for one code is not worth it (ruling, PR 6b).
 * The proper code lands the next time `save_game_config` is redefined anyway.
 * Until then this string is a two-sided contract with the SQL, and
 * `games.saveConfig.test.ts` pins it against the real database message: a
 * rewording there fails CI instead of silently reverting the copy below.
 */
export const POINT_VALUE_NOT_READY = "set a point value before enabling scoring";

/**
 * What the Save banner says for a NOT_READY refusal.
 *
 * The point-value refusal gets the one piece of advice the database cannot
 * give: a game that was meant as a practice round and was added to the cup by
 * mistake can be re-added as a side game, where no point value is asked for.
 * That half is offered only when the FORMAT can be a side game, read from its
 * `allowedContainers` declaration rather than a list of names, so a format that
 * gains `side_game` (PR 7) gets the advice by editing the declaration alone.
 *
 * Every other refusal passes through as before (093): the RPC's text is
 * specific when it has something specific to say.
 */
export function notReadyMessage(detail: string | undefined, gameTypeId: string | null): string {
  if (detail === POINT_VALUE_NOT_READY) {
    const canBeSideGame = getGameTypeDefinition(gameTypeId)?.allowedContainers.includes("side_game") === true;
    return canBeSideGame
      ? "Set a point value, or delete this game and add it again as a side game."
      : "Set a point value before enabling scoring.";
  }
  return detail || "Finish setting up this game before switching it to scoring.";
}
