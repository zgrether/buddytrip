import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripRole } from "../middleware";

/**
 * archivedIdeas — per-user snapshots of destination ideas the owner has
 * removed from a trip but wants to reuse on future trips.
 *
 * Ownership model: each archived idea belongs to a single user (the trip
 * owner who archived it). RLS enforces user_id = auth.uid(); no trip
 * membership is involved once the archive is created. The archive-time
 * snapshot is independent of the source idea — the source trip or idea
 * can be deleted without affecting the archive.
 */
export const archivedIdeasRouter = router({
  // -----------------------------------------------------------------------
  // list — current user's archived ideas (newest first)
  // -----------------------------------------------------------------------
  list: authedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("archived_ideas")
      .select("*")
      .eq("user_id", ctx.user!.id)
      .order("archived_at", { ascending: false });

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch archived ideas",
      });
    }

    return data ?? [];
  }),

  // -----------------------------------------------------------------------
  // archive — copy an idea from a trip into the owner's archive
  //           (Owner-only; mirrors ideas.remove in that removing an idea
  //            is an owner action)
  // -----------------------------------------------------------------------
  archive: authedProcedure
    .input(z.object({ tripId: z.string(), ideaId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Snapshot the source idea. If the idea doesn't exist (already
      // deleted) we refuse — the caller is expected to archive before
      // removing from the trip.
      const { data: idea, error: fetchErr } = await ctx.supabase
        .from("ideas")
        .select("*")
        .eq("id", input.ideaId)
        .eq("trip_id", ctx.tripId)
        .single();

      if (fetchErr || !idea) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Idea not found",
        });
      }

      const { data: trip } = await ctx.supabase
        .from("trips")
        .select("title")
        .eq("id", ctx.tripId)
        .single();

      const { data, error } = await ctx.supabase
        .from("archived_ideas")
        .insert({
          user_id: ctx.user!.id,
          title: idea.title,
          location: idea.location,
          description: idea.description ?? "",
          cost_tier: idea.cost_tier ?? null,
          image_url: idea.image_url ?? null,
          golf_courses: idea.golf_courses ?? [],
          activities: idea.activities ?? [],
          accommodation: idea.accommodation ?? null,
          notes: idea.notes ?? null,
          pros: idea.pros ?? [],
          cons: idea.cons ?? [],
          source_idea_id: idea.id,
          original_trip_id: ctx.tripId,
          original_trip_title: trip?.title ?? null,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to archive idea: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — permanently delete an archived idea (owner of the archive)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ archivedIdeaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("archived_ideas")
        .delete()
        .eq("id", input.archivedIdeaId)
        .eq("user_id", ctx.user!.id);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove archived idea",
        });
      }

      return { success: true };
    }),
});
