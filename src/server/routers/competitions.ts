import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

const SCOREBOARD_STYLES = [
  "grid",
  "leaderboard",
  "heatmap",
  "cards",
  "bars",
  "podium",
  "stadium",
  "minimal",
] as const;

/**
 * competitions — top-level container per trip.
 *
 * MVP rule: one competition per trip, enforced in this router (the schema
 * allows multiple to leave the door open for future series-style usage).
 */
export const competitionsRouter = router({
  // -----------------------------------------------------------------------
  // getByTrip — return the trip's competition (or null)
  // -----------------------------------------------------------------------
  getByTrip: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("competitions")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch competition: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // create — new competition for a trip (canEdit, MVP one-per-trip)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        name: z.string().min(2).max(200),
        tagline: z.string().max(500).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // MVP: only one competition per trip. The DB schema allows N for
      // future-proofing (e.g. seasonal series), but the UI is built for 1.
      const { data: existing } = await ctx.supabase
        .from("competitions")
        .select("id")
        .eq("trip_id", ctx.tripId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A competition already exists for this trip",
        });
      }

      // RLS INSERT RETURNING split — see CLAUDE.md
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from("competitions")
        .insert({
          trip_id: ctx.tripId,
          name: input.name,
          tagline: input.tagline ?? null,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create competition: ${insertErr?.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("competitions")
        .select("*")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created competition: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — edit metadata (canEdit)
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        name: z.string().min(2).max(200).optional(),
        tagline: z.string().max(500).nullable().optional(),
        status: z.enum(["upcoming", "active", "completed"]).optional(),
        scoreboardStyle: z.enum(SCOREBOARD_STYLES).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.tagline !== undefined) patch.tagline = input.tagline;
      if (input.status !== undefined) patch.status = input.status;
      if (input.scoreboardStyle !== undefined) patch.scoreboard_style = input.scoreboardStyle;

      const { data, error } = await ctx.supabase
        .from("competitions")
        .update(patch)
        .eq("id", input.competitionId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update competition: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove a competition (Owner only)
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("competitions")
        .delete()
        .eq("id", input.competitionId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete competition: ${error.message}`,
        });
      }

      return { success: true };
    }),
});
