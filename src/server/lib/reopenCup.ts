import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

/**
 * A finished points cup is playing again (spec §5): a game was added, or its scoring
 * was reset. Its next emptying asks again, and the ties reviewed at the last Final
 * were about standings that no longer stand, so that review goes too.
 *
 * Touches only a cup that finished. A failure throws: callers run this before the
 * write it belongs to, so nothing has happened yet.
 */
export async function reopenFinishedCup(client: SupabaseClient, competitionId: string): Promise<void> {
  const { error } = await client
    .from("competitions")
    .update({ status: "upcoming", tiebreak_order: null })
    .eq("id", competitionId)
    .eq("status", "completed");
  if (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to reopen the cup: ${error.message}` });
  }
}
