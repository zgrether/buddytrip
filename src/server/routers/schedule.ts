import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const scheduleRouter = router({
  // -----------------------------------------------------------------------
  // list — any member can view schedule items
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("schedule_items")
        .select("*, course:golf_courses(id, place_id, name, address, lat, lng), competition_events:events!events_agenda_item_id_fkey(id, title, type, scoring_format)")
        .eq("trip_id", ctx.tripId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch schedule items",
        });
      }

      return data ?? [];
    }),

  // -----------------------------------------------------------------------
  // create — Organizer+ can add schedule items
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        itemType: z.enum(["general", "golf"]).default("general"),
        title: z.string().min(1).max(200),
        detail: z.string().max(1000).optional(),
        scheduledDate: z.string().optional(),
        scheduledTime: z.string().optional(),
        isConfirmed: z.boolean().default(false),
        sortOrder: z.number().int().default(0),
        // Golf fields
        courseId: z.string().optional(),
        courseName: z.string().max(200).optional(),
        courseLocation: z.string().max(500).optional(),
        teeTimes: z.array(z.string()).optional(),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("schedule_items")
        .insert({
          trip_id: ctx.tripId,
          item_type: input.itemType,
          title: input.title,
          detail: input.detail ?? null,
          scheduled_date: input.scheduledDate ?? null,
          scheduled_time: input.scheduledTime ?? null,
          is_confirmed: input.isConfirmed,
          confirmed_at: input.isConfirmed ? new Date().toISOString() : null,
          confirmed_by: input.isConfirmed ? ctx.user!.id : null,
          sort_order: input.sortOrder,
          created_by: ctx.user!.id,
          course_id: input.courseId ?? null,
          course_name: input.courseName ?? null,
          course_location: input.courseLocation ?? null,
          tee_times: input.teeTimes ?? null,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create schedule item: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — Organizer+ can edit schedule items
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        itemId: z.string(),
        title: z.string().min(1).max(200).optional(),
        detail: z.string().max(1000).nullable().optional(),
        scheduledDate: z.string().nullable().optional(),
        scheduledTime: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
        isConfirmed: z.boolean().optional(),
        courseId: z.string().nullable().optional(),
        courseName: z.string().max(200).nullable().optional(),
        courseLocation: z.string().max(500).nullable().optional(),
        teeTimes: z.array(z.string()).nullable().optional(),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {};
      if (input.title !== undefined) update.title = input.title;
      if (input.detail !== undefined) update.detail = input.detail;
      if (input.scheduledDate !== undefined) {
        update.scheduled_date = input.scheduledDate;
      }
      if (input.scheduledTime !== undefined) update.scheduled_time = input.scheduledTime;
      if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
      // isConfirmed is always set by the caller — the router never infers it
      // from the date change. Golf items keep their confirmed status when moved
      // to On Deck; non-golf callers explicitly pass isConfirmed: false.
      if (input.isConfirmed !== undefined) {
        update.is_confirmed = input.isConfirmed;
        if (input.isConfirmed) {
          update.confirmed_at = new Date().toISOString();
          update.confirmed_by = ctx.user!.id;
        } else {
          update.confirmed_at = null;
          update.confirmed_by = null;
        }
      }
      if (input.courseId !== undefined) update.course_id = input.courseId;
      if (input.courseName !== undefined) update.course_name = input.courseName;
      if (input.courseLocation !== undefined) update.course_location = input.courseLocation;
      if (input.teeTimes !== undefined) update.tee_times = input.teeTimes;

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("schedule_items")
        .update(update)
        .eq("id", input.itemId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update schedule item",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // reorder — Organizer+ can reorder schedule items
  // -----------------------------------------------------------------------
  reorder: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        itemIds: z.array(z.string()).min(1),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // Update sort_order from array position. Fire all updates in parallel —
      // a drag of N items was N sequential round-trips; Promise.all collapses
      // the wall-clock cost to a single round-trip's worth.
      const results = await Promise.all(
        input.itemIds.map((id, i) =>
          ctx.supabase
            .from("schedule_items")
            .update({ sort_order: i })
            .eq("id", id)
            .eq("trip_id", ctx.tripId)
        )
      );

      const failed = results.findIndex((r) => r.error);
      if (failed !== -1) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reorder item ${input.itemIds[failed]}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // remove — Organizer+ can delete schedule items
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), itemId: z.string() }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("schedule_items")
        .delete()
        .eq("id", input.itemId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove schedule item",
        });
      }

      return { success: true };
    }),
});
