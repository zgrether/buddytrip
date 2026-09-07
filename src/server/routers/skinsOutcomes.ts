import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, canEditGame } from "../middleware";
import { rowOrThrow } from "../lib/rowOrThrow";
import { canWriteSkinsHole } from "../lib/skinsAccess";

/**
 * skinsOutcomes — record who won each hole of a skins game.
 *
 * The write-path counterpart to `scores.ts` and `matchOutcomes.ts` for this
 * format. No gross scores and no handicaps: players pick up once they are out,
 * so there is frequently nothing to enter, and the group applies strokes in
 * their heads before saying who won.
 *
 * SCOPED permissions, SERVER-enforced and RLS-backed, matching the model
 * `scores.ts` and `matchOutcomes.ts` use:
 *   Owner / Organizer (co-admin) / delegate-of-this-game → any grouping.
 *   Member → only the grouping they are in (`canWriteSkinsHole` →
 *            `can_score_skins_grouping` in RLS, migration 184).
 *   Non-participant member → nothing.
 *
 * No recompute per write — the same contract `scores.upsertEntry` and
 * `matchOutcomes.upsertOutcome` keep. Live state is derived CLIENT-side from
 * these rows through the shared pure `tallyGrouping`; `game_results` is written
 * only at `finish`. Nothing about a skins hole is snapshotted, so a late or
 * out-of-order entry simply re-folds.
 */
export const skinsOutcomesRouter = router({
  /**
   * upsertHole — record one hole's winner, or that it was tied.
   *
   * `winnerId` and `result` are a PAIR, checked here as well as by the table's
   * CHECK: a `won` hole with no winner and a `tied` hole with one are both
   * meaningless, and the difference between "tied" and "not entered" is what the
   * carryover fold branches on. Refusing at the edge means the client gets a
   * sentence rather than a constraint-violation string.
   */
  upsertHole: authedProcedure
    .input(
      z
        .object({
          tripId: z.string(),
          gameId: z.string(),
          groupingId: z.string().min(1),
          holeNumber: z.number().int().min(1).max(18),
          result: z.enum(["won", "tied"]),
          /** The player who took the hole. Required for `won`, forbidden for `tied`. */
          winnerId: z.string().min(1).nullable().default(null),
        })
        .refine((v) => (v.result === "won") === (v.winnerId != null), {
          message: "A won hole names its winner; a tied hole names nobody.",
          path: ["winnerId"],
        })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const game = rowOrThrow(
        await ctx.supabase
          .from("games")
          .select("id, status, corrections_open, scoring_enabled")
          .eq("id", input.gameId)
          .eq("trip_id", ctx.tripId)
          .maybeSingle(),
        { code: "NOT_FOUND", message: "Game not found" },
        "game"
      );
      // The same posted/enabled gates every score write is held to — format
      // agnostic rules, so they read identically to `scores.upsertEntry`.
      if (game.status === "complete" && !game.corrections_open) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This round is posted — tap “Correct a score” on the scoreboard to reopen it for edits.",
        });
      }
      if (!game.scoring_enabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Enable scoring before recording holes.",
        });
      }

      if (!(await canWriteSkinsHole(ctx, ctx.tripId!, input.gameId, input.groupingId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only record holes for your own group.",
        });
      }

      // The winner must be IN the grouping. Without this a caller could hand a
      // pot to somebody playing a different contest entirely — the groupings are
      // independent, so a winner from another one is not a lesser mistake than a
      // winner from another game.
      if (input.winnerId) {
        const { data: winner } = await ctx.supabase
          .from("game_participants")
          .select("user_id")
          .eq("game_id", input.gameId)
          .eq("user_id", input.winnerId)
          .eq("play_group_id", input.groupingId)
          .maybeSingle();
        if (!winner) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That player isn’t in this group.",
          });
        }
      }

      // Deterministic id on the same key as the UNIQUE constraint, so a re-entry
      // is an upsert rather than a duplicate — the shape `matchOutcomes` uses.
      const id = `${input.groupingId}:${input.holeNumber}`;
      const { error } = await ctx.supabase.from("skins_hole_outcomes").upsert(
        {
          id,
          game_id: input.gameId,
          grouping_id: input.groupingId,
          hole_number: input.holeNumber,
          result: input.result,
          winner_user_id: input.winnerId,
          submitted_by: ctx.user!.id,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "grouping_id,hole_number" }
      );
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to save the hole: ${error.message}` });
      }
      return { ok: true };
    }),

  /** clearHole — put a recorded hole back to "not entered", which is a
   *  different state from "tied" and re-folds every pot in front of it. */
  clearHole: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        groupingId: z.string().min(1),
        holeNumber: z.number().int().min(1).max(18),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const game = rowOrThrow(
        await ctx.supabase
          .from("games")
          .select("id, status, corrections_open")
          .eq("id", input.gameId)
          .eq("trip_id", ctx.tripId)
          .maybeSingle(),
        { code: "NOT_FOUND", message: "Game not found" },
        "game"
      );
      if (game.status === "complete" && !game.corrections_open) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This round is posted — tap “Correct a score” on the scoreboard to reopen it for edits.",
        });
      }

      // Clearing is a write, so it takes the same scoped gate — a member can only
      // clear their own group's holes.
      if (!(await canWriteSkinsHole(ctx, ctx.tripId!, input.gameId, input.groupingId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only clear holes for your own group.",
        });
      }

      const { error } = await ctx.supabase
        .from("skins_hole_outcomes")
        .delete()
        .eq("game_id", input.gameId)
        .eq("grouping_id", input.groupingId)
        .eq("hole_number", input.holeNumber);
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to clear the hole: ${error.message}` });
      }
      return { ok: true };
    }),

  /** listByGame — every recorded hole. Read parity with `scores.listByGame`:
   *  any trip member, except that a game still in setup is hidden from anyone
   *  who cannot edit it. */
  listByGame: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const game = rowOrThrow(
        await ctx.supabase
          .from("games")
          .select("id, status")
          .eq("id", input.gameId)
          .eq("trip_id", ctx.tripId)
          .maybeSingle(),
        { code: "NOT_FOUND", message: "Game not found" },
        "game"
      );
      if ((game.status as string) === "pending" && !(await canEditGame(ctx, ctx.tripId, input.gameId))) {
        return [];
      }
      const { data, error } = await ctx.supabase
        .from("skins_hole_outcomes")
        .select("grouping_id, hole_number, result, winner_user_id")
        .eq("game_id", input.gameId);
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to list holes: ${error.message}` });
      }
      return data ?? [];
    }),
});
