import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const quickInfoTilesRouter = router({
  // -----------------------------------------------------------------------
  // list — any member can view tiles
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("quick_info_tiles")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch tiles",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — Owner only (isOwner per PERMISSIONS.md)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        label: z.string().min(1).max(100),
        value: z.string().min(1).max(500),
        sortOrder: z.number().int().default(0),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("quick_info_tiles")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          label: input.label,
          value: input.value,
          created_by: ctx.user!.id,
          sort_order: input.sortOrder,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create tile: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — Owner only (isOwner)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        tileId: z.string(),
        label: z.string().min(1).max(100).optional(),
        value: z.string().min(1).max(500).optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {};
      if (input.label !== undefined) update.label = input.label;
      if (input.value !== undefined) update.value = input.value;
      if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("quick_info_tiles")
        .update(update)
        .eq("id", input.tileId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update tile",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — Owner only (isOwner)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), tileId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("quick_info_tiles")
        .delete()
        .eq("id", input.tileId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove tile",
        });
      }

      return { success: true };
    }),
});
