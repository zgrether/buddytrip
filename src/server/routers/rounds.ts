import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const roundsRouter = router({
  // -----------------------------------------------------------------------
  // list — all rounds for an event (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("rounds")
        .select("*")
        .eq("event_id", input.eventId)
        .order("day", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch rounds",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — add a round (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        eventId: z.string(),
        day: z.number().int().min(1),
        title: z.string().min(1).max(200),
        course: z.string().min(1).max(200),
        format: z.enum(["scramble", "stableford", "sabotage", "skins", "match_play", "singles"]),
        pointsAvailable: z.number().min(0),
        modifiers: z.any().nullable().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("rounds")
        .insert({
          id: input.id,
          event_id: input.eventId,
          day: input.day,
          title: input.title,
          course: input.course,
          format: input.format,
          points_available: input.pointsAvailable,
          modifiers: input.modifiers ?? null,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create round: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — edit a round (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        roundId: z.string(),
        title: z.string().min(1).max(200).optional(),
        course: z.string().min(1).max(200).optional(),
        format: z.enum(["scramble", "stableford", "sabotage", "skins", "match_play", "singles"]).optional(),
        status: z.enum(["upcoming", "active", "submitted", "closed"]).optional(),
        pointsAvailable: z.number().min(0).optional(),
        modifiers: z.any().nullable().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { roundId, tripId: _tripId, ...fields } = input;
      const update: Record<string, unknown> = {};

      if (fields.title !== undefined) update.title = fields.title;
      if (fields.course !== undefined) update.course = fields.course;
      if (fields.format !== undefined) update.format = fields.format;
      if (fields.status !== undefined) update.status = fields.status;
      if (fields.pointsAvailable !== undefined) update.points_available = fields.pointsAvailable;
      if (fields.modifiers !== undefined) update.modifiers = fields.modifiers;

      // Handle close action
      if (fields.status === "closed") {
        update.closed_at = new Date().toISOString();
        update.closed_by = ctx.user!.id;
      }

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("rounds")
        .update(update)
        .eq("id", roundId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update round",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // activate — atomically move active round → submitted, target → active
  //
  // Uses the activate_round RPC so the two updates are atomic.
  // -----------------------------------------------------------------------
  activate: authedProcedure
    .input(z.object({ tripId: z.string(), roundId: z.string(), eventId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("activate_round", {
        p_round_id: input.roundId,
        p_event_id: input.eventId,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to activate round: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // remove — delete a round (canEdit)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), roundId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Delete group results first
      await ctx.supabase
        .from("group_results")
        .delete()
        .eq("round_id", input.roundId);

      const { error } = await ctx.supabase
        .from("rounds")
        .delete()
        .eq("id", input.roundId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove round",
        });
      }

      return { success: true };
    }),
});
