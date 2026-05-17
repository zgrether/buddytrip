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
});
