import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

export const scoreboardSharesRouter = router({
  // -----------------------------------------------------------------------
  // create — generate a share link for an event's scoreboard (trip member)
  // Idempotent: returns existing share if one already exists for this event.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(z.object({ tripId: z.string(), eventId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // Check if share already exists
      const { data: existing } = await ctx.supabase
        .from("scoreboard_shares")
        .select("id")
        .eq("event_id", input.eventId)
        .single();

      if (existing) {
        return { shareCode: existing.id };
      }

      // Create new share
      const shareCode = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await ctx.supabase
        .from("scoreboard_shares")
        .insert({
          id: shareCode,
          trip_id: input.tripId,
          event_id: input.eventId,
          created_by: ctx.user!.id,
        });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create share link: ${error.message}`,
        });
      }

      return { shareCode };
    }),

  // -----------------------------------------------------------------------
  // getScoreboard — public: fetch scoreboard data by share code (no auth)
  // -----------------------------------------------------------------------
  getScoreboard: publicProcedure
    .input(z.object({ shareCode: z.string() }))
    .query(async ({ ctx, input }) => {
      // 1. Look up the share
      const { data: share, error: shareErr } = await ctx.supabase
        .from("scoreboard_shares")
        .select("trip_id, event_id")
        .eq("id", input.shareCode)
        .single();

      if (shareErr || !share) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scoreboard not found",
        });
      }

      const { trip_id: tripId, event_id: eventId } = share;

      // 2. Fetch event
      const { data: event } = await ctx.supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // 3. Fetch teams, rounds, side events, scores in parallel
      const [teamsRes, roundsRes, sideEventsRes, roundResultsRes] =
        await Promise.all([
          ctx.supabase.from("teams").select("*").eq("event_id", eventId),
          ctx.supabase
            .from("rounds")
            .select("*")
            .eq("event_id", eventId)
            .order("day", { ascending: true }),
          ctx.supabase
            .from("side_events")
            .select("*")
            .eq("event_id", eventId),
          // Get round IDs first, then scores
          ctx.supabase
            .from("rounds")
            .select("id")
            .eq("event_id", eventId)
            .then(async (r) => {
              const roundIds = (r.data ?? []).map((row) => row.id);
              if (roundIds.length === 0)
                return { data: [], error: null };
              return ctx.supabase
                .from("round_results")
                .select("round_id, team_id, total_points")
                .in("round_id", roundIds);
            }),
        ]);

      return {
        tripId,
        event,
        teams: teamsRes.data ?? [],
        rounds: roundsRes.data ?? [],
        sideEvents: sideEventsRes.data ?? [],
        roundScores: roundResultsRes.data ?? [],
      };
    }),
});
