import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

const sourceEnum = z.enum(["vrbo", "airbnb", "hotel", "other"]);

export const ideaLodgingRouter = router({
  // -----------------------------------------------------------------------
  // list — look up tripId from ideas table, then verify membership
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ ideaId: z.string() }))
    .query(async ({ ctx, input }) => {
      // 1. Resolve tripId from the idea
      const { data: idea, error: ideaError } = await ctx.supabase
        .from("ideas")
        .select("trip_id")
        .eq("id", input.ideaId)
        .single();

      if (ideaError || !idea) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Idea not found" });
      }

      const tripId = idea.trip_id;

      // 2. Verify caller is a trip member
      const { data: member, error: memberError } = await ctx.supabase
        .from("trip_members")
        .select("role")
        .eq("trip_id", tripId)
        .eq("user_id", ctx.user!.id)
        .single();

      if (memberError || !member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this trip",
        });
      }

      // 3. Fetch lodging options
      const { data, error } = await ctx.supabase
        .from("idea_lodging_options")
        .select("*")
        .eq("idea_id", input.ideaId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch lodging options",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — any trip member can add lodging options (RLS INSERT RETURNING split)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        ideaId: z.string(),
        tripId: z.string(),
        name: z.string().min(1).max(200),
        source: sourceEnum.optional(),
        sleeps: z.number().int().positive().optional(),
        priceNote: z.string().max(200).optional(),
        url: z.string().max(2000).optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // INSERT without RETURNING — avoids RLS race condition
      const { error: insertError } = await ctx.supabase
        .from("idea_lodging_options")
        .insert({
          idea_id: input.ideaId,
          trip_id: ctx.tripId,
          name: input.name,
          source: input.source ?? null,
          sleeps: input.sleeps ?? null,
          price_note: input.priceNote ?? null,
          url: input.url ?? null,
          notes: input.notes ?? null,
          created_by: ctx.user!.id,
        });

      if (insertError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create lodging option: ${insertError.message}`,
        });
      }

      // Separate SELECT to get the created row
      const { data, error: selectError } = await ctx.supabase
        .from("idea_lodging_options")
        .select("*")
        .eq("idea_id", input.ideaId)
        .eq("trip_id", ctx.tripId)
        .eq("name", input.name)
        .eq("created_by", ctx.user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (selectError || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve created lodging option",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — any trip member can edit lodging options
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        tripId: z.string(),
        name: z.string().min(1).max(200).optional(),
        source: sourceEnum.nullable().optional(),
        sleeps: z.number().int().positive().nullable().optional(),
        priceNote: z.string().max(200).nullable().optional(),
        url: z.string().max(2000).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.source !== undefined) update.source = input.source;
      if (input.sleeps !== undefined) update.sleeps = input.sleeps;
      if (input.priceNote !== undefined) update.price_note = input.priceNote;
      if (input.url !== undefined) update.url = input.url;
      if (input.notes !== undefined) update.notes = input.notes;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("idea_lodging_options")
        .update(update)
        .eq("id", input.id)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update lodging option",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — any trip member can delete lodging options
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ id: z.string(), tripId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("idea_lodging_options")
        .delete()
        .eq("id", input.id)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove lodging option",
        });
      }

      return { success: true };
    }),
});
