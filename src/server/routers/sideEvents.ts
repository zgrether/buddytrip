import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const sideEventsRouter = router({
  // -----------------------------------------------------------------------
  // list — get side events for a round's event (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("side_events")
        .select("*")
        .eq("event_id", input.eventId)
        .order("name");

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch side events",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — create a side event (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        eventId: z.string().min(1),
        name: z.string().min(1).max(200),
        icon: z.string().min(1).max(50),
        pointsAvailable: z.number().min(0),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("side_events")
        .insert({
          id: input.id,
          event_id: input.eventId,
          name: input.name,
          icon: input.icon,
          points_available: input.pointsAvailable,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create side event: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // submitResult — record which team won a side event (canEdit)
  // -----------------------------------------------------------------------
  submitResult: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        sideEventId: z.string().min(1),
        result: z.record(z.string(), z.number()),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("side_events")
        .update({
          result: input.result,
          status: "complete",
        })
        .eq("id", input.sideEventId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to submit result: ${error.message}`,
        });
      }

      return data;
    }),
});
