import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, canEditGame } from "../middleware";
import { canWriteOutcome } from "../lib/outcomeAccess";

/**
 * matchOutcomes — hole-outcome entry (Refactor B2/B3): record who won each hole
 * directly, no gross scores. The write-path counterpart to `scores.ts` for
 * outcome-mode games.
 *
 * SCOPED permissions (B3 — mig 076, SERVER-enforced, RLS-backed, matching
 * `scores.ts`'s exact model):
 *   Owner / Organizer (co-admin) / delegate-of-this-game → any match.
 *   Member → only the match they participate in (`canWriteOutcome` →
 *            `memberCanScoreUnit`, the SAME pure rule scores.ts uses).
 *   Non-participant member → nothing.
 * B2 shipped this elevated-tier only (`requireGameEdit()`), deliberately
 * deferring the member tier: `ctx.supabase` is a user-scoped, RLS-enforcing
 * client (not service-role), so a member-tier app check without the matching
 * RLS widening would pass the check and then fail the actual write — a broken
 * half-permission state. B3 lands both layers together (mig 076's
 * `can_score_match` policy + this file's `canWriteOutcome` call).
 *
 * No `computeMatchPlayResults` call per write — mirrors `scores.upsertEntry`/
 * `deleteEntry` exactly: live state is derived CLIENT-SIDE from the outcome rows
 * (same pattern as score entry deriving live state from `score_entries`); the
 * server's `game_matches.result/margin/status` updates only at `finish` (or a
 * future incremental trigger, of which outcome mode currently has none — no
 * handicaps to edit mid-round).
 */
export const matchOutcomesRouter = router({
  // upsertOutcome — record one hole's decided winner (or halved). Idempotent on
  // the UNIQUE(match_id, hole_number) key (same upsert-on-conflict shape as
  // scores.upsertEntry).
  upsertOutcome: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matchId: z.string().min(1),
        holeNumber: z.number().int().min(1).max(18),
        result: z.enum(["side_a", "side_b", "halved"]),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, status, corrections_open, scoring_enabled")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      // Same posted/enabled gates as scores.upsertEntry — format-agnostic rules.
      if (game.status === "complete" && !game.corrections_open) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This round is posted — open score correction to edit it.",
        });
      }
      if (!game.scoring_enabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Enable scoring before entering outcomes.",
        });
      }

      const { data: match } = await ctx.supabase
        .from("game_matches")
        .select("id")
        .eq("id", input.matchId)
        .eq("game_id", input.gameId)
        .maybeSingle();
      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
      }

      // Outcome-entry permissions (SERVER — the real gate; the UI only reflects
      // it). Owner / co-admin / delegate-of-this-game → any match; a plain
      // member → only the match they participate in.
      if (!(await canWriteOutcome(ctx, ctx.tripId!, input.gameId, input.matchId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only decide outcomes for your own match.",
        });
      }

      const id = `${input.matchId}:${input.holeNumber}`;
      const { error } = await ctx.supabase.from("match_hole_outcomes").upsert(
        {
          id,
          game_id: input.gameId,
          match_id: input.matchId,
          hole_number: input.holeNumber,
          result: input.result,
          submitted_by: ctx.user!.id,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "match_id,hole_number" }
      );
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to save outcome: ${error.message}` });
      }
      return { ok: true };
    }),

  // deleteOutcome — "Reset hole" (clear a recorded outcome back to undecided).
  deleteOutcome: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matchId: z.string().min(1),
        holeNumber: z.number().int().min(1).max(18),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, status, corrections_open")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      if (game.status === "complete" && !game.corrections_open) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This round is posted — open score correction to edit it.",
        });
      }

      // Same scoped gate as upsertOutcome — clearing a cell is a write too, so a
      // member can only clear outcomes in their own match (owner/delegate anywhere).
      if (!(await canWriteOutcome(ctx, ctx.tripId!, input.gameId, input.matchId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only clear outcomes for your own match.",
        });
      }

      const { error } = await ctx.supabase
        .from("match_hole_outcomes")
        .delete()
        .eq("game_id", input.gameId)
        .eq("match_id", input.matchId)
        .eq("hole_number", input.holeNumber);
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to clear outcome: ${error.message}` });
      }
      return { ok: true };
    }),

  // listByGame — all recorded hole outcomes for a game (any trip member — read
  // parity with scores.listByGame; a setup-mode game is hidden from non-editors,
  // same gate).
  listByGame: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, status")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      if ((game.status as string) === "pending" && !(await canEditGame(ctx, ctx.tripId, input.gameId))) {
        return [];
      }
      const { data, error } = await ctx.supabase
        .from("match_hole_outcomes")
        .select("match_id, hole_number, result")
        .eq("game_id", input.gameId);
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to list outcomes: ${error.message}` });
      }
      return data ?? [];
    }),
});
