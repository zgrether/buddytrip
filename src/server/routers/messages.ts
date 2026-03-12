import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

export const messagesRouter = router({
  // -----------------------------------------------------------------------
  // list — any member can view trip chat; team chat requires team membership
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        channel: z.enum(["trip", "team"]).default("trip"),
        teamId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("messages")
        .select("id, trip_id, user_id, channel, team_id, text, created_at")
        .eq("trip_id", ctx.tripId)
        .eq("channel", input.channel)
        .order("created_at", { ascending: false })
        .limit(input.limit);

      if (input.channel === "team") {
        if (!input.teamId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "teamId is required for team channel",
          });
        }
        query = query.eq("team_id", input.teamId);
      }

      if (input.cursor) {
        query = query.lt("created_at", input.cursor);
      }

      const { data, error } = await query;

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch messages",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // send — any member can send to trip chat; team chat requires membership
  // -----------------------------------------------------------------------
  send: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        channel: z.enum(["trip", "team"]).default("trip"),
        teamId: z.string().optional(),
        text: z.string().min(1).max(5000),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      if (input.channel === "team" && !input.teamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "teamId is required for team channel",
        });
      }

      const { data, error } = await ctx.supabase
        .from("messages")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          user_id: ctx.user!.id,
          channel: input.channel,
          team_id: input.channel === "team" ? input.teamId : null,
          text: input.text,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to send message: ${error.message}`,
        });
      }

      return data;
    }),
});
