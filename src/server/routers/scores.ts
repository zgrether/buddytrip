import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, canEditGame } from "../middleware";
import { canWriteScore } from "../lib/scoreAccess";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * scores — per-unit score entry for a game (Slice A: per-hole strokes).
 *
 * SCOPED score-entry permissions (mig 072 — SERVER-enforced, RLS-backed):
 *   Owner / Organizer (co-admin) / delegate-of-this-game → any unit.
 *   Member → only the match/group they participate in (per-format `canWriteScore`
 *            → `memberCanScoreUnit`).
 *   Non-participant member → nothing.
 * Hiding the entry button isn't enough (anyone can call this mutation directly),
 * so the guard lives here AND in the score_entries RLS. `submitted_by` records who
 * typed it for audit only. `requireTripMember` gates trip membership; `canWriteScore`
 * gates the unit.
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
        .select("id, status, corrections_open, scoring_enabled")
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
      // Phase 2B.1 universal gate: scoring must be ENABLED before entries land,
      // for every format (match play already gated via publish; stroke/rack gain
      // the gate they lacked). A posted game re-opened for correction is already
      // enabled, so corrections still pass. Enable the game first to score it.
      if (!game.scoring_enabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Enable scoring before entering scores.",
        });
      }

      // Score-entry permissions (SERVER — the real gate; the UI only reflects it).
      // Owner / co-admin / delegate-of-this-game → any unit; a plain member → only
      // the match/group they participate in (per-format, `memberCanScoreUnit`).
      // Anyone else (incl. a non-participant of the game) is rejected — hiding the
      // button isn't enough, this rejects the raw mutation too.
      if (
        !(await canWriteScore(
          ctx,
          ctx.tripId!,
          input.gameId,
          input.participantId,
          input.participantType ?? "user",
        ))
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only enter scores for your own match or group.",
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
      //
      // A2-core: status is NORMALLY set by the mode toggle (enableScoring now sets
      // status:'active'), so on the happy path this is a no-op (a member can't reach
      // a pending game to score it once the gate lands). It's kept as the FALLBACK
      // for any enable path that bypasses the toggle.
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
        // Same scoring unit as upsertEntry — needed to resolve unit membership for
        // the permission check. Defaults to 'user' (singles/stroke/rack).
        participantType: z.enum(["user", "play_group"]).optional(),
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

      // Same scoped gate as upsertEntry — clearing a cell is a score write too, so
      // a member can only clear scores in their own unit (owner/delegate anywhere).
      if (
        !(await canWriteScore(
          ctx,
          ctx.tripId!,
          input.gameId,
          input.participantId,
          input.participantType ?? "user",
        ))
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only clear scores for your own match or group.",
        });
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
        .select("id, status")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      // A2-core access gate: a member can't read scores for a SETUP-mode (pending)
      // game — only the owner/organizer/delegate setting it up can. (RLS enforces
      // this at the raw layer too.)
      if ((game.status as string) === "pending" && !(await canEditGame(ctx, ctx.tripId, input.gameId))) {
        return [];
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
