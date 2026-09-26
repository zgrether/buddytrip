import { TRPCError } from "@trpc/server";

/**
 * Migration 193's refusal, surfaced as the sentence it carries.
 *
 * The `game_participants` trigger refuses an unrostered player in a Match Play
 * cup with `UNROSTERED: <name> isn't on either team in this cup. Add them to a
 * team in Rosters first.` `games.saveConfig` already unwraps any `CODE: sentence`
 * refusal from its RPC. The TypeScript writers insert participants directly and
 * wrap every error as a 500 ("Failed to add players: UNROSTERED: …"), which hands
 * the reader a code and a server fault for what is a roster they can fix.
 *
 * Call it FIRST in a writer's error branch; it throws only for this refusal and
 * leaves every other error to the branch's own handling.
 */
export function throwIfUnrostered(error: { message?: string } | null | undefined): void {
  const refused = /^UNROSTERED:\s*([\s\S]+)$/.exec(error?.message?.trim() ?? "");
  if (refused) throw new TRPCError({ code: "PRECONDITION_FAILED", message: refused[1] });
}
