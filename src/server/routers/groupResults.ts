import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

export const groupResultsRouter = router({
  // -----------------------------------------------------------------------
  // list — all results for a round (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), roundId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("group_results")
        .select("*")
        .eq("round_id", input.roundId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch group results",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // submit — submit result for a group in a round (any member per PERMISSIONS.md)
  // -----------------------------------------------------------------------
  submit: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        roundId: z.string(),
        groupId: z.string(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("group_results")
        .upsert(
          {
            round_id: input.roundId,
            group_id: input.groupId,
            submitted_by: ctx.user!.id,
          },
          { onConflict: "round_id,group_id" }
        )
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
