import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const teamsRouter = router({
  // -----------------------------------------------------------------------
  // list — all teams for a trip's event (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("teams")
        .select("*")
        .eq("event_id", input.eventId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch teams",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // upsert — create or update a team (canEdit)
  // -----------------------------------------------------------------------
  upsert: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        eventId: z.string(),
        name: z.string().min(1).max(100),
        shortName: z.string().min(1).max(20),
        color: z.string().min(1),
        colorDim: z.string().min(1),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("teams")
        .upsert({
          id: input.id,
          event_id: input.eventId,
          name: input.name,
          short_name: input.shortName,
          color: input.color,
          color_dim: input.colorDim,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to upsert team: ${error.message}`,
        });
      }

      return data;
    }),
});
