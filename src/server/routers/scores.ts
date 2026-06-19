import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * scores — per-unit score entry for a game (Slice A: per-hole strokes).
 *
 * ANY trip member may enter a score for ANY participant — anyone in the group
 * can keep the card; we don't force everyone phones-out (engine decision #7).
 * `submitted_by` records who typed it for audit only — it is NEVER a permission
 * gate. So this is `requireTripMember`, not Organizer+.
 */
export const scoresRouter = router({
  // upsertEntry — set one cell (game × participant × unit). Idempotent on the
  // UNIQUE(game_id, participant_id, unit_label) key.
  upsertEntry: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        participantId: z.string().min(1), // user_id (1v1/stroke) | play_group_id (2v2)
        unitLabel: z.string().min(1).max(16), // "1".."18"
        value: z.number().int().min(1).max(99).nullable(),
        // The scoring unit. Defaults to 'user' (singles/stroke — unchanged); a
        // 2v2 side records one entry per play_group.
        participantType: z.enum(["user", "play_group"]).optional(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      // Confirm the game belongs to this trip (the middleware gated the trip),
      // and that scores aren't locked. A POSTED game (status='complete' &&
      // !corrections_open) has frozen scores — editing requires the owner/
      // delegate to open score correction first (Run-Post §3). Results stay
      // visible; only entry is closed.
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

      // Deterministic id from the unique key so an upsert-on-conflict updates
      // the same row in place (never rewrites the PK).
      const id = `${input.gameId}:${input.participantId}:${input.unitLabel}`;
      const { error } = await ctx.supabase.from("score_entries").upsert(
        {
          id,
          game_id: input.gameId,
          participant_id: input.participantId,
          participant_type: input.participantType ?? "user",
          unit_label: input.unitLabel,
          value: input.value,
          submitted_by: ctx.user!.id,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "game_id,participant_id,unit_label" }
      );
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save score: ${error.message}`,
        });
      }

      // Scoring has begun → the game is Live (§A2: "scores are being entered
      // right now"). Stroke and rack have no explicit activate step — only
      // match play publishes pairings → active — so they would otherwise sit at
      // `pending` (rendered "Ready") through the whole round and jump straight to
      // Final on finish, never showing Live. This is the SINGLE score-write path
      // for every golf format, so flipping `pending` → `active` here lights up
      // all of them on the first score; an already-active (match-play) or
      // complete/correcting game is left untouched.
      //
      // ANY member may score (requireTripMember), but the games UPDATE RLS only
      // admits owner/organizer — so a member's own client can't flip the status.
      // Use the service-role client (same pattern as server-authored system
      // messages) for this automatic, non-privileged side effect.
      if (game.status === "pending") {
        await createAdminClient()
          .from("games")
          .update({ status: "active" })
          .eq("id", input.gameId)
          .eq("status", "pending");
      }

      const { data } = await ctx.supabase
        .from("score_entries")
        .select("*")
        .eq("id", id)
        .single();
      return data;
    }),

  // deleteEntry — remove one cell's score (any trip member, same as entry).
  deleteEntry: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        participantId: z.string().min(1),
        unitLabel: z.string().min(1).max(16),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      const { error } = await ctx.supabase
        .from("score_entries")
        .delete()
        .eq("game_id", input.gameId)
        .eq("participant_id", input.participantId)
        .eq("unit_label", input.unitLabel);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete score: ${error.message}`,
        });
      }
      return { ok: true };
    }),

  // listByGame — all user-type score entries for a game (any trip member). Lets
  // the client hydrate values on load (resume scoring) and compute live match
  // status on the matchup page via the shared matchPlay module.
  listByGame: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      // Both scoring units: 'user' (1v1/stroke) and 'play_group' (2v2 sides).
      // Singles games have only 'user' rows, so this is unchanged for them.
      const { data, error } = await ctx.supabase
        .from("score_entries")
        .select("participant_id, unit_label, value")
        .eq("game_id", input.gameId)
        .in("participant_type", ["user", "play_group"]);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list scores: ${error.message}`,
        });
      }
      return data ?? [];
    }),
});
