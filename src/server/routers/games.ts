import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole, requireGameEdit, requireGameRunAction } from "../middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStrokePlayResults } from "../lib/strokePlay";
import { computeMatchPlayResults } from "../lib/matchPlay";
import { computeRackNStackResults } from "../lib/rackNStack";
import type { MatchOutcome } from "../lib/matchPlay";
import type { RackTeamOutcome } from "../lib/rackNStack";
import type { StrokeStanding } from "@/lib/strokePlay";
import { buildScorecardSchema, validateStrokeIndex, type SnapshotTee } from "@/lib/courseIndex";
import { validatePlacement } from "@/lib/gameConfig";
import { GAME_TYPES, getGameTypeDefinition } from "@/lib/gameTypes";

/**
 * games — the competition-engine spine (Slice A: individual stroke play).
 *
 * Game setup (create / addParticipants) is Owner+Organizer work
 * (`requireTripRole("Organizer")`); score entry (separate `scores` router) is
 * open to any trip member. game-id-keyed procedures also take `tripId` so the
 * standard trip middleware can gate them — we then verify the game belongs to
 * that trip (defends against a gameId from another trip).
 */
/**
 * Shared manual-result write (Slice D §5a / Run-Post §2): replace a game's
 * per-team finishing order in `game_results`. The ONE write path for entered
 * placements — both `setManualResults` and the run `post` action use it, so
 * there's no parallel commit. Placement POINTS stay derived (placementPoints);
 * we store only the standing (position; raw_score mirrors it for low_wins).
 */
