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
  // listScoresByEvent — aggregated team scores per round for an event
  // Uses the round_results view: SUM(group_result_scores.points) GROUP BY round_id, team_id
  // -----------------------------------------------------------------------
  listScoresByEvent: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      // Get all round IDs for this event
      const { data: rounds, error: roundsErr } = await ctx.supabase
        .from("rounds")
        .select("id")
        .eq("event_id", input.eventId);

      if (roundsErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch rounds for scores",
        });
      }

      const roundIds = (rounds ?? []).map((r) => r.id);
      if (roundIds.length === 0) return [];

      // Fetch aggregated scores from the round_results view
      const { data: scores, error: scoresErr } = await ctx.supabase
        .from("round_results")
        .select("round_id, team_id, total_points")
        .in("round_id", roundIds);

      if (scoresErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch round scores",
        });
      }

      return scores ?? [];
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
