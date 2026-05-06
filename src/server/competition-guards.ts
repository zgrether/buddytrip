import { TRPCError } from "@trpc/server";

/**
 * Confirm the given competitionId belongs to ctx.tripId.
 *
 * This is defense in depth: requireTripMember/requireTripRole already
 * authorize the user against the trip, but procedures also accept a
 * competitionId in their input that an attacker could swap to point
 * at a different trip's competition. RLS would still block reads, but
 * we want a clear NOT_FOUND/FORBIDDEN at the API boundary.
 *
 * Result is cached on `ctx.competitionTripCache` so repeated calls in
 * the same request batch (e.g. comp-tab loads with several procedures
 * targeting the same competitionId) collapse to a single SELECT.
 */
export async function assertCompetitionInTrip(
  ctx: {
    supabase: { from: (t: string) => unknown };
    tripId?: string;
    competitionTripCache: Map<string, string>;
  },
  competitionId: string,
): Promise<void> {
  const cached = ctx.competitionTripCache.get(competitionId);
  if (cached !== undefined) {
    if (cached !== ctx.tripId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Competition does not belong to this trip",
      });
    }
    return;
  }

  const { data, error } = await (
    ctx.supabase.from("competitions") as unknown as {
      select: (s: string) => {
        eq: (
          c: string,
          v: string,
        ) => {
          single: () => Promise<{
            data: { trip_id: string } | null;
            error: unknown;
          }>;
        };
      };
    }
  )
    .select("trip_id")
    .eq("id", competitionId)
    .single();

  if (error || !data) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
  }
  ctx.competitionTripCache.set(competitionId, data.trip_id);
  if (data.trip_id !== ctx.tripId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Competition does not belong to this trip",
    });
  }
}
