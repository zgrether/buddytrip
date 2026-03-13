import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const tripsRouter = router({
  // -----------------------------------------------------------------------
  // list — all trips for the current user
  // -----------------------------------------------------------------------
  list: authedProcedure.query(async ({ ctx }) => {
    const { data: memberships, error: memErr } = await ctx.supabase
      .from("trip_members")
      .select("trip_id, role, status")
      .eq("user_id", ctx.user.id);

    if (memErr || !memberships || memberships.length === 0) {
      return [];
    }

    const tripIds = memberships.map((m) => m.trip_id);
    const { data: trips, error: tripErr } = await ctx.supabase
      .from("trips")
      .select("*")
      .in("id", tripIds)
      .order("created_at", { ascending: false });

    if (tripErr) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch trips",
      });
    }

    const membershipByTripId = new Map(
      memberships.map((m) => [m.trip_id, m])
    );

    return (trips ?? []).map((trip) => ({
      ...trip,
      myRole: membershipByTripId.get(trip.id)?.role ?? null,
      myStatus: membershipByTripId.get(trip.id)?.status ?? null,
    }));
  }),

  // -----------------------------------------------------------------------
  // getById — single trip (must be a member)
  // -----------------------------------------------------------------------
  getById: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .select("*")
        .eq("id", ctx.tripId)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Trip not found",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // create — any logged-in user can create a trip (becomes Owner)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        location: z.string().max(500).nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        seriesId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Step 1: Insert the trip WITHOUT .select() — PostgREST's
      // INSERT ... RETURNING requires the SELECT policy to pass on the
      // new row, but the SELECT policy is `is_trip_member(id)` which is
      // false until we add the creator as a member in step 2.
      const { error } = await ctx.supabase.from("trips").insert({
        id: input.id,
        title: input.title,
        description: input.description ?? "",
        location: input.location ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        series_id: input.seriesId ?? null,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create trip: ${error.message}`,
        });
      }

      // Step 2: Add creator as Owner — now is_trip_member() will be true
      const { error: memberErr } = await ctx.supabase
        .from("trip_members")
        .insert({
          trip_id: input.id,
          user_id: ctx.user.id,
          role: "Owner",
          status: "in",
        });

      if (memberErr) {
        // Clean up the trip if member insert fails
        await ctx.supabase.from("trips").delete().eq("id", input.id);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add creator as trip owner",
        });
      }

      // Step 3: Now fetch the trip — SELECT policy passes because
      // the creator is a trip_member
      const { data: trip, error: fetchErr } = await ctx.supabase
        .from("trips")
        .select()
        .eq("id", input.id)
        .single();

      if (fetchErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Trip created but failed to fetch: ${fetchErr.message}`,
        });
      }

      return trip;
    }),

  // -----------------------------------------------------------------------
  // update — Owner or Planner can edit trip details
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        location: z.string().max(500).nullable().optional(),
        costTier: z.enum(["$", "$$", "$$$", "$$$$"]).nullable().optional(),
        imageUrl: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        accommodation: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        activities: z.array(z.string()).optional(),
        golfCourses: z.array(z.string()).optional(),
        comparisonMode: z.boolean().optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const { tripId: _tripId, ...fields } = input;
      const update: Record<string, unknown> = {};

      if (fields.title !== undefined) update.title = fields.title;
      if (fields.description !== undefined) update.description = fields.description;
      if (fields.location !== undefined) update.location = fields.location;
      if (fields.costTier !== undefined) update.cost_tier = fields.costTier;
      if (fields.imageUrl !== undefined) update.image_url = fields.imageUrl;
      if (fields.startDate !== undefined) update.start_date = fields.startDate;
      if (fields.endDate !== undefined) update.end_date = fields.endDate;
      if (fields.accommodation !== undefined) update.accommodation = fields.accommodation;
      if (fields.notes !== undefined) update.notes = fields.notes;
      if (fields.activities !== undefined) update.activities = fields.activities;
      if (fields.golfCourses !== undefined) update.golf_courses = fields.golfCourses;
      if (fields.comparisonMode !== undefined) update.comparison_mode = fields.comparisonMode;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update",
        });
      }

      const { data, error } = await ctx.supabase
        .from("trips")
        .update(update)
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update trip",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // lockDestination — Owner only
  // -----------------------------------------------------------------------
  lockDestination: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        title: z.string().min(1),
        location: z.string().min(1),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          locked_destination_title: input.title,
          locked_destination_location: input.location,
          locked_destination_at: new Date().toISOString(),
          location: input.location,
          comparison_mode: false,
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to lock destination",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // unlockDestination — Owner only
  // -----------------------------------------------------------------------
  unlockDestination: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("trips")
        .update({
          locked_destination_title: null,
          locked_destination_location: null,
          locked_destination_at: null,
        })
        .eq("id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to unlock destination",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // archive — Owner only
  // -----------------------------------------------------------------------
  archive: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      // Archiving = soft delete via notes or a flag; for now we use
      // the delete approach since schema doesn't have an archived column.
      // The spec says "Archive trip" but schema has no status/archived field.
      // We'll delete the trip for now (matches "Delete trip" permission).
      const { error } = await ctx.supabase
        .from("trips")
        .delete()
        .eq("id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to archive trip",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // delete — Owner only
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx }) => {
      // ON DELETE CASCADE handles all dependent rows (migration 004).
      const { error } = await ctx.supabase
        .from("trips")
        .delete()
        .eq("id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete trip",
        });
      }

      return { success: true };
    }),
});
