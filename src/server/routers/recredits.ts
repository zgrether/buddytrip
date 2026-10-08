import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireCompetitionRole } from "../middleware";
import { maybeRowOrThrow } from "../lib/rowOrThrow";
import { applyRecredit, previewRecredit, recreditCandidates } from "../lib/recredit";

/**
 * RE-CREDIT (PR 8c): the trip Owner moves one person's credit in chosen
 * finished games to the team they are on now. See `src/server/lib/recredit.ts`
 * for the model and migration 204 for the write.
 *
 * Owner-only at every door (ruling 18): here, and again inside both database
 * functions, so a direct PostgREST call is refused the same way.
 */

/** `requireCompetitionRole` reads the role from `tripId`; this confirms the
 *  competition is THAT trip's, so an Owner of one trip cannot name another's. */
async function assertCupOfTrip(supabase: SupabaseClient, tripId: string, competitionId: string) {
  const cup = maybeRowOrThrow(
    await supabase.from("competitions").select("trip_id").eq("id", competitionId).maybeSingle(),
    "competition"
  );
  if (!cup || (cup.trip_id as string) !== tripId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
  }
}

const cupInput = z.object({ tripId: z.string(), competitionId: z.string() });

export const recreditsRouter = router({
  // candidates — who has a game the Owner could re-credit (the Edit Team entry).
  candidates: authedProcedure
    .input(cupInput)
    .use(requireCompetitionRole("owner"))
    .query(async ({ ctx, input }) => {
      await assertCupOfTrip(ctx.supabase, input.tripId, input.competitionId);
      return { userIds: await recreditCandidates(ctx.supabase, input.competitionId) };
    }),

  // preview — this person's finished games: the ones that can move, with the
  // board's before and after, and the ones that stand as played.
  preview: authedProcedure
    .input(cupInput.extend({ userId: z.string() }))
    .use(requireCompetitionRole("owner"))
    .query(async ({ ctx, input }) => {
      await assertCupOfTrip(ctx.supabase, input.tripId, input.competitionId);
      return previewRecredit(ctx.supabase, input);
    }),

  // confirm — the chosen games, each with the fingerprint its preview was built on.
  confirm: authedProcedure
    .input(
      cupInput.extend({
        userId: z.string(),
        expectedTeamId: z.string().nullable(),
        games: z.array(z.object({ gameId: z.string(), fingerprint: z.string().min(1) })).min(1),
      })
    )
    .use(requireCompetitionRole("owner"))
    .mutation(async ({ ctx, input }) => {
      await assertCupOfTrip(ctx.supabase, input.tripId, input.competitionId);
      return applyRecredit(ctx.supabase, input);
    }),
});
