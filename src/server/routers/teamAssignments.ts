import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const teamAssignmentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all assignments for an event (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .select("event_id, team_id, user_id")
        .eq("event_id", input.eventId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch team assignments",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // assign — assign a player to a team (canEdit)
  // -----------------------------------------------------------------------
  assign: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .upsert(
          {
            event_id: input.eventId,
            team_id: input.teamId,
            user_id: input.userId,
          },
          { onConflict: "event_id,user_id" }
        )
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign player: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — remove a player from their team (canEdit)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("team_assignments")
        .delete()
        .eq("event_id", input.eventId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove assignment",
        });
      }

      return { success: true };
    }),
});
