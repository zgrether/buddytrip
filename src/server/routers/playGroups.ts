import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireGameEdit } from "../middleware";
import { clampStrokes } from "@/lib/handicap";
import { computeMatchPlayResults } from "../lib/matchPlay";
import { computeRackNStackResults } from "../lib/rackNStack";

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
  // setFoursomes — trip Owner/Organizer OR this game's delegate (requireGameEdit,
  // §10). Replaces the game's foursomes + roster.
  setFoursomes: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        groups: z
          .array(
            z.object({
              name: z.string().max(60).optional(),
              teeTime: z.string().max(5).nullable().optional(), // "HH:MM" 24h
              userIds: z.array(z.string().min(1)).min(1).max(6),
            })
          )
          .max(12),
      })
    )
    .use(requireGameEdit())
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
          .insert({ id: groupId, game_id: input.gameId, display_name: g.name ?? `Group ${i + 1}`, tee_time: g.teeTime ?? null });
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

  // setParticipantStrokes — trip Owner/Organizer OR this game's delegate
  // (requireGameEdit, §10). The per-player ABSOLUTE handicap
  // (Mode A), distinct from match play's relative one-side setHandicap. Server-
  // clamped to 0–18. Handicap is a scoring input, so the change re-derives the
  // game's in-progress results (CLAUDE.md "derived values recompute" pattern) —
  // a frozen/complete game is never rewritten.
  setParticipantStrokes: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), userId: z.string().min(1), strokes: z.number().int() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, status, game_type_id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

      const strokes = clampStrokes(input.strokes);
      const { error } = await ctx.supabase
        .from("game_participants")
        .update({ handicap_strokes: strokes })
        .eq("game_id", input.gameId)
        .eq("user_id", input.userId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set strokes: ${error.message}` });

      // Re-derive in-progress results; leave a complete (frozen) game untouched.
      if (game.status !== "complete") {
        const { data: tmpl } = await ctx.supabase
          .from("game_type_templates")
          .select("result_strategy")
          .eq("id", game.game_type_id as string)
          .maybeSingle();
        const strategy = (tmpl?.result_strategy as string | null) ?? "stroke_total";
        if (strategy === "match_play") await computeMatchPlayResults(ctx.supabase, input.gameId, { skipComplete: true });
        else if (strategy === "rack_n_stack") await computeRackNStackResults(ctx.supabase, input.gameId);
      }
      return { ok: true, strokes };
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
    .select("id, display_name, tee_time, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });
  const { data: participants } = await supabase
    .from("game_participants")
    .select("user_id, play_group_id, handicap_strokes")
    .eq("game_id", gameId);
  return { groups: groups ?? [], participants: participants ?? [] };
}
