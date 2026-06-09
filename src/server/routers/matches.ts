import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * matches — singles match-play setup + read (Slice B).
 *
 * Setup writes (pairings, handicap, reorder, activate) are Owner+Organizer
 * (`requireTripRole("Organizer")`), matching the competition-setup gate. Score
 * entry reuses Slice A's `scores.upsertEntry` (any member) — there is no score
 * procedure here. Result writes are server-side (`computeMatchPlayResults`).
 *
 * game-id-keyed procedures also take `tripId` so the standard trip middleware
 * gates them; we then verify the game belongs to that trip.
 *
 * Handicap lives on `game_participants.handicap_strokes` (one side `n`, the
 * other `0`) — never split, never in `games.modifiers.buddy_rules` (Slice F).
 */

const sideSchema = z.object({ type: z.literal("user"), id: z.string().min(1) });

async function assertGameInTrip(
  ctx: { supabase: { from: (t: string) => unknown } },
  gameId: string,
  tripId: string
) {
  const { data: game } = await (
    ctx.supabase.from("games") as unknown as {
      select: (s: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
        };
      };
    }
  )
    .select("id")
    .eq("id", gameId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!game) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  }
}

export const matchesRouter = router({
  // setPairings — Owner/Organizer. Replaces the game's matches and seeds the
  // foursome card (one play_group shared by the matches). Empty slots allowed
  // (filled later via assignPlayer); only set sides become participants.
  setPairings: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matches: z
          .array(
            z.object({
              sideA: sideSchema.nullable(),
              sideB: sideSchema.nullable(),
              matchNumber: z.number().int().min(1),
            })
          )
          .min(1)
          .max(4),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      // Replace existing matches + card for a clean re-save.
      await ctx.supabase.from("game_matches").delete().eq("game_id", input.gameId);
      await ctx.supabase.from("play_groups").delete().eq("game_id", input.gameId);

      const cardId = crypto.randomUUID();
      await ctx.supabase
        .from("play_groups")
        .insert({ id: cardId, game_id: input.gameId, display_name: "Card 1" });

      const rows = input.matches.map((m, i) => ({
        id: crypto.randomUUID(),
        game_id: input.gameId,
        play_group_id: cardId,
        match_number: m.matchNumber,
        display_order: i,
        side_a: m.sideA,
        side_b: m.sideB,
        status: "pending",
      }));
      const { error } = await ctx.supabase.from("game_matches").insert(rows);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to set pairings: ${error.message}`,
        });
      }

      // Seed participant rows (handicap_strokes lives here) for every set side.
      const userIds = [
        ...new Set(
          input.matches.flatMap((m) => [m.sideA?.id, m.sideB?.id]).filter((x): x is string => !!x)
        ),
      ];
      if (userIds.length > 0) {
        await ctx.supabase.from("game_participants").upsert(
          userIds.map((userId) => ({
            id: crypto.randomUUID(),
            game_id: input.gameId,
            user_id: userId,
            play_group_id: cardId,
            team_id: null,
          })),
          { onConflict: "game_id,user_id", ignoreDuplicates: true }
        );
      }

      const { data } = await ctx.supabase
        .from("game_matches")
        .select("*")
        .eq("game_id", input.gameId)
        .order("display_order", { ascending: true });
      return data ?? [];
    }),

  // assignPlayer — Owner/Organizer. Sets one slot. If the user is already in
  // another match, MOVE them: clear that slot and null both vacated-match
  // participants' handicap (the relationship that handicap described is gone).
  assignPlayer: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matchId: z.string().min(1),
        slot: z.enum(["a", "b"]),
        userId: z.string().min(1),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      const { data: matches } = await ctx.supabase
        .from("game_matches")
        .select("id, side_a, side_b, play_group_id")
        .eq("game_id", input.gameId);

      type Side = { type: string; id: string } | null;
      type Row = { id: string; side_a: Side; side_b: Side; play_group_id: string | null };
      const rows = (matches ?? []) as Row[];
      const target = rows.find((r) => r.id === input.matchId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
      }

      // Vacate the player from any OTHER match they currently occupy.
      for (const r of rows) {
        if (r.id === input.matchId) continue;
        const onA = r.side_a?.id === input.userId;
        const onB = r.side_b?.id === input.userId;
        if (!onA && !onB) continue;
        await ctx.supabase
          .from("game_matches")
          .update(onA ? { side_a: null } : { side_b: null })
          .eq("id", r.id);
        // Clear the vacated match's handicap for both its players.
        const vacatedUsers = [r.side_a?.id, r.side_b?.id].filter((x): x is string => !!x);
        if (vacatedUsers.length > 0) {
          await ctx.supabase
            .from("game_participants")
            .update({ handicap_strokes: null })
            .eq("game_id", input.gameId)
            .in("user_id", vacatedUsers);
        }
      }

      // Set the target slot.
      const { error } = await ctx.supabase
        .from("game_matches")
        .update(
          input.slot === "a"
            ? { side_a: { type: "user", id: input.userId } }
            : { side_b: { type: "user", id: input.userId } }
        )
        .eq("id", input.matchId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign player: ${error.message}`,
        });
      }

      // Ensure a participant row exists (handicap home).
      await ctx.supabase.from("game_participants").upsert(
        {
          id: crypto.randomUUID(),
          game_id: input.gameId,
          user_id: input.userId,
          play_group_id: target.play_group_id,
          team_id: null,
        },
        { onConflict: "game_id,user_id", ignoreDuplicates: true }
      );

      const { data } = await ctx.supabase
        .from("game_matches")
        .select("*")
        .eq("game_id", input.gameId)
        .order("display_order", { ascending: true });
      return data ?? [];
    }),

  // setHandicap — Owner/Organizer. One side gets `strokes`, the other 0.
  // Never split. (strokes=0 → even match, both 0.)
  setHandicap: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matchId: z.string().min(1),
        recipientUserId: z.string().min(1),
        strokes: z.number().int().min(0).max(36),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      const { data: match } = await ctx.supabase
        .from("game_matches")
        .select("side_a, side_b")
        .eq("id", input.matchId)
        .eq("game_id", input.gameId)
        .maybeSingle();
      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
      }
      const sides = [
        (match.side_a as { id: string } | null)?.id,
        (match.side_b as { id: string } | null)?.id,
      ].filter((x): x is string => !!x);
      if (!sides.includes(input.recipientUserId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Recipient is not in this match",
        });
      }
      const other = sides.find((id) => id !== input.recipientUserId);

      await ctx.supabase
        .from("game_participants")
        .update({ handicap_strokes: input.strokes })
        .eq("game_id", input.gameId)
        .eq("user_id", input.recipientUserId);
      if (other) {
        await ctx.supabase
          .from("game_participants")
          .update({ handicap_strokes: 0 })
          .eq("game_id", input.gameId)
          .eq("user_id", other);
      }
      return { ok: true };
    }),

  // reorder — Owner/Organizer. Persist display_order from the given order.
  reorder: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        orderedMatchIds: z.array(z.string().min(1)).min(1).max(4),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);
      for (let i = 0; i < input.orderedMatchIds.length; i++) {
        await ctx.supabase
          .from("game_matches")
          .update({ display_order: i })
          .eq("id", input.orderedMatchIds[i])
          .eq("game_id", input.gameId);
      }
      return { ok: true };
    }),

  // activate — Owner/Organizer. Publish pairings to members; round goes active.
  // Does NOT post to Notes (Slice F).
  activate: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);
      const { error } = await ctx.supabase
        .from("games")
        .update({ pairings_published_at: new Date().toISOString(), status: "active" })
        .eq("id", input.gameId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to activate: ${error.message}`,
        });
      }
      await ctx.supabase
        .from("game_matches")
        .update({ status: "active" })
        .eq("game_id", input.gameId)
        .eq("status", "pending");
      return { ok: true };
    }),

  // listByGame — any trip member. Visibility: Owner/Organizer always see match
  // detail; a Member sees matches only once pairings are published (else the
  // "not announced yet" state).
  listByGame: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, pairings_published_at")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      const published = !!game.pairings_published_at;

      if (ctx.tripRole === "Member" && !published) {
        return { published: false, matches: [], participants: [] };
      }

      const { data: matches } = await ctx.supabase
        .from("game_matches")
        .select("*")
        .eq("game_id", input.gameId)
        .order("display_order", { ascending: true });
      const { data: participants } = await ctx.supabase
        .from("game_participants")
        .select("user_id, handicap_strokes, play_group_id")
        .eq("game_id", input.gameId);

      return { published, matches: matches ?? [], participants: participants ?? [] };
    }),
});
