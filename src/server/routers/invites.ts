import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";

// ── invites router ────────────────────────────────────────────────────────
//
// One procedure. The invite LANDING page is a server component that resolves
// its own facts (`src/server/lib/inviteLink.ts`) and needs no router; the only
// thing a client has to ask the server to DO is claim.
//
// `authedProcedure` and deliberately NOT `requireTripMember`: the whole point
// of a claim is that the caller is not a member yet. Authorization comes from
// the token, checked inside the RPC at the database layer.

export const invitesRouter = router({
  // -----------------------------------------------------------------------
  // claim — attach the placeholder this token was addressed to onto the
  // caller's own account, whatever address that account uses.
  //
  // A thin pass-through on purpose. Every guard lives in
  // `claim_placeholder_by_invite` (migration 141) rather than here, because a
  // tRPC check is not a policy (#720) and this one is reachable by any
  // authenticated caller with a token string. Re-implementing the guards here
  // would create a second set to drift from the first — the exact shape that
  // orphaned 123 rows when `ghostCrew.update` hand-rolled a subset of the
  // merge.
  //
  // The DB's messages are surfaced verbatim. They are written to be read by a
  // person, and the alternative — matching on message text to re-phrase them —
  // is the fragile half of this contract. The SQLSTATE picks the tRPC code; the
  // message carries the sentence.
  // -----------------------------------------------------------------------
  claim: authedProcedure
    .input(z.object({ token: z.string().trim().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase.rpc("claim_placeholder_by_invite", {
        p_token: input.token,
      });

      if (error) {
        // `no_data_found` covers every "this token names nothing claimable"
        // arm — unknown token, already claimed, placeholder not on this trip.
        // They are ONE state to the person holding the link, and telling them
        // apart would disclose which tokens exist.
        if (error.code === "P0002") {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        if (error.code === "42501") {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        // check_violation = a deleted placeholder, or the claimant is already on
        // the trip. unique_violation = both identities hold a score for the same
        // hole. All three are refusals with a sentence, not failures.
        if (error.code === "23514" || error.code === "23505") {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to claim the invite: ${error.message}`,
        });
      }

      const result = (data ?? {}) as { tripId?: string; claimedName?: string | null };
      if (!result.tripId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to claim the invite",
        });
      }

      return { tripId: result.tripId, claimedName: result.claimedName ?? null };
    }),
});
