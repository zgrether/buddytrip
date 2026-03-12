import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

export const ideaCommentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all comments for an idea (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), ideaId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("idea_comments")
        .select("id, trip_id, idea_id, user_id, text, created_at")
        .eq("trip_id", ctx.tripId)
        .eq("idea_id", input.ideaId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch comments",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — any member can comment
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        ideaId: z.string(),
        id: z.string().min(1),
        text: z.string().min(1).max(2000),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("idea_comments")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          idea_id: input.ideaId,
          user_id: ctx.user!.id,
          text: input.text,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create comment: ${error.message}`,
        });
      }

      return data;
    }),
});
