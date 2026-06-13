import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole, requireGameEdit } from "../middleware";
import { computeStrokePlayResults } from "../lib/strokePlay";
import { computeMatchPlayResults } from "../lib/matchPlay";
import { computeRackNStackResults } from "../lib/rackNStack";
import { buildScorecardSchema, validateStrokeIndex, type ScorecardSchema } from "@/lib/courseIndex";
import { validatePlacement } from "@/lib/gameConfig";

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
  // create — Owner/Organizer. The Phase-1 shell (D1 §3): competition_id +
  // game_type + name + points_distribution + status is a FULLY VALID game; every
  // Phase-2 field (course, schema, pairings, schedule_item, tee_time) stays null
  // until someone fills it. A shell is leaderboard-contributing on its own.
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameTypeId: z.string(),
        name: z.string().max(200).optional(),
        teeTime: z.string().max(5).nullable().optional(), // "HH:MM" 24h
        competitionId: z.string().nullable().optional(), // team formats / competition games
        // Competition-layer fact: tagged distribution shape (D1 follow-on §1).
        pointsDistribution: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("placement"), values: z.array(z.number().min(0)).max(64) }),
            z.object({ type: z.literal("per_match"), value: z.number().min(0) }),
          ])
          .nullable()
          .optional(),
        // Owner-set TOTAL for placement games (Stage 3). NULL for match games
        // (total derived = value × matchCount). Set here on create from the
        // Game tab; changed later only via setPointsTotal (owner-only).
        pointsTotal: z.number().min(0).nullable().optional(),
        // Optional, one-directional agenda link — never a gate. (§9)
        scheduleItemId: z.string().uuid().nullable().optional(),
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
        competition_id: input.competitionId ?? null,
        game_type_id: input.gameTypeId,
        name: input.name ?? null,
        tee_time: input.teeTime ?? null,
        points_distribution: input.pointsDistribution ?? null,
        points_total: input.pointsTotal ?? null,
        schedule_item_id: input.scheduleItemId ?? null,
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

  // listTypes — the format catalog driving the creation chips (data-driven, NOT a
  // hardcoded enum). `manual` (no result_strategy / no scorecard_schema) is the
  // non-engine "Other" type; the rest are engine golf formats. (§2b/§7)
  listTypes: authedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("game_type_templates")
      .select("id, key, name, description, result_strategy, scorecard_schema, category, sort_order")
      .order("sort_order", { ascending: true });
    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to list game types: ${error.message}` });
    }
    return (data ?? []).map((t) => ({
      id: t.id as string,
      key: t.key as string,
      name: t.name as string,
      description: (t.description as string | null) ?? null,
      // "engine" = computes results from a scorecard; otherwise manual (entered).
      isEngine: t.result_strategy != null,
      isGolf: t.scorecard_schema != null, // golf engine types carry a scorecard
      resultStrategy: (t.result_strategy as string | null) ?? null,
      // The creation Type tier (golf | card | yard | bar | other). Data-driven.
      category: (t.category as string | null) ?? "other",
    }));
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
    .use(requireGameEdit())
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

  // applyCourse — Owner/Organizer. THE CONTRACT (Slice C §0): snapshot the
  // course's par[] + handicap_index[] into games.scorecard_schema.units.metadata
  // (a COPY, not a live ref) so a later edit to the global course never rescores
  // this game. course_id is kept as provenance. Re-snapshot is allowed before
  // any score exists; FROZEN once scores are entered (freeze boundary).
  applyCourse: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), courseId: z.string().min(1) }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, game_type_id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

      // Freeze boundary: once any score is in, the par/index the game is being
      // played on is fixed — re-applying a course would silently rescore it.
      const { count } = await ctx.supabase
        .from("score_entries")
        .select("id", { count: "exact", head: true })
        .eq("game_id", input.gameId);
      if ((count ?? 0) > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Scores are already entered — the course can't be changed now.",
        });
      }

      const { data: course } = await ctx.supabase
        .from("courses")
        .select("hole_count, par, handicap_index, has_stroke_index")
        .eq("id", input.courseId)
        .maybeSingle();
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });

      const holeCount = course.hole_count as number;
      const par = course.par as number[];
      const hasIndex = (course.has_stroke_index as boolean | null) ?? true;
      // Index-off course → snapshot par only (buildScorecardSchema fills a
      // sequential index; net falls back to hole order). Index-on → validate it
      // as defense in depth before snapshotting.
      const handicapIndex = hasIndex ? (course.handicap_index as number[]) : null;
      if (hasIndex && !validateStrokeIndex(handicapIndex!, holeCount).valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Course stroke index is not a valid permutation — fix it before use.",
        });
      }

      const { data: template } = await ctx.supabase
        .from("game_type_templates")
        .select("scorecard_schema")
        .eq("id", game.game_type_id as string)
        .maybeSingle();
      const baseSchema = template?.scorecard_schema as ScorecardSchema | null;
      if (!baseSchema?.units) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Game type has no scorecard schema to snapshot onto.",
        });
      }

      const snapshot = buildScorecardSchema(baseSchema, par, handicapIndex, holeCount);
      const { error } = await ctx.supabase
        .from("games")
        .update({ scorecard_schema: snapshot, course_id: input.courseId })
        .eq("id", input.gameId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to apply course: ${error.message}`,
        });
      }

      const { data } = await ctx.supabase.from("games").select("*").eq("id", input.gameId).single();
      return data;
    }),

  // finish — Owner/Organizer. Compute + persist results, mark complete.
  // Branches on the game type's result_strategy (data-driven, NOT a hardcoded
  // format name) so new formats slot in without touching this. Idempotent: each
  // compute replaces prior game_results, and status='complete' again is a no-op.
  finish: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameEdit())
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

      // Data-driven branch on the template's result_strategy (CLAUDE.md #8) —
      // new strategies slot in here without touching the rest of finish.
      const matches = strategy === "match_play" ? await computeMatchPlayResults(ctx.supabase, input.gameId) : [];
      const teams = strategy === "rack_n_stack" ? await computeRackNStackResults(ctx.supabase, input.gameId) : [];
      const standings =
        strategy === "match_play" || strategy === "rack_n_stack"
          ? []
          : await computeStrokePlayResults(ctx.supabase, input.gameId);

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
      return { standings, matches, teams };
    }),

  // update — game-edit gate. Phase-1 shell fields the creation modal edits.
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        name: z.string().max(200).nullable().optional(),
        teeTime: z.string().max(5).nullable().optional(),
        scheduleItemId: z.string().uuid().nullable().optional(),
        // The "How's it played?" label (Configuration tab). Owner or delegate.
        competitionFormat: z
          .enum(["head_to_head", "bracket_se", "bracket_de", "best_of_n", "live_results"])
          .nullable()
          .optional(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.teeTime !== undefined) patch.tee_time = input.teeTime;
      if (input.scheduleItemId !== undefined) patch.schedule_item_id = input.scheduleItemId;
      if (input.competitionFormat !== undefined) patch.competition_format = input.competitionFormat;
      if (Object.keys(patch).length === 0) return { success: true };
      const { error } = await ctx.supabase.from("games").update(patch).eq("id", input.gameId).eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to update game: ${error.message}` });
      return { success: true };
    }),

  // setStatus — game-edit gate. A game pulled for time is `dropped`, NOT deleted
  // (§4): reversible, kept, and excluded from the leaderboard roll-up (which reads
  // only live games). The win number is DERIVED from the live set, so dropping /
  // restoring moves it automatically — there is no stored win number to update.
  setStatus: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        status: z.enum(["pending", "active", "complete", "dropped"]),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("games")
        .update({ status: input.status })
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set status: ${error.message}` });
      return { success: true };
    }),

  // setPointsTotal — Owner/Organizer ONLY (the delegation boundary, Stage 3).
  // A game's TOTAL is owner-set; a game-delegate distributes WITHIN it but can't
  // change it. requireTripRole("Organizer") blocks a Member-level delegate
  // outright (a delegate has only a game_organizers grant, not Organizer role).
  // NULL clears the total (match games, whose total is derived).
  setPointsTotal: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), total: z.number().min(0).nullable() }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games").select("id").eq("id", input.gameId).eq("trip_id", ctx.tripId).maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      const { error } = await ctx.supabase
        .from("games").update({ points_total: input.total }).eq("id", input.gameId).eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set total: ${error.message}` });
      return { success: true };
    }),

  // setPointsDistribution — game-edit gate (owner OR game-delegate). The
  // competition-layer split. Editing it re-derives the leaderboard on next read
  // (§5b/§6). Stage 3 sum-to-total: a PLACEMENT split must equal the owner-set
  // points_total once distribution has BEGUN (values non-empty). An empty
  // (undistributed) split saves — the shell/delegate state; a PARTIAL one
  // (entered ≠ total) is rejected. per_match carries no total relationship. Uses
  // the SAME validatePlacement the client uses (CLAUDE.md #8), so the API can't
  // accept what the UI blocks.
  setPointsDistribution: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        distribution: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("placement"), values: z.array(z.number().min(0)).max(64) }),
            z.object({ type: z.literal("per_match"), value: z.number().min(0) }),
          ])
          .nullable(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      if (input.distribution?.type === "placement") {
        const { data: game } = await ctx.supabase
          .from("games").select("points_total").eq("id", input.gameId).eq("trip_id", ctx.tripId).maybeSingle();
        const total = (game?.points_total as number | null) ?? null;
        // Only enforce when a total exists to enforce against. (A legacy game
        // with no owner-set total keeps its pre-Slice-D free-form behavior.)
        if (total != null) {
          const check = validatePlacement(total, input.distribution.values);
          if (!check.saveable) {
            const over = check.remaining < 0;
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Points must total ${total} exactly — ${check.allocated} allocated, ${over ? `${-check.remaining} over` : `${check.remaining} left to place`}.`,
            });
          }
        }
      }
      const { error } = await ctx.supabase
        .from("games")
        .update({ points_distribution: input.distribution })
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set distribution: ${error.message}` });
      return { success: true };
    }),

  // setManualResults — the manual adapter (§5a), game-edit gate. A non-engine
  // ("manual") game's per-team finishing order, ENTERED by an organizer into the
  // SAME `game_results` table engine games compute into. The roll-up never
  // distinguishes computed from entered. Replace-all so clearing a team drops it.
  // Placement POINTS stay derived (placementPoints) — we store only the standing.
  setManualResults: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        placements: z
          .array(z.object({ entityId: z.string().min(1), position: z.number().int().min(1).max(99) }))
          .max(64),
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

      const { error: delErr } = await ctx.supabase.from("game_results").delete().eq("game_id", input.gameId);
      if (delErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to clear results: ${delErr.message}` });

      if (input.placements.length === 0) return { success: true, count: 0 };

      const rows = input.placements.map((p) => ({
        id: crypto.randomUUID(),
        game_id: input.gameId,
        entity_id: p.entityId,
        entity_type: "team",
        position: p.position,
        raw_score: p.position, // standing = finishing place (low_wins); points derived
      }));
      const { error: insErr } = await ctx.supabase.from("game_results").insert(rows);
      if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to save results: ${insErr.message}` });
      return { success: true, count: rows.length };
    }),

  // addOrganizer — trip Owner/Organizer only (delegating is a trip-staff act; a
  // delegate cannot sub-delegate). Grants BJ the game-scoped organizer role (§8).
  addOrganizer: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), userId: z.string().min(1) }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      const { error } = await ctx.supabase
        .from("game_organizers")
        .upsert(
          { game_id: input.gameId, user_id: input.userId, granted_by: ctx.user!.id },
          { onConflict: "game_id,user_id", ignoreDuplicates: true }
        );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to add organizer: ${error.message}` });
      return { success: true };
    }),

  // removeOrganizer — trip Owner/Organizer only.
  removeOrganizer: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), userId: z.string().min(1) }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("game_organizers")
        .delete()
        .eq("game_id", input.gameId)
        .eq("user_id", input.userId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to remove organizer: ${error.message}` });
      return { success: true };
    }),

  // listOrganizers — any trip member can see who runs which game.
  listOrganizers: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data } = await ctx.supabase
        .from("game_organizers")
        .select("user_id, granted_by, created_at")
        .eq("game_id", input.gameId);
      return data ?? [];
    }),
});
