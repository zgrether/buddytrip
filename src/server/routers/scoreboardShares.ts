import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

/**
 * scoreboardShares — STUBBED in Phase A.
 *
 * Migration 062 renamed `scoreboard_shares.event_id` → `competition_id`
 * and dropped the legacy `events` shape that this router aggregated. The
 * new scoreboard surface is owned by Phase B; meanwhile the public
 * scoreboard page renders a placeholder.
 *
 * `create` accepts competitionId and writes the row so a share can still
 * be minted from the UI in the future without rewriting this file.
 * `getScoreboard` returns a minimal shape — name + tagline — pulled from
 * `competitions`. The placeholder page consumes that to title the screen.
 */
export const scoreboardSharesRouter = router({
  // -------------------------------------------------------------------
  // create — mint a share link (idempotent per competition)
  // -------------------------------------------------------------------
  create: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from("scoreboard_shares")
        .select("id")
        .eq("competition_id", input.competitionId)
        .maybeSingle();

      if (existing) {
        return { shareCode: existing.id as string };
      }

      const shareCode = `sb-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const { error } = await ctx.supabase.from("scoreboard_shares").insert({
        id: shareCode,
        trip_id: input.tripId,
        competition_id: input.competitionId,
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

  // -------------------------------------------------------------------
  // getScoreboard — placeholder. Returns competition metadata only;
  // Phase B fills in teams/events/scores once the new scoring model
  // is in place.
  // -------------------------------------------------------------------
  getScoreboard: publicProcedure
    .input(z.object({ shareCode: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: share, error: shareErr } = await ctx.supabase
        .from("scoreboard_shares")
        .select("trip_id, competition_id")
        .eq("id", input.shareCode)
        .single();

      if (shareErr || !share) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scoreboard not found" });
      }

      const { data: competition } = await ctx.supabase
        .from("competitions")
        .select("id, name, tagline, motto, status")
        .eq("id", share.competition_id)
        .maybeSingle();

      return {
        tripId: share.trip_id as string,
        competition: competition ?? null,
        // Phase B will populate the rest. Empty arrays keep client TS happy.
        teams: [] as Array<Record<string, unknown>>,
        events: [] as Array<Record<string, unknown>>,
        roundScores: [] as Array<Record<string, unknown>>,
      };
    }),
});
