import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * team_assignments — composite PK (competition_id, user_id) means a user
 * is on at most one team per competition. assign() upserts that pairing;
 * remove() deletes it (Owner only per spec).
 */

/** Shared between teamAssignments.list and competitions.hydrate. */
export async function listTeamAssignments(
  ctx: { supabase: SupabaseClient },
  competitionId: string,
) {
  const { data, error } = await ctx.supabase
    .from("team_assignments")
    .select("*")
    .eq("competition_id", competitionId);

  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch team assignments: ${error.message}`,
    });
  }
  return data ?? [];
}

export const teamAssignmentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all assignments for a competition
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx, input }) => listTeamAssignments(ctx, input.competitionId)),

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
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
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
