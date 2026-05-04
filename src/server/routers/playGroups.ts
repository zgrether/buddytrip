import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * play_groups — per-event tee time groupings. New schema (migration 062):
 * name + tee_time are nullable (the UI auto-labels groups), player_ids is
 * a text[] of user ids.
 */
export const playGroupsRouter = router({
  // -----------------------------------------------------------------------
  // list — all groups for an event
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("play_groups")
        .select("*")
        .eq("event_id", input.eventId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch play groups: ${error.message}`,
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — add a group (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        eventId: z.string(),
        name: z.string().max(100).optional(),
        teeTime: z.string().max(40).optional(),
        playerIds: z.array(z.string()),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from("play_groups")
        .insert({
          event_id: input.eventId,
          name: input.name ?? null,
          tee_time: input.teeTime ?? null,
          player_ids: input.playerIds,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create play group: ${insertErr?.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("play_groups")
        .select("*")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created play group: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — modify a group (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        groupId: z.string(),
        name: z.string().max(100).nullable().optional(),
        teeTime: z.string().max(40).nullable().optional(),
        playerIds: z.array(z.string()).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.teeTime !== undefined) patch.tee_time = input.teeTime;
      if (input.playerIds !== undefined) patch.player_ids = input.playerIds;

      const { data, error } = await ctx.supabase
        .from("play_groups")
        .update(patch)
        .eq("id", input.groupId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update play group: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove a group (canEdit)
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
          message: `Failed to delete play group: ${error.message}`,
        });
      }

      return { success: true };
    }),
});
