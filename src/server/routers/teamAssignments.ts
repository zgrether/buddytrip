import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const teamAssignmentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all assignments for an event (any member)
  //
  // Returns both user_id and guest_crew_id fields, plus a computed memberId
  // (user_id ?? guest_crew_id) for use as a stable key in UI code.
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .select("id, event_id, team_id, user_id, guest_crew_id")
        .eq("event_id", input.eventId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch team assignments",
        });
      }

      return (data ?? []).map((a) => ({
        ...a,
        memberId: (a.user_id ?? a.guest_crew_id) as string,
      }));
    }),

  // -----------------------------------------------------------------------
  // assign — assign a player (real or ghost) to a team (canEdit)
  //
  // Provide either userId or guestCrewId (not both).
  // If the player is already assigned, updates their team.
  // -----------------------------------------------------------------------
  assign: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        teamId: z.string(),
        userId: z.string().optional(),
        guestCrewId: z.string().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      if (!input.userId && !input.guestCrewId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either userId or guestCrewId is required",
        });
      }

      // Check for existing assignment
      let existingQuery = ctx.supabase
        .from("team_assignments")
        .select("id")
        .eq("event_id", input.eventId);

      if (input.userId) {
        existingQuery = existingQuery.eq("user_id", input.userId);
      } else {
        existingQuery = existingQuery.eq("guest_crew_id", input.guestCrewId!);
      }

      const { data: existing } = await existingQuery.maybeSingle();

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

        return { ...data, memberId: (data.user_id ?? data.guest_crew_id) as string };
      }

      // New assignment
      const { data, error } = await ctx.supabase
        .from("team_assignments")
        .insert({
          id: crypto.randomUUID(),
          event_id: input.eventId,
          team_id: input.teamId,
          user_id: input.userId ?? null,
          guest_crew_id: input.guestCrewId ?? null,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign player: ${error.message}`,
        });
      }

      return { ...data, memberId: (data.user_id ?? data.guest_crew_id) as string };
    }),

  // -----------------------------------------------------------------------
  // remove — remove a player from their team (canEdit)
  //
  // Provide either userId or guestCrewId.
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        userId: z.string().optional(),
        guestCrewId: z.string().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      if (!input.userId && !input.guestCrewId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either userId or guestCrewId is required",
        });
      }

      let query = ctx.supabase
        .from("team_assignments")
        .delete()
        .eq("event_id", input.eventId);

      if (input.userId) {
        query = query.eq("user_id", input.userId);
      } else {
        query = query.eq("guest_crew_id", input.guestCrewId!);
      }

      const { error } = await query;

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove assignment",
        });
      }

      return { success: true };
    }),
});
