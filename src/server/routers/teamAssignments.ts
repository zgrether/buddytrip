import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const teamAssignmentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all assignments for an event (any member)
  //
  // All players (real or guest) have a user_id pointing to a users row.
  // memberId is always user_id.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .select("id, event_id, team_id, user_id")
        .eq("event_id", input.eventId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch team assignments",
        });
      }

      return (data ?? []).map((a) => ({
        ...a,
        memberId: a.user_id as string,
      }));
    }),

  // -----------------------------------------------------------------------
  // assign — assign a player to a team (canEdit)
  //
  // Provide userId. If the player is already assigned, updates their team.
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
      // Check for existing assignment
      const { data: existing } = await ctx.supabase
        .from("team_assignments")
        .select("id")
        .eq("event_id", input.eventId)
        .eq("user_id", input.userId)
        .maybeSingle();

      if (existing) {
        // Update team on existing assignment
        const { data, error } = await ctx.supabase
          .from("team_assignments")
          .update({ team_id: input.teamId })
          .eq("id", existing.id)
          .select()
          .single();

        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update team assignment: ${error.message}`,
          });
        }

        return { ...data, memberId: data.user_id as string };
      }

      // New assignment
      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .insert({
          id: crypto.randomUUID(),
          event_id: input.eventId,
          team_id: input.teamId,
          user_id: input.userId,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign player: ${error.message}`,
        });
      }

      return { ...data, memberId: data.user_id as string };
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
