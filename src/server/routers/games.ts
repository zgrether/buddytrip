import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { computeStrokePlayResults } from "../lib/strokePlay";
import { computeMatchPlayResults } from "../lib/matchPlay";

/**
 * games — the competition-engine spine (Slice A: individual stroke play).
 *
 * Game setup (create / addParticipants) is Owner+Organizer work
 * (`requireTripRole("Organizer")`); score entry (separate `scores` router) is
 * open to any trip member. game-id-keyed procedures also take `tripId` so the
 * standard trip middleware can gate them — we then verify the game belongs to
 * that trip (defends against a gameId from another trip).
 */
export const gamesRouter = router({
  // create — Owner/Organizer. Standalone game (competition_id null), pending.
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameTypeId: z.string(),
        name: z.string().max(200).optional(),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      // The creator is a trip member, so games_select passes on the new row —
      // no INSERT/SELECT split needed (unlike trips.create).
      const { error: insertErr } = await ctx.supabase.from("games").insert({
        id,
        trip_id: ctx.tripId,
        competition_id: null,
        game_type_id: input.gameTypeId,
        name: input.name ?? null,
        status: "pending",
      });
      if (insertErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create game: ${insertErr.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("games")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created game: ${error?.message}`,
        });
      }
      return data;
    }),

  // listByTrip — any trip member.
  listByTrip: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("games")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: false });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list games: ${error.message}`,
        });
      }
      return data ?? [];
    }),

  // getById — any trip member. Returns the game + its participants.
  getById: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: game, error } = await ctx.supabase
        .from("games")
        .select("*")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch game: ${error.message}`,
        });
      }
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      const { data: participants } = await ctx.supabase
        .from("game_participants")
        .select("*")
        .eq("game_id", input.gameId)
        .order("created_at", { ascending: true });

      return { ...game, participants: participants ?? [] };
    }),

  // addParticipants — Owner/Organizer. 2–4 users, individual (no side/team).
  addParticipants: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        userIds: z.array(z.string().min(1)).min(2).max(4),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // Confirm the game is in this trip before writing participants.
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      const rows = input.userIds.map((userId) => ({
        id: crypto.randomUUID(),
        game_id: input.gameId,
        user_id: userId,
        play_group_id: null,
        team_id: null,
      }));
      // Idempotent re-adds: UNIQUE(game_id, user_id) — skip duplicates.
      const { error } = await ctx.supabase
        .from("game_participants")
        .upsert(rows, { onConflict: "game_id,user_id", ignoreDuplicates: true });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to add participants: ${error.message}`,
        });
      }

      const { data } = await ctx.supabase
        .from("game_participants")
        .select("*")
        .eq("game_id", input.gameId)
        .order("created_at", { ascending: true });
      return data ?? [];
    }),

  // finish — Owner/Organizer. Compute + persist results, mark complete.
  // Branches on the game type's result_strategy (data-driven, NOT a hardcoded
  // format name) so new formats slot in without touching this. Idempotent: each
  // compute replaces prior game_results, and status='complete' again is a no-op.
  finish: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, game_type_id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      const { data: template } = await ctx.supabase
        .from("game_type_templates")
        .select("result_strategy")
        .eq("id", game.game_type_id as string)
        .maybeSingle();
      const strategy = (template?.result_strategy as string | null) ?? "stroke_total";

      const isMatchPlay = strategy === "match_play";
      const matches = isMatchPlay ? await computeMatchPlayResults(ctx.supabase, input.gameId) : [];
      const standings = isMatchPlay ? [] : await computeStrokePlayResults(ctx.supabase, input.gameId);

      const { error } = await ctx.supabase
        .from("games")
        .update({ status: "complete" })
        .eq("id", input.gameId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to finish game: ${error.message}`,
        });
      }
      return { standings, matches };
    }),
});
