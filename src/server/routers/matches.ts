import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireGameEdit, canEditGame } from "../middleware";
import { assertGameReady } from "../lib/gameReadiness";
import { computeMatchPlayResults } from "../lib/matchPlay";

/**
 * matches — singles match-play setup + read (Slice B).
 *
 * Setup writes (pairings, handicap, reorder, activate) are gated by
 * `requireGameEdit()` — trip Owner/Organizer OR a delegated organizer of THIS
 * game (game_delegates / migration 045 → 061). This extends the per-game delegate
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

// Match count is dynamic (start at 1, add as foursomes are set). The cap is a
// generous ceiling — far above any realistic field — not the old fixed 4.
const MAX_MATCHES = 24;

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
          .max(MAX_MATCHES),
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
          .max(MAX_MATCHES),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      // Setup-integrity backstop: in a competition, both members of a pair MUST
      // be on the same team — a side is one team's pair. The client constrains
      // the picker so this can't happen from the UI; this hard-blocks the raw API
      // (defense in depth — never silently accept a cross-team pair).
      const { data: gameRow } = await ctx.supabase
        .from("games")
        .select("competition_id")
        .eq("id", input.gameId)
        .maybeSingle();
      const competitionId = (gameRow?.competition_id as string | null) ?? null;
      if (competitionId) {
        const { data: assigns } = await ctx.supabase
          .from("team_assignments")
          .select("user_id, team_id")
          .eq("competition_id", competitionId);
        const teamOf = new Map<string, string>();
        for (const a of assigns ?? []) teamOf.set(a.user_id as string, a.team_id as string);
        for (const m of input.matches) {
          for (const side of [m.sideA, m.sideB]) {
            if (!side) continue;
            const t0 = teamOf.get(side.members[0]);
            const t1 = teamOf.get(side.members[1]);
            if (t0 && t1 && t0 !== t1) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "A 2v2 pair must be from the same team" });
            }
          }
        }
      }

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

  // addMatch — Owner/Organizer/delegate. Append ONE empty match (the dynamic
  // "+1"). The configured match count = game_matches rows, so a new row raises
  // the clinch goalpost (value × count) immediately, paired or not. Sides get
  // filled after via assignPlayer (1v1) / the doubles assignment flow. A match
  // added to an already-active game is itself active (scoreable now); on a
  // pending game it stays pending until activate. Refuses past the cap.
  addMatch: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      const { data: existing } = await ctx.supabase
        .from("game_matches")
        .select("match_number, display_order")
        .eq("game_id", input.gameId);
      const rows = (existing ?? []) as { match_number: number; display_order: number }[];
      if (rows.length >= MAX_MATCHES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A game can have at most ${MAX_MATCHES} matches` });
      }
      const nextNumber = rows.reduce((mx, r) => Math.max(mx, r.match_number ?? 0), 0) + 1;
      const nextOrder = rows.reduce((mx, r) => Math.max(mx, r.display_order ?? -1), -1) + 1;

      // Active game → the new match is immediately scoreable; pending → pending.
      const { data: game } = await ctx.supabase
        .from("games")
        .select("status")
        .eq("id", input.gameId)
        .maybeSingle();
      const status = (game?.status as string | undefined) === "active" ? "active" : "pending";

      const { error } = await ctx.supabase.from("game_matches").insert({
        id: crypto.randomUUID(),
        game_id: input.gameId,
        play_group_id: null,
        match_number: nextNumber,
        display_order: nextOrder,
        side_a: null,
        side_b: null,
        status,
      });
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to add match: ${error.message}` });
      }

      const { data } = await ctx.supabase
        .from("game_matches")
        .select("*")
        .eq("game_id", input.gameId)
        .order("display_order", { ascending: true });
      return data ?? [];
    }),

  // removeMatch — Owner/Organizer/delegate. Delete ONE match (the dynamic "-1"),
  // lowering the clinch goalpost by one × value. Hard-deletes the match, its
  // sides' participants/play_groups, and ANY entered scores + side results for
  // those sides (a player/pair is in exactly one match) — then recomputes the
  // rest. The CLIENT confirms first when the match has scores (don't silently
  // drop entry); the server still cleans up fully. Refuses to drop below 1 (a
  // match game always keeps ≥1 configured match).
  removeMatch: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), matchId: z.string().min(1) }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);

      const { data: all } = await ctx.supabase
        .from("game_matches")
        .select("id, side_a, side_b")
        .eq("game_id", input.gameId);
      type Side = { type: string; id: string } | null;
      const rows = (all ?? []) as { id: string; side_a: Side; side_b: Side }[];
      if (rows.length <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A match game must keep at least one match" });
      }
      const target = rows.find((r) => r.id === input.matchId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
      }

      const sides = [target.side_a, target.side_b].filter(
        (s): s is { type: string; id: string } => !!s?.id
      );
      const userSideIds = sides.filter((s) => s.type === "user").map((s) => s.id);
      const pgSideIds = sides.filter((s) => s.type === "play_group").map((s) => s.id);
      // The side id IS the score key (score_entries.participant_id) and the
      // side-level result key (game_results.entity_id) — a user for 1v1, a
      // play_group for 2v2.
      const sideKeyIds = [...userSideIds, ...pgSideIds];

      // Drop the match first so the recompute below sees the reduced set.
      await ctx.supabase.from("game_matches").delete().eq("id", input.matchId);

      if (sideKeyIds.length > 0) {
        await ctx.supabase.from("score_entries").delete().eq("game_id", input.gameId).in("participant_id", sideKeyIds);
        await ctx.supabase.from("game_results").delete().eq("game_id", input.gameId).in("entity_id", sideKeyIds);
      }
      if (userSideIds.length > 0) {
        await ctx.supabase.from("game_participants").delete().eq("game_id", input.gameId).in("user_id", userSideIds);
      }
      if (pgSideIds.length > 0) {
        await ctx.supabase.from("game_participants").delete().eq("game_id", input.gameId).in("play_group_id", pgSideIds);
        await ctx.supabase.from("play_groups").delete().eq("game_id", input.gameId).in("id", pgSideIds);
      }

      // Recompute remaining in-progress matches — rebuilds the per-team totals so
      // the board reflects the drop (a frozen/complete match is left alone).
      await computeMatchPlayResults(ctx.supabase, input.gameId, { skipComplete: true });

      const { data } = await ctx.supabase
        .from("game_matches")
        .select("*")
        .eq("game_id", input.gameId)
        .order("display_order", { ascending: true });
      return data ?? [];
    }),

  // reorder — Owner/Organizer. Persist display_order from the given order.
  reorder: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        orderedMatchIds: z.array(z.string().min(1)).min(1).max(MAX_MATCHES),
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

  // enableScoring — Owner/Organizer. Match play's "Enable scoring": publish
  // pairings to the crew + open the game for scoring (scoring_enabled). Phase
  // 2B.1 SPLIT it from going Live — it no longer sets status='active'; the FIRST
  // score owns the flip to Live (#396, uniform across formats). So enabled-ness
  // lives in scoring_enabled for every format (not pairings_published_at for
  // match while the boolean covers stroke/rack). Does NOT post to Notes (Slice F).
  // (Was `activate` — renamed in R4 to the single ratified term; see CLAUDE.md glossary.)
  enableScoring: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      await assertGameInTrip(ctx, input.gameId, ctx.tripId);
      // A2-core: the mode toggle OWNS status — Setup→Scoring sets status:'active'
      // (no longer "first score owns Live"), gated by the server readiness guard.
      await assertGameReady(ctx.supabase, input.gameId);
      const { error } = await ctx.supabase
        .from("games")
        .update({ pairings_published_at: new Date().toISOString(), scoring_enabled: true, status: "active" })
        .eq("id", input.gameId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to enable scoring: ${error.message}`,
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
        .select("id, status, pairings_published_at")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      const published = !!game.pairings_published_at;

      // A2-core access gate: keyed on STATUS (the canonical setup/scoring signal),
      // not pairings_published_at. A SETUP-mode (pending) game's matches are hidden
      // from everyone EXCEPT the owner/organizer/this-game's-delegate (canEditGame —
      // which, unlike the old `tripRole === "Member"` check, correctly lets a plain-
      // member DELEGATE see the game they're setting up). RLS walls the raw layer too.
      if ((game.status as string) === "pending" && !(await canEditGame(ctx, ctx.tripId, input.gameId))) {
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
