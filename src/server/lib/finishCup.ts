import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

/**
 * Move a cup to Final: one conditional UPDATE, `… AND status <> 'completed'
 * RETURNING id`. True only for the call whose update moved the row.
 *
 * This is the "once" for whatever a finish announces. Two organizers tapping at
 * the same moment both pass the board's own "already Final?" read, but their
 * UPDATEs serialize on the row lock and the second re-checks the WHERE after
 * the first commits, so it returns no row. A read-then-write could not say
 * that. `status` is NOT NULL, so the filter skips no row it should not.
 */
export async function flipCupToCompleted(
  client: SupabaseClient,
  ids: { tripId: string; competitionId: string },
  tiebreakOrder?: string[]
): Promise<boolean> {
  const { data, error } = await client
    .from("competitions")
    .update(tiebreakOrder ? { status: "completed", tiebreak_order: tiebreakOrder } : { status: "completed" })
    .eq("id", ids.competitionId)
    .eq("trip_id", ids.tripId)
    .neq("status", "completed")
    .select("id");
  if (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Couldn't finish the cup: ${error.message}` });
  }
  return (data?.length ?? 0) > 0;
}
