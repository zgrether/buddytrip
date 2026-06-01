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
  // create — Owner / Planner (organizers can curate Quick Info per the
  // header-dock redesign; the hierarchical middleware lets Owner through too)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        label: z.string().min(1).max(100),
        value: z.string().min(1).max(500),
        /** Explicit glyph chosen in the icon picker (lock/wifi/door/…); null
         *  falls back to label-inference on the client. */
        icon: z.string().min(1).max(32).nullable().optional(),
        sortOrder: z.number().int().default(0),
        isAlert: z.boolean().default(false),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("quick_info_tiles")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          label: input.label,
          value: input.value,
          icon: input.icon ?? null,
          created_by: ctx.user!.id,
          sort_order: input.sortOrder,
          is_alert: input.isAlert,
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
  // update — Owner / Planner
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        tileId: z.string(),
        label: z.string().min(1).max(100).optional(),
        value: z.string().min(1).max(500).optional(),
        /** null clears the explicit icon (falls back to label inference). */
        icon: z.string().min(1).max(32).nullable().optional(),
        sortOrder: z.number().int().optional(),
        isAlert: z.boolean().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {};
      if (input.label !== undefined) update.label = input.label;
      if (input.value !== undefined) update.value = input.value;
      if (input.icon !== undefined) update.icon = input.icon;
      if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
      if (input.isAlert !== undefined) update.is_alert = input.isAlert;

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
  // remove — Owner / Planner
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), tileId: z.string() }))
    .use(requireTripRole("Planner"))
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
