import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const eventsRouter = router({
  // -----------------------------------------------------------------------
  // getByTrip — get the event for a trip (any member)
  // -----------------------------------------------------------------------
  getByTrip: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("events")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .maybeSingle();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch event",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // upsert — create or update event (canEdit)
  // -----------------------------------------------------------------------
  upsert: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        subtitle: z.string().max(500).optional(),
        motto: z.string().max(500).optional(),
        location: z.string().min(1).max(500),
        dates: z.string().min(1).max(100),
        status: z.enum(["upcoming", "active", "completed"]).optional(),
        competitionType: z.enum(["RYDER_CUP", "NORMAL"]).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("events")
        .upsert(
          {
            id: input.id,
            trip_id: ctx.tripId,
            title: input.title,
            subtitle: input.subtitle ?? "",
            motto: input.motto ?? "",
            location: input.location,
            dates: input.dates,
            status: input.status ?? "upcoming",
            competition_type: input.competitionType ?? "RYDER_CUP",
          },
          { onConflict: "trip_id" }
        )
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to upsert event: ${error.message}`,
        });
      }

      // Link event to trip
      await ctx.supabase
        .from("trips")
        .update({ event_id: input.id })
        .eq("id", ctx.tripId);

      return data;
    }),
});
