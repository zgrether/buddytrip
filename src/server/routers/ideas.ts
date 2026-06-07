import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

export const ideasRouter = router({
  // -----------------------------------------------------------------------
  // list — all ideas for a trip (any member)
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data: ideas, error } = await ctx.supabase
        .from("ideas")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch ideas",
        });
      }

      // Fetch votes for all ideas in this trip.
      // (Previously also fetched idea_comments for a commentCount badge —
      //  removed in pre-launch cleanup; the comments router + table were
      //  dead, the badge was unused in the UI.)
      const { data: votes } = await ctx.supabase
        .from("idea_votes")
        .select("idea_id, user_id, created_at")
        .eq("trip_id", ctx.tripId);

      const votesByIdea = new Map<string, typeof votes>();
      for (const v of votes ?? []) {
        const arr = votesByIdea.get(v.idea_id) ?? [];
        arr.push(v);
        votesByIdea.set(v.idea_id, arr);
      }

      return (ideas ?? []).map((idea) => ({
        ...idea,
        votes: votesByIdea.get(idea.id) ?? [],
      }));
    }),

  // -----------------------------------------------------------------------
  // create — Owner only
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        location: z.string().min(1).max(500),
        description: z.string().max(2000).optional(),
        golfCourses: z.array(z.string()).optional(),
        activities: z.array(z.string()).optional(),
        costTier: z.string().nullable().optional(),
        pros: z.array(z.string()).optional(),
        cons: z.array(z.string()).optional(),
        imageUrl: z.string().nullable().optional(),
        accommodation: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        proposedDates: z
          .array(z.object({ start: z.string(), end: z.string() }))
          .optional(),
        source: z.enum(["manual", "ai", "catalog"]).optional(),
        sourceIdeaId: z.string().nullable().optional(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("ideas")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          title: input.title,
          location: input.location,
          description: input.description ?? "",
          golf_courses: input.golfCourses ?? [],
          activities: input.activities ?? [],
          cost_tier: input.costTier ?? null,
          pros: input.pros ?? [],
          cons: input.cons ?? [],
          image_url: input.imageUrl ?? null,
          accommodation: input.accommodation ?? null,
          notes: input.notes ?? null,
          proposed_dates: JSON.stringify(input.proposedDates ?? []),
          source: input.source ?? "manual",
          source_idea_id: input.sourceIdeaId ?? null,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create idea: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — Owner or Organizer (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        ideaId: z.string(),
        title: z.string().min(1).max(200).optional(),
        location: z.string().min(1).max(500).optional(),
        description: z.string().max(2000).optional(),
        golfCourses: z.array(z.string()).optional(),
        activities: z.array(z.string()).optional(),
        costTier: z.string().nullable().optional(),
        pros: z.array(z.string()).optional(),
        cons: z.array(z.string()).optional(),
        imageUrl: z.string().nullable().optional(),
        accommodation: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        proposedDates: z
          .array(z.object({ start: z.string(), end: z.string() }))
          .optional(),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { ideaId, tripId: _tripId, ...fields } = input;
      const update: Record<string, unknown> = {};

      if (fields.title !== undefined) update.title = fields.title;
      if (fields.location !== undefined) update.location = fields.location;
      if (fields.description !== undefined) update.description = fields.description;
      if (fields.golfCourses !== undefined) update.golf_courses = fields.golfCourses;
      if (fields.activities !== undefined) update.activities = fields.activities;
      if (fields.costTier !== undefined) update.cost_tier = fields.costTier;
      if (fields.pros !== undefined) update.pros = fields.pros;
      if (fields.cons !== undefined) update.cons = fields.cons;
      if (fields.imageUrl !== undefined) update.image_url = fields.imageUrl;
      if (fields.accommodation !== undefined) update.accommodation = fields.accommodation;
      if (fields.notes !== undefined) update.notes = fields.notes;
      if (fields.proposedDates !== undefined)
        update.proposed_dates = JSON.stringify(fields.proposedDates);

      if (Object.keys(update).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const { data, error } = await ctx.supabase
        .from("ideas")
        .update(update)
        .eq("id", ideaId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update idea",
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // remove — Owner only
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), ideaId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Delete votes first
      await ctx.supabase
        .from("idea_votes")
        .delete()
        .eq("idea_id", input.ideaId);

      const { error } = await ctx.supabase
        .from("ideas")
        .delete()
        .eq("id", input.ideaId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove idea",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // vote — any member can vote; single pick per trip, toggle off to unvote
  // -----------------------------------------------------------------------
  vote: authedProcedure
    .input(z.object({ tripId: z.string(), ideaId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // Check if this idea is already the user's pick
      const { data: existing } = await ctx.supabase
        .from("idea_votes")
        .select("idea_id")
        .eq("idea_id", input.ideaId)
        .eq("user_id", ctx.user!.id)
        .maybeSingle();

      if (existing) {
        // Clicking current pick — unvote completely
        await ctx.supabase
          .from("idea_votes")
          .delete()
          .eq("idea_id", input.ideaId)
          .eq("user_id", ctx.user!.id);
        return { voted: false };
      } else {
        // Remove any existing vote on another idea first (single-pick rule)
        await ctx.supabase
          .from("idea_votes")
          .delete()
          .eq("trip_id", ctx.tripId)
          .eq("user_id", ctx.user!.id);

        // Cast new vote
        const { error } = await ctx.supabase.from("idea_votes").insert({
          trip_id: ctx.tripId,
          idea_id: input.ideaId,
          user_id: ctx.user!.id,
        });
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to vote",
          });
        }

        return { voted: true };
      }
    }),

  // -----------------------------------------------------------------------
  // catalogList — browse curated destination ideas (any authenticated user)
  // -----------------------------------------------------------------------
  catalogList: authedProcedure
    .input(
      z.object({
        categories: z.array(z.string()).optional(),
        costTier: z.string().optional(),
        tripLength: z.string().optional(),
        region: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("catalog_ideas")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.categories?.length) {
        query = query.overlaps("categories", input.categories);
      }
      if (input.costTier) {
        query = query.eq("cost_tier", input.costTier);
      }
      if (input.tripLength) {
        query = query.eq("trip_length", input.tripLength);
      }
      if (input.region) {
        query = query.eq("region", input.region);
      }
      if (input.search?.trim()) {
        query = query.textSearch("search_vector", input.search.trim());
      }

      const { data, error } = await query;
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return data ?? [];
    }),

});
