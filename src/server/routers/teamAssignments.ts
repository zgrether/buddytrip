import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * team_assignments — composite PK (competition_id, user_id) means a user
 * is on at most one team per competition. assign() upserts that pairing;
 * remove() deletes it (Owner only per spec).
 */

async function assertCompetitionInTrip(
  ctx: { supabase: { from: (t: string) => unknown }; tripId?: string },
  competitionId: string
) {
  const { data, error } = await (
    ctx.supabase.from("competitions") as unknown as {
      select: (s: string) => {
        eq: (
          c: string,
          v: string
        ) => { single: () => Promise<{ data: { trip_id: string } | null; error: unknown }> };
      };
    }
  )
    .select("trip_id")
    .eq("id", competitionId)
    .single();

  if (error || !data) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
  }
  if (data.trip_id !== ctx.tripId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Competition does not belong to this trip",
    });
  }
}

export const teamAssignmentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all assignments for a competition
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      await assertCompetitionInTrip(ctx, input.competitionId);

      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .select("*")
        .eq("competition_id", input.competitionId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch team assignments: ${error.message}`,
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // assign — set a user's team (canEdit). Upsert behaviour relies on the
  // composite PK (competition_id, user_id) — assign-twice replaces.
  // -----------------------------------------------------------------------
  assign: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        userId: z.string(),
        teamId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      await assertCompetitionInTrip(ctx, input.competitionId);

      const { data: inserted, error } = await ctx.supabase
        .from("team_assignments")
        .upsert(
          {
            competition_id: input.competitionId,
            user_id: input.userId,
            team_id: input.teamId,
          },
          { onConflict: "competition_id,user_id" }
        )
        .select()
        .single();

      if (error || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign team: ${error?.message}`,
        });
      }

      return inserted;
    }),

  // -----------------------------------------------------------------------
  // remove — clear a user's assignment (Owner only per spec)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("team_assignments")
        .delete()
        .eq("competition_id", input.competitionId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to remove team assignment: ${error.message}`,
        });
      }

      return { success: true };
    }),
});
