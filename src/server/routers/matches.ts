import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireGameEdit } from "../middleware";
import { computeMatchPlayResults } from "../lib/matchPlay";

/**
 * matches — singles match-play setup + read (Slice B).
 *
 * Setup writes (pairings, handicap, reorder, activate) are gated by
 * `requireGameEdit()` — trip Owner/Organizer OR a delegated organizer of THIS
 * game (game_organizers / migration 045). This extends the per-game delegate
 * path (originally landed for games / game_results) to the match-setup router so
 * a game's delegate can actually run it (§10), game-isolated: a delegate of one
 * game can't touch another. Score entry reuses Slice A's `scores.upsertEntry`
 * (any member) — there is no score procedure here. Result writes are
 * server-side (`computeMatchPlayResults`).
 *
 * game-id-keyed procedures also take `tripId` so the standard trip middleware
 * gates them; we then verify the game belongs to that trip.
 *
 * Handicap lives on `game_participants.handicap_strokes` (one side `n`, the
 * other `0`) — never split, never in `games.modifiers.buddy_rules` (Slice F).
 */

const sideSchema = z.object({ type: z.literal("user"), id: z.string().min(1) });
// 2v2 (doubles): a side is a PAIR of users. setDoublesPairings creates a
// play_group per side and stores side_a/side_b as {"type":"play_group","id":pgId}
// — the SAME match engine as singles, with the side being a pair.
const doublesSideSchema = z.object({ members: z.array(z.string().min(1)).length(2) });

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
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      // Replace existing matches for a clean re-save. play_group_id is NOT
      // written in Slice B — the overview is a flat list, not foursome-grouped
      // (the play_groups table is Slice C's 2v2 scoring side).
      await ctx.supabase.from("game_matches").delete().eq("game_id", input.gameId);

      const rows = input.matches.map((m, i) => ({
        id: crypto.randomUUID(),
        game_id: input.gameId,
        play_group_id: null,
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
            play_group_id: null,
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
    .use(requireGameEdit())
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

      // Roster is a recompute INPUT — re-derive every match touched (the
      // destination and any vacated match), in-progress only.
      await computeMatchPlayResults(ctx.supabase, input.gameId, { skipComplete: true });

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
    .use(requireGameEdit())
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
      // Handicap is a recompute INPUT — re-derive in-progress matches so existing
      // hole results reflect the new strokes (a frozen/complete match is skipped).
      await computeMatchPlayResults(ctx.supabase, input.gameId, { skipComplete: true });
      return { ok: true };
    }),

  // ── 2v2 / doubles (Slice C) ────────────────────────────────────────────────
  // The side is a PAIR (a play_group), the score is one entry per side per hole.
  // These are the doubles analogues of setPairings / setHandicap; the singles
  // procedures above are untouched, and the result math (computeMatchPlayResults)
  // is shared — it resolves a side by id whether the id is a user or a play_group.

  // setDoublesPairings — Owner/Organizer. Clean-replace the game's matches:
  // create a play_group per side (its 2 members → game_participants), and one
  // game_match between the two play-group sides. Mirrors setPairings' clean
  // re-save (setup-time; before scores exist).
  setDoublesPairings: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matches: z
          .array(
            z.object({
              sideA: doublesSideSchema.nullable(),
              sideB: doublesSideSchema.nullable(),
              matchNumber: z.number().int().min(1),
            })
          )
          .min(1)
          .max(4),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      // Clean replace (setup-time, before scoring — mirrors setPairings). Order
      // matters: matches reference play_groups (SET NULL), participants reference
      // play_groups (SET NULL); clear children then the play_groups.
      await ctx.supabase.from("game_matches").delete().eq("game_id", input.gameId);
      await ctx.supabase.from("game_participants").delete().eq("game_id", input.gameId);
      await ctx.supabase.from("play_groups").delete().eq("game_id", input.gameId);

      const pgRows: { id: string; game_id: string; display_name: null }[] = [];
      const partRows: {
        id: string;
        game_id: string;
        user_id: string;
        play_group_id: string;
        team_id: null;
      }[] = [];
      const matchRows = input.matches.map((m, i) => {
        const mkSide = (side: { members: string[] } | null) => {
          if (!side) return null;
          const pgId = crypto.randomUUID();
          pgRows.push({ id: pgId, game_id: input.gameId, display_name: null });
          for (const uid of side.members) {
            partRows.push({
              id: crypto.randomUUID(),
              game_id: input.gameId,
              user_id: uid,
              play_group_id: pgId,
              team_id: null,
            });
          }
          return { type: "play_group" as const, id: pgId };
        };
        return {
          id: crypto.randomUUID(),
          game_id: input.gameId,
          play_group_id: null,
          match_number: m.matchNumber,
          display_order: i,
          side_a: mkSide(m.sideA),
          side_b: mkSide(m.sideB),
          status: "pending",
        };
      });

      if (pgRows.length > 0) {
        const { error } = await ctx.supabase.from("play_groups").insert(pgRows);
        if (error) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create sides: ${error.message}` });
        }
      }
      if (partRows.length > 0) {
        // One row per user per game (UNIQUE game_id,user_id) — a player is on one side.
        const { error } = await ctx.supabase
          .from("game_participants")
          .upsert(partRows, { onConflict: "game_id,user_id" });
        if (error) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to seed players: ${error.message}` });
        }
      }
      const { error } = await ctx.supabase.from("game_matches").insert(matchRows);
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set pairings: ${error.message}` });
      }

      const { data } = await ctx.supabase
        .from("game_matches")
        .select("*")
        .eq("game_id", input.gameId)
        .order("display_order", { ascending: true });
      return data ?? [];
    }),

  // setDoublesHandicap — Owner/Organizer. The recipient SIDE (a play_group) gets
  // `strokes`, the other side 0 — never split. The side handicap lives on
  // play_groups.handicap_strokes (the doubles analogue of game_participants).
  setDoublesHandicap: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        matchId: z.string().min(1),
        recipientPlayGroupId: z.string().min(1),
        strokes: z.number().int().min(0).max(36),
      })
    )
    .use(requireGameEdit())
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
      if (!sides.includes(input.recipientPlayGroupId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Recipient is not a side in this match" });
      }
      const other = sides.find((id) => id !== input.recipientPlayGroupId);

      await ctx.supabase
        .from("play_groups")
        .update({ handicap_strokes: input.strokes })
        .eq("id", input.recipientPlayGroupId)
        .eq("game_id", input.gameId);
      if (other) {
        await ctx.supabase
          .from("play_groups")
          .update({ handicap_strokes: 0 })
          .eq("id", other)
          .eq("game_id", input.gameId);
      }
      // Handicap is a recompute input — re-derive in-progress matches (#9 freeze).
      await computeMatchPlayResults(ctx.supabase, input.gameId, { skipComplete: true });
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
    .use(requireGameEdit())
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
    .use(requireGameEdit())
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
        return { published: false, matches: [], participants: [], playGroups: [] };
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
      // The sides (pairs) for 2v2 — their handicap + display name. Empty for 1v1
      // (no play_groups created). The client maps a play_group side to its two
      // members via `participants.play_group_id`.
      const { data: playGroups } = await ctx.supabase
        .from("play_groups")
        .select("id, display_name, handicap_strokes")
        .eq("game_id", input.gameId);

      return {
        published,
        matches: matches ?? [],
        participants: participants ?? [],
        playGroups: playGroups ?? [],
      };
    }),
});