async function writeManualResults(
  supabase: SupabaseClient,
  gameId: string,
  placements: { entityId: string; position: number }[]
): Promise<number> {
  const { error: delErr } = await supabase.from("game_results").delete().eq("game_id", gameId);
  if (delErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to clear results: ${delErr.message}` });
  if (placements.length === 0) return 0;
  const rows = placements.map((p) => ({
    id: crypto.randomUUID(),
    game_id: gameId,
    entity_id: p.entityId,
    entity_type: "team",
    position: p.position,
    raw_score: p.position,
  }));
  const { error: insErr } = await supabase.from("game_results").insert(rows);
  if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to save results: ${insErr.message}` });
  return rows.length;
}

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

  // listTypes — the format catalog driving the creation chips. Format DEFINITIONS
  // live in CODE now (W-PERF-01, `@/lib/gameTypes`), read synchronously — so this
  // no longer hits the DB. The add-game dialog imports `GAME_TYPES` directly and
  // never calls this; the procedure stays as a thin server-side accessor (tests /
  // any future server caller) returning the SAME code array, contract unchanged.
  listTypes: authedProcedure.query(() => GAME_TYPES),

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
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        courseId: z.string().min(1),
        // The configured tee set (by name). Optional — defaults to the course's
        // first tee. Snapshotted into the schema so display reads the SAME tee.
        teeSetName: z.string().optional(),
      })
    )
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
        .select("hole_count, par, handicap_index, has_stroke_index, tee_sets")
        .eq("id", input.courseId)
        .maybeSingle();
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });

      const holeCount = course.hole_count as number;
      const par = course.par as number[];
      const hasIndex = (course.has_stroke_index as boolean | null) ?? true;

      // Resolve the configured tee: the requested name, else the first tee.
      // Snapshotting the SELECTED tee (not a hardcoded default) is what keeps the
      // displayed yardage honest to what the round was set up with.
      const teeSets = (course.tee_sets as SnapshotTee[] | null) ?? [];
      const selectedTee =
        (input.teeSetName ? teeSets.find((t) => t.name === input.teeSetName) : undefined) ??
        teeSets[0] ??
        null;
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

      // Base scorecard comes from the format definition in code (W-PERF-01) —
      // buildScorecardSchema deep-clones it, so sharing the const is safe.
      const baseSchema = getGameTypeDefinition(game.game_type_id as string)?.scorecardSchema ?? null;
      if (!baseSchema?.units) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Game type has no scorecard schema to snapshot onto.",
        });
      }

      const snapshot = buildScorecardSchema(baseSchema, par, handicapIndex, holeCount, selectedTee);
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

  // clearCourse — Owner/Organizer. The inverse of applyCourse: drop the course
  // (course_id → null) and revert the scorecard_schema snapshot to the game
  // type's template default (no course par/index). FROZEN once scores exist —
  // same boundary as applyCourse (changing par/index after scoring would
  // silently rescore).
  clearCourse: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, game_type_id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

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

      // Revert to the format's CODE-defined base schema (W-PERF-01) — the
      // template default with no course par/index.
      const baseSchema = getGameTypeDefinition(game.game_type_id as string)?.scorecardSchema ?? null;

      const { error } = await ctx.supabase
        .from("games")
        .update({ scorecard_schema: baseSchema, course_id: null })
        .eq("id", input.gameId);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to clear course: ${error.message}`,
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

      // Result strategy comes from the format definition in CODE (W-PERF-01).
      // An unregistered game_type_id (not in the code catalog) is the generalized
      // form of the B2 guard — refuse to compute rather than silently scoring as
      // stroke play. (Before W-PERF-01 the guard caught an unknown result_strategy
      // STRING read from the DB; the code catalog is closed, so "unknown type" is
      // the only way to be unrecognized now.)
      const def = getGameTypeDefinition(game.game_type_id as string);
      if (!def) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unknown game type '${game.game_type_id}' — refusing to compute to avoid silent stroke-play scoring`,
        });
      }
      const strategy = def.resultStrategy;

      // Data-driven branch on the format's result_strategy (CLAUDE.md #8) — new
      // strategies slot in here without touching the rest of finish.
      // null (manual): finish has no placements input — caller must use post.
      let matches: MatchOutcome[] = [];
      let teams: RackTeamOutcome[] = [];
      let standings: StrokeStanding[] = [];
      if (strategy === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Manual games cannot be finalized via finish — use post with a placements array.",
        });
      } else if (strategy === "match_play") {
        matches = await computeMatchPlayResults(ctx.supabase, input.gameId);
      } else if (strategy === "rack_n_stack") {
        teams = await computeRackNStackResults(ctx.supabase, input.gameId);
      } else if (strategy === "stroke_total") {
        standings = await computeStrokePlayResults(ctx.supabase, input.gameId);
      } else {
        // Defense in depth: the union above is exhaustive, so this is unreachable
        // via types — a new ResultStrategy that forgets a branch trips it loudly.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unhandled result_strategy '${strategy as string}' — refusing to compute to avoid silent stroke-play scoring`,
        });
      }

      // status='complete' + corrections_open=false IS the locked state. Clearing
      // corrections_open here is what makes finalize the proper LOCK and lets a
      // re-lock exit score-correction mode (openCorrection → edit → finish).
      // scoring_enabled=true keeps the "a run/posted game is enabled" invariant
      // (Phase 2B.1) so a correction edit passes the score-entry gate.
      const { error } = await ctx.supabase
        .from("games")
        .update({ status: "complete", corrections_open: false, scoring_enabled: true })
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
        // Free-text "rules of the day" (Configuration tab). Owner or delegate.
        rulesForToday: z.string().max(2000).nullable().optional(),
        // Enabled special rules + per-rule config, keyed by modifier (golf
        // SPECIAL RULES). Presence of a key = enabled. Owner or delegate.
        modifiers: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().optional(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.teeTime !== undefined) patch.tee_time = input.teeTime;
      if (input.scheduleItemId !== undefined) patch.schedule_item_id = input.scheduleItemId;
      if (input.competitionFormat !== undefined) patch.competition_format = input.competitionFormat;
      if (input.rulesForToday !== undefined) patch.rules_for_today = input.rulesForToday;
      if (input.modifiers !== undefined) patch.modifiers = input.modifiers;
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

  // enableScoring — Phase 2B.1. Open this game for scoring (the single
  // authoritative flag, every format) AND publish it to the crew. It does NOT
  // set status='active' — the FIRST score owns the flip to Live (#396), so a
  // game can sit "enabled but not yet Live" (the §A full-name + full-color-icon
  // state). Distinct from competition reveal (competitions.status). Config-class
  // → requireGameEdit (owner / organizer / that game's delegate), same as
  // setStatus.
  enableScoring: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("games")
        .update({ scoring_enabled: true, pairings_published_at: new Date().toISOString() })
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to enable scoring: ${error.message}` });
      return { success: true };
    }),

  // disableScoring — Phase 2B.1. Close the game to the crew and return it to
  // setup, KEEPING all scores (never deletes entries). If it was Live (active),
  // revert to pending so it reads not-Live; you continue configuring from here.
  // Re-enabling re-opens it; the next score flips it Live again.
  disableScoring: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games").select("status").eq("id", input.gameId).eq("trip_id", ctx.tripId).maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      const next = game.status === "active" ? "pending" : (game.status as string);
      const { error } = await ctx.supabase
        .from("games")
        .update({ scoring_enabled: false, pairings_published_at: null, status: next })
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to disable scoring: ${error.message}` });
      return { success: true };
    }),

  // setPointsTotal — Owner/Organizer ONLY (the delegation boundary, Stage 3).
  // A game's TOTAL is owner-set; a game-delegate distributes WITHIN it but can't
  // change it. requireTripRole("Organizer") blocks a Member-level delegate
  // outright (a delegate has only a game_delegates grant, not Organizer role).
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

  // delete — Owner/Organizer. HARD-delete a game; all dependent rows
  // (participants, matches, play_groups, results, score_entries, organizers)
  // cascade via ON DELETE CASCADE. Distinct from setStatus('dropped')
  // ("Abandoned"), which is a reversible archive — this is a true removal (L3-b).
  // requireTripRole("Organizer") gates it to trip staff (not a game-delegate).
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games").select("id").eq("id", input.gameId).eq("trip_id", ctx.tripId).maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      const { error } = await ctx.supabase
        .from("games").delete().eq("id", input.gameId).eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to delete game: ${error.message}` });
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

      const count = await writeManualResults(ctx.supabase, input.gameId, input.placements);
      return { success: true, count };
    }),

  // post — RUN action (owner / game-delegate only). Publishes the game's current
  // standing to the leaderboard. NOT "finalize": re-runnable. One action, two
  // sources (Run-Post §2):
  //   - manual game: the poster passes the entered finishing ORDER (placements);
  //     POINTS come from the already-configured points_distribution at read time
  //     (the poster never sets points). Committed via the shared writeManualResults.
  //   - engine game: the result is COMPUTED from entered scores (same branch as
  //     `finish`), writing game_results.
  // Then locks: status='complete', corrections_open=false. The leaderboard
  // recomputes on the next read (competitionPlacement.ts — the single reader);
  // we do NOT recompute locally. Idempotent — re-post just re-commits. Never
  // blocks an incomplete post (the rainout confirm is a UI guard, §4).
  post: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        placements: z
          .array(z.object({ entityId: z.string().min(1), position: z.number().int().min(1).max(99) }))
          .max(64)
          .optional(),
      })
    )
    .use(requireGameRunAction())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, game_type_id")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

      // Result strategy from the format definition in CODE (W-PERF-01); an
      // unregistered type loud-fails (the generalized B2 guard — see finish).
      const def = getGameTypeDefinition(game.game_type_id as string);
      if (!def) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unknown game type '${game.game_type_id}' — refusing to compute to avoid silent stroke-play scoring`,
        });
      }
      const strategy = def.resultStrategy;

      if (strategy === null) {
        // Manual: commit the entered finishing order (shared write path).
        if (!input.placements) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A manual game posts a finishing order." });
        }
        await writeManualResults(ctx.supabase, input.gameId, input.placements);
      } else if (strategy === "match_play") {
        await computeMatchPlayResults(ctx.supabase, input.gameId);
      } else if (strategy === "rack_n_stack") {
        await computeRackNStackResults(ctx.supabase, input.gameId);
      } else if (strategy === "stroke_total") {
        await computeStrokePlayResults(ctx.supabase, input.gameId);
      } else {
        // Defense in depth: union is exhaustive, unreachable via types.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unhandled result_strategy '${strategy as string}' — refusing to compute to avoid silent stroke-play scoring`,
        });
      }

      const { error } = await ctx.supabase
        .from("games")
        // scoring_enabled=true keeps the "a run/posted game is enabled" invariant
        // (Phase 2B.1) so a correction edit passes the score-entry gate.
        .update({ status: "complete", corrections_open: false, scoring_enabled: true })
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to post game: ${error.message}` });
      return { success: true };
    }),

  // openCorrection — RUN action (owner / game-delegate only). Enters score-
  // correction on a POSTED game: re-opens score entry (the scores router gates on
  // status='complete' && !corrections_open) WITHOUT un-posting — the result stays
  // visible on the board until Re-post (`post` again). A deliberate enter→re-post
  // cycle, never a silent edit (§3).
  openCorrection: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireGameRunAction())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("status")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      if (game.status !== "complete") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a posted game can enter score correction." });
      }
      const { error } = await ctx.supabase
        .from("games")
        .update({ corrections_open: true })
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to open correction: ${error.message}` });
      return { success: true };
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
        .from("game_delegates")
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
        .from("game_delegates")
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
        .from("game_delegates")
        .select("user_id, granted_by, created_at")
        .eq("game_id", input.gameId);
      return data ?? [];
    }),

  // myDelegateGameIds — the games the CURRENT user is a delegated organizer of
  // (§10). Powers the leaderboard's "you're running this" marking: the board
  // intersects this set with the games it shows, so a delegate sees their games
  // flagged on the same normal board everyone sees (no filtered view). Returns
  // ids only; RLS already limits rows to games in trips the user can read.
  myDelegateGameIds: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data } = await ctx.supabase
        .from("game_delegates")
        .select("game_id")
        .eq("user_id", ctx.user!.id);
      return (data ?? []).map((r) => r.game_id as string);
    }),
});
