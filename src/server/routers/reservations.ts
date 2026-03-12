import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const reservationsRouter = router({
  // -----------------------------------------------------------------------
  // list — any member can view bookings
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("reservations")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("date", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch reservations",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — Owner or Planner (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        type: z.enum(["accommodation", "tee-time", "restaurant", "transport"]),
        title: z.string().min(1).max(200),
        date: z.string(),
        startTime: z.string().optional(),
        confirmationNumber: z.string().optional(),
        cost: z.number().min(0).optional(),
        notes: z.string().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("reservations")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          type: input.type,
          title: input.title,
          date: input.date,
          start_time: input.startTime ?? "",
          confirmation_number: input.confirmationNumber ?? "",
          cost: input.cost ?? 0,
          notes: input.notes ?? "",
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create reservation: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — Owner or Planner (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        reservationId: z.string(),
        type: z.enum(["accommodation", "tee-time", "restaurant", "transport"]).optional(),
        title: z.string().min(1).max(200).optional(),
        date: z.string().optional(),
        startTime: z.string().optional(),
        confirmationNumber: z.string().optional(),
        cost: z.number().min(0).optional(),
        notes: z.string().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { reservationId, tripId: _, ...fields } = input;
      const update: Record<string, unknown> = {};

      if (fields.type !== undefined) update.type = fields.type;
      if (fields.title !== undefined) update.title = fields.title;
      if (fields.date !== undefined) update.date = fields.date;
      if (fields.startTime !== undefined) update.start_time = fields.startTime;
      if (fields.confirmationNumber !== undefined) update.confirmation_number = fields.confirmationNumber;
      if (fields.cost !== undefined) update.cost = fields.cost;
      if (fields.notes !== undefined) update.notes = fields.notes;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("reservations")
        .update(update)
        .eq("id", reservationId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update reservation",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — Owner or Planner (canEdit)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), reservationId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("reservations")
        .delete()
        .eq("id", input.reservationId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove reservation",
        });
      }

      return { success: true };
    }),
});
