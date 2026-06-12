import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

/**
 * playGroups — foursomes for a game (the scoring-side use of `play_groups`,
 * Slice C rack-n-stack). A foursome is a mixed-team group of ~4 that walks
 * together and shares one stroke-play card; `game_participants.play_group_id`
 * links each player to theirs. Setting foursomes also seeds the roster (the
 * union of the grouped players). Handicaps are per-participant (net play).
 *
 * Rack-n-stack slots are NOT here — they're a derived read-model computed live
 * over score_entries; only the foursomes (entry units) persist.
 */
export const playGroupsRouter = router({
  // setFoursomes — Owner/Organizer. Replaces the game's foursomes + roster.
  setFoursomes: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        groups: z
          .array(z.object({ name: z.string().max(60).optional(), userIds: z.array(z.string().min(1)).min(1).max(6) }))
          .max(12),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

      // Roster = the union of grouped players. Idempotent re-adds (UNIQUE).
      const allIds = [...new Set(input.groups.flatMap((g) => g.userIds))];
      if (allIds.length > 0) {
        const rows = allIds.map((userId) => ({
          id: crypto.randomUUID(),
          game_id: input.gameId,
          user_id: userId,
          play_group_id: null,
          team_id: null,
        }));
        const { error: pErr } = await ctx.supabase
          .from("game_participants")
          .upsert(rows, { onConflict: "game_id,user_id", ignoreDuplicates: true });
        if (pErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to add players: ${pErr.message}` });
      }

      // Rebuild play_groups (SET NULL clears participants' play_group_id first).
      await ctx.supabase.from("play_groups").delete().eq("game_id", input.gameId);

      for (let i = 0; i < input.groups.length; i++) {
        const g = input.groups[i];
        const groupId = crypto.randomUUID();
        const { error: gErr } = await ctx.supabase
          .from("play_groups")
          .insert({ id: groupId, game_id: input.gameId, display_name: g.name ?? `Group ${i + 1}` });
        if (gErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create group: ${gErr.message}` });
        const { error: aErr } = await ctx.supabase
          .from("game_participants")
          .update({ play_group_id: groupId })
          .eq("game_id", input.gameId)
          .in("user_id", g.userIds);
        if (aErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to assign group: ${aErr.message}` });
      }

      return await readGroups(ctx.supabase, input.gameId);
    }),

  // setHandicap — Owner/Organizer. Net strokes for one participant (null = 0).
  setHandicap: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), userId: z.string().min(1), strokes: z.number().int().min(0).max(54) }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("game_participants")
        .update({ handicap_strokes: input.strokes })
        .eq("game_id", input.gameId)
        .eq("user_id", input.userId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set handicap: ${error.message}` });
      return { ok: true };
    }),

  // listByGame — any trip member. Foursomes + each participant's group/handicap.
  listByGame: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => readGroups(ctx.supabase, input.gameId)),
});

async function readGroups(supabase: import("@supabase/supabase-js").SupabaseClient, gameId: string) {
  const { data: groups } = await supabase
    .from("play_groups")
    .select("id, display_name, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });
  const { data: participants } = await supabase
    .from("game_participants")
    .select("user_id, play_group_id, handicap_strokes")
    .eq("game_id", gameId);
  return { groups: groups ?? [], participants: participants ?? [] };
}
