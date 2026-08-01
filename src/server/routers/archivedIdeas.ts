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
  // archive — copy an idea from a trip into the caller's own archive
  //           (Organizer+ since #786; still mirrors ideas.remove, which moved
  //            with it — archiving is the step before removing)
  //
  // No RLS change was needed: this INSERTs into `archived_ideas` with
  // user_id = the caller, so its policy is self-scoped, not trip-role-scoped.
  // -----------------------------------------------------------------------
  archive: authedProcedure
    .input(z.object({ tripId: z.string(), ideaId: z.string() }))
    .use(requireTripRole("Organizer"))
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
      // #781 — the ONE site of the eleven that asserts a count, decided on the
      // grounds that separate it from the other eight:
      //
      // This row is USER-SCOPED (`.eq("user_id", ctx.user!.id)` — a personal
      // archive, not shared trip data), so there is no concurrent actor who
      // could legitimately have removed it first. The other "delete a thing the
      // user just saw" sites trade catching stale ids against punishing a
      // double-tap by a SECOND person; here there is no second person. Zero rows
      // means a stale or foreign id, and the old code reported success for both.
      //
      // NOT_FOUND rather than INTERNAL_SERVER_ERROR: the id didn't match
      // anything of yours, which is a request problem, not a server one. And
      // never UNAUTHORIZED — `authExpiry` turns a 401 into a forced logout.
      const { error, count } = await ctx.supabase
        .from("archived_ideas")
        .delete({ count: "exact" })
        .eq("id", input.archivedIdeaId)
        .eq("user_id", ctx.user!.id);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove archived idea",
        });
      }

      if (count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That idea isn't in your archive",
        });
      }

      return { success: true };
    }),
});
