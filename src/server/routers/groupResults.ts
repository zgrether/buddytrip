import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

/**
 * groupResults — STUBBED in Phase A.
 *
 * The legacy implementation queried the dropped `rounds`,
 * `group_result_scores`, and `round_results` view. Migration 062 retired
 * those, and the new scoring model is owned by Phase B.
 *
 * Queries return empty arrays so existing prefetch calls and remaining
 * UI consumers don't crash. Mutations throw `NOT_IMPLEMENTED` with a
 * clear message; the only caller (the live leaderboard) is stubbed
 * behind a placeholder UI in this same PR.
 */
export const groupResultsRouter = router({
  list: authedProcedure
    .input(z.object({ tripId: z.string(), roundId: z.string().optional() }))
    .use(requireTripMember)
    .query(async () => {
      return [] as Array<Record<string, unknown>>;
    }),

  listScoresByEvent: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string().optional() }))
    .use(requireTripMember)
    .query(async () => {
      return [] as Array<{ round_id: string; team_id: string; total_points: number }>;
    }),

  listScoresForRound: authedProcedure
    .input(z.object({ tripId: z.string(), roundId: z.string().optional() }))
    .use(requireTripMember)
    .query(async () => {
      return [] as Array<{
        round_id: string;
        group_id: string;
        team_id: string;
        points: number;
      }>;
    }),

  submit: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        roundId: z.string().optional(),
        groupId: z.string().optional(),
        eventId: z.string().optional(),
        scores: z
          .array(
            z.object({
              teamId: z.string(),
              points: z.number().min(0).max(1),
            })
          )
          .optional(),
      })
    )
    .use(requireTripMember)
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "Live scoring is being rebuilt for the new competition schema (Phase B).",
      });
    }),
});
