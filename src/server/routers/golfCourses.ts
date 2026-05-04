import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";

export const golfCoursesRouter = router({
  // -----------------------------------------------------------------------
  // findOrCreate — look up by place_id, create if not exists
  // Returns the golf_courses row (existing or new).
  //
  // NOTE: kept as-is for the schedule flow — it stores Google Places-sourced
  // courses. The competition flow calls this same procedure so a course
  // shows up in both places.
  // -----------------------------------------------------------------------
  findOrCreate: authedProcedure
    .input(
      z.object({
        placeId: z.string().min(1),
        name: z.string().min(1),
        address: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from("golf_courses")
        .select("*")
        .eq("place_id", input.placeId)
        .maybeSingle();

      if (existing) return existing;

      const { data, error } = await ctx.supabase
        .from("golf_courses")
        .insert({
          place_id: input.placeId,
          name: input.name,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        })
        .select()
        .single();

      if (error) {
        // Race condition — another request created it between our check + insert.
        if (error.code === "23505") {
          const { data: raced } = await ctx.supabase
            .from("golf_courses")
            .select("*")
            .eq("place_id", input.placeId)
            .single();
          if (raced) return raced;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create golf course: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // getById — fetch a single golf course by id (registry row only)
  // -----------------------------------------------------------------------
  getById: authedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("golf_courses")
        .select("*")
        .eq("id", input.courseId)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Golf course not found",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // saveDetails — upsert scorecard data (holes + tee boxes) for a course
  //
  // Stored in `golf_course_details` (1:1 with golf_courses) so the schedule
  // flow that just needs name/address keeps using `golf_courses` directly.
  // -----------------------------------------------------------------------
  saveDetails: authedProcedure
    .input(
      z.object({
        golfCourseId: z.string(),
        externalId: z.string().optional(),
        clubName: z.string().optional(),
        holes: z.array(z.unknown()),
        teeBoxes: z.array(z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("golf_course_details")
        .upsert(
          {
            golf_course_id: input.golfCourseId,
            external_id: input.externalId ?? null,
            club_name: input.clubName ?? null,
            holes: input.holes,
            tee_boxes: input.teeBoxes,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "golf_course_id" }
        )
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save course details: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // getDetails — fetch scorecard data, or null if not stored yet
  // -----------------------------------------------------------------------
  getDetails: authedProcedure
    .input(z.object({ golfCourseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("golf_course_details")
        .select("*")
        .eq("golf_course_id", input.golfCourseId)
        .maybeSingle();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch course details: ${error.message}`,
        });
      }

      return data;
    }),
});
