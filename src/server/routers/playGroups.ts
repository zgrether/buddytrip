import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const playGroupsRouter = router({
  // -----------------------------------------------------------------------
  // list — all play groups for an event (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("play_groups")
        .select("*")
        .eq("event_id", input.eventId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch play groups",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — add a play group (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        eventId: z.string(),
        name: z.string().min(1).max(100),
        teeTime: z.string().min(1),
        playerIds: z.array(z.string()),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("play_groups")
        .insert({
          id: input.id,
          event_id: input.eventId,
          name: input.name,
          tee_time: input.teeTime,
          player_ids: input.playerIds,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create play group: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — edit a play group (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        groupId: z.string(),
        name: z.string().min(1).max(100).optional(),
        teeTime: z.string().optional(),
        playerIds: z.array(z.string()).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.teeTime !== undefined) update.tee_time = input.teeTime;
      if (input.playerIds !== undefined) update.player_ids = input.playerIds;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("play_groups")
        .update(update)
        .eq("id", input.groupId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update play group",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove a play group (canEdit)
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), groupId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("play_groups")
        .delete()
        .eq("id", input.groupId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete play group",
        });
      }
    }),
});
