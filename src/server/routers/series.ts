import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";

export const seriesRouter = router({
  // -----------------------------------------------------------------------
  // list — list all series the user owns
  // -----------------------------------------------------------------------
  list: authedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("series")
      .select("*")
      .eq("owner_id", ctx.user!.id)
      .order("name");

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch series",
      });
    }

    return data ?? [];
  }),

  // -----------------------------------------------------------------------
  // create — create a new series (any authed user)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100),
        fullName: z.string().min(1).max(500),
        years: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("series")
        .insert({
          id: input.id,
          name: input.name,
          full_name: input.fullName,
          years: input.years,
          owner_id: ctx.user!.id,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create series: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // linkTrip — link a trip to a series (series owner only)
  // -----------------------------------------------------------------------
  linkTrip: authedProcedure
    .input(
      z.object({
        seriesId: z.string().min(1),
        tripId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify series ownership
      const { data: series, error: seriesErr } = await ctx.supabase
        .from("series")
        .select("owner_id")
        .eq("id", input.seriesId)
        .single();

      if (seriesErr || !series) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Series not found",
        });
      }

      if (series.owner_id !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the series owner can link trips",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trips")
        .update({ series_id: input.seriesId })
        .eq("id", input.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to link trip: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // transferOwnership — transfer series ownership (series owner only)
  // -----------------------------------------------------------------------
  transferOwnership: authedProcedure
    .input(
      z.object({
        seriesId: z.string().min(1),
        newOwnerId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify series ownership
      const { data: series, error: seriesErr } = await ctx.supabase
        .from("series")
        .select("owner_id")
        .eq("id", input.seriesId)
        .single();

      if (seriesErr || !series) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Series not found",
        });
      }

      if (series.owner_id !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the series owner can transfer ownership",
        });
      }

      const { data, error } = await ctx.supabase
        .from("series")
        .update({ owner_id: input.newOwnerId })
        .eq("id", input.seriesId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to transfer ownership: ${error.message}`,
        });
      }

      return data;
    }),
});
