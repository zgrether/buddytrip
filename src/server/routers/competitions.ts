import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/** Shared with `hydrate`: one-shot fetch of a trip's competition (or null). */
async function fetchCompetition(
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient },
  tripId: string,
) {
  const { data, error } = await ctx.supabase
    .from("competitions")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch competition: ${error.message}`,
    });
  }
  return data as
    | {
        id: string;
        name: string;
        tagline: string | null;
        status: "upcoming" | "active" | "completed";
        motto: string | null;
        trip_id: string;
        created_at: string;
        updated_at: string;
      }
    | null;
}

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
  // hydrate — single bundled fetch for the comp tab.
  //
  // Returns everything CompTab needs in one round trip: the competition
  // row plus teams, assignments, members, events, venues, and confirmed
  // golf schedule items. Each panel still calls its own granular
  // useQuery on the client; CompTab seeds those caches with this
  // result before the panels mount, so they read from cache and skip
  // their own network calls.
  //
  // Calls the inner list helpers (defined in their own router modules)
  // directly so we don't roundtrip through HTTP for each panel. The
  // membership cache added in the perf pass means the shared
  // requireTripMember check is paid once per request batch.
  // -----------------------------------------------------------------------
  hydrate: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const tripId = input.tripId;
      const { listMembers } = await import("./tripMembers");
      const { listGolfSchedule } = await import("./schedule");
      const { listTeams } = await import("./teams");
      const { listTeamAssignments } = await import("./teamAssignments");
      const { listEvents } = await import("./events");
      const { listVenues } = await import("./venues");

      const competition = await fetchCompetition(ctx, tripId);

      if (!competition) {
        const [members, golfItems] = await Promise.all([
          listMembers(ctx, tripId),
          listGolfSchedule(ctx, tripId),
        ]);
        return {
          competition: null,
          teams: [],
          assignments: [],
          members,
          events: [],
          venues: [],
          golfItems,
        };
      }

      const competitionId = competition.id;

      const [teams, assignments, members, events, venues, golfItems] =
        await Promise.all([
          listTeams(ctx, competitionId),
          listTeamAssignments(ctx, competitionId),
          listMembers(ctx, tripId),
          listEvents(ctx, competitionId),
          listVenues(ctx, competitionId),
          listGolfSchedule(ctx, tripId),
        ]);

      return {
        competition,
        teams,
        assignments,
        members,
        events,
        venues,
        golfItems,
      };
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
        motto: z.string().max(500).optional(),
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
          motto: input.motto ?? null,
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
        motto: z.string().max(500).nullable().optional(),
        status: z.enum(["upcoming", "active", "completed"]).optional(),
      })
    )
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.tagline !== undefined) patch.tagline = input.tagline;
      if (input.motto !== undefined) patch.motto = input.motto;
      if (input.status !== undefined) patch.status = input.status;

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
