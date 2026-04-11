import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";

export const golfCoursesRouter = router({
  // -----------------------------------------------------------------------
  // findOrCreate — look up by place_id, create if not exists
  // Returns the golf_courses row (existing or new)
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
      // Check if course already exists by place_id
      const { data: existing } = await ctx.supabase
        .from("golf_courses")
        .select("*")
        .eq("place_id", input.placeId)
        .maybeSingle();

      if (existing) return existing;

      // Create new course
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
        // Race condition: another user created it between our check and insert
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
  // getById — fetch a single golf course by id
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
});
