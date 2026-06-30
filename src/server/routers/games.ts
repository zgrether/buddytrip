import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole, requireGameEdit, requireGameRunAction, canEditGame } from "../middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStrokePlayResults } from "../lib/strokePlay";
import { computeMatchPlayResults } from "../lib/matchPlay";
import { computeRackNStackResults } from "../lib/rackNStack";
import type { MatchOutcome } from "../lib/matchPlay";
import type { RackTeamOutcome } from "../lib/rackNStack";
import type { StrokeStanding } from "@/lib/strokePlay";
import { buildScorecardSchema, composeTwoNines, validateStrokeIndex, type SnapshotTee, type ScorecardSchema } from "@/lib/courseIndex";
import { validatePlacement } from "@/lib/gameConfig";
import { GAME_TYPES, getGameTypeDefinition } from "@/lib/gameTypes";
import { assertGameReady } from "../lib/gameReadiness";

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

      // A2-core access gate: a SETUP-mode (pending) game is members-walled — the
      // game row stays readable (the existence shell the placeholder needs: name /
      // type / status), but the ROSTER (a child) is withheld unless the caller can
      // edit the game (owner / organizer / this game's delegate). Scores, matches,
      // and foursomes are the other children, gated in their own reads + by RLS.
      const hideSetup =
        (game.status as string) === "pending" && !(await canEditGame(ctx, ctx.tripId, input.gameId));

      const participants = hideSetup
        ? []
        : (
            await ctx.supabase
              .from("game_participants")
              .select("*")
              .eq("game_id", input.gameId)
              .order("created_at", { ascending: true })
          ).data ?? [];

      return { ...game, participants };
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
      // Applying a (fresh) front course resets any prior two-nines back ref — a
      // 9-hole course lands as a lone front "needs a back nine" until setBackNine.
      const { error } = await ctx.supabase
        .from("games")
        .update({ scorecard_schema: snapshot, course_id: input.courseId, back_course_id: null })
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
        .update({ scorecard_schema: baseSchema, course_id: null, back_course_id: null })
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

  // setBackNine — compose (or SWAP) the BACK nine of a retained two-nines 18
  // (W-9HOLE-01). The FRONT (course_id) must be a 9-hole course; its frozen 9 is
  // read from the existing snapshot (provenance: the front never changes on a
  // back swap). The back is a 9-hole course supplied here. The two nines compose
  // into an 18 (interleaved stroke index) snapshotted onto the game.
  //
  // Unlike applyCourse, this does NOT freeze on front scores — a back swap is a
  // legitimate day-of move. It CLEARS only holes 10-18 (the back's scores belong
  // to the old nine), leaving holes 1-9 (front) + their scores untouched. Net and
  // back-nine handicap allocation re-derive on read from the new index for free.
  setBackNine: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string(), backCourseId: z.string().min(1), backTeeSetName: z.string().optional() }))
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, game_type_id, course_id, back_course_id, scorecard_schema")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      if (!game.course_id) throw new TRPCError({ code: "BAD_REQUEST", message: "Set a front nine first." });

      const schema = game.scorecard_schema as ScorecardSchema | null;
      const frontMeta = schema?.units?.metadata;
      const frontCount = schema?.units?.count ?? frontMeta?.par?.length ?? 0;
      // Only a two-nines game gets a back: a 9-hole front (count 9) composing its
      // first back, or an already-composed 18 (count 18 + a back ref) swapping it.
      // A real 18-hole course (count 18, no back ref) is rejected.
      if (!frontMeta?.par?.length || (frontCount === 18 && !game.back_course_id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This isn't a 9-hole front — it doesn't take a back nine." });
      }

      const { data: back } = await ctx.supabase
        .from("courses")
        .select("hole_count, par, handicap_index, has_stroke_index, tee_sets")
        .eq("id", input.backCourseId)
        .maybeSingle();
      if (!back) throw new TRPCError({ code: "NOT_FOUND", message: "Back-nine course not found" });
      if ((back.hole_count as number) !== 9) throw new TRPCError({ code: "BAD_REQUEST", message: "The back nine must be a 9-hole course." });
      const backHasIndex = ((back.has_stroke_index as boolean | null) ?? true) && Array.isArray(back.handicap_index);
      if (backHasIndex && !validateStrokeIndex(back.handicap_index as number[], 9).valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Back-nine stroke index is not a valid permutation." });
      }

      const backTees = (back.tee_sets as SnapshotTee[] | null) ?? [];
      // Back-nine tee INHERITS the front's tee (W-GAMEPAGE-01 pin #3): match the
      // front's applied tee NAME on the back course so the back-9 yardages come
      // from the same-named tee; fall back to the back's first tee when that name
      // is absent (the UI surfaces the fallback). An explicit backTeeSetName (a
      // deliberate override) still wins. The composed tee NAME stays the front's
      // (see composedTee below) regardless — this only picks the back-9 yards.
      const frontTeeName = frontMeta.tee?.name?.trim();
      const backTee =
        (input.backTeeSetName ? backTees.find((t) => t.name === input.backTeeSetName) : undefined) ??
        (frontTeeName ? backTees.find((t) => (t.name ?? "").trim() === frontTeeName) : undefined) ??
        backTees[0] ?? null;

      // Recover the FRONT nine's ORIGINAL 1..9 data from the snapshot. On the
      // first compose the schema IS a 9-hole front (index already 1..9). On a
      // SWAP the schema is the previously-composed 18, whose first 9 stroke-index
      // values are the INTERLEAVED odd ranks (2·s−1) — de-interleave them back to
      // 1..9 (`(v+1)/2`) so composeTwoNines re-interleaves correctly against the
      // new back. (par/yards just slice; only the index is interleaved.)
      const frontIdx9: number[] | null = frontMeta.handicap_index?.length
        ? (frontCount === 18
            ? frontMeta.handicap_index.slice(0, 9).map((v) => (v + 1) / 2)
            : frontMeta.handicap_index.slice(0, 9))
        : null;
      const composed = composeTwoNines(
        { par: frontMeta.par.slice(0, 9), index: frontIdx9, yards: frontMeta.tee?.yards?.slice(0, 9) ?? null },
        { par: back.par as number[], index: backHasIndex ? (back.handicap_index as number[]) : null, yards: backTee?.yards ?? null }
      );
      const composedTee: SnapshotTee | null = frontMeta.tee
        ? { ...frontMeta.tee, yards: composed.yards }
        : (backTee ? { ...backTee, yards: composed.yards } : null);

      const baseSchema = getGameTypeDefinition(game.game_type_id as string)?.scorecardSchema ?? null;
      if (!baseSchema?.units) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Game type has no scorecard schema." });
      // P-F0a: record the back nine's CHOSEN tee name (the composed tee carries the
      // FRONT's name) so the §16 split-band header can label the back band honestly.
      // Capture-only — `backTee` selection / yardages above are unchanged.
      const snapshot = buildScorecardSchema(baseSchema, composed.par, composed.index, 18, composedTee, backTee?.name ?? null);

      // Clear the BACK nine's scores (holes 10-18) — they were the old nine's. The
      // front (1-9) is left intact. (A no-op on the first compose.)
      await ctx.supabase
        .from("score_entries")
        .delete()
        .eq("game_id", input.gameId)
        .in("unit_label", ["10", "11", "12", "13", "14", "15", "16", "17", "18"]);

      const { error } = await ctx.supabase
        .from("games")
        .update({ scorecard_schema: snapshot, back_course_id: input.backCourseId })
        .eq("id", input.gameId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set back nine: ${error.message}` });

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

  // setStatus — game-edit-gated status setter over the lifecycle states (pending /
  // active / complete). (No `dropped`: the abandon/drop concept was removed at the
  // source — #512 §6a — and must not be re-added.)
  setStatus: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        status: z.enum(["pending", "active", "complete"]),
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
      // A2-core: the mode toggle OWNS status — Setup→Scoring sets status:'active'
      // (no longer "first score owns Live"). Server readiness guard refuses an
      // under-configured flip (all formats), and publishes pairings.
      await assertGameReady(ctx.supabase, input.gameId);
      const { error } = await ctx.supabase
        .from("games")
        .update({ scoring_enabled: true, status: "active", pairings_published_at: new Date().toISOString() })
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
      // A2-core round-trip fix: enable flipped match rows pending→active; revert the
      // active ones back to pending so Scoring→Setup→Scoring is a clean round-trip.
      // (`complete`/frozen match rows are left alone; scores are never touched.)
      if (next === "pending") {
        await ctx.supabase
          .from("game_matches")
          .update({ status: "pending" })
          .eq("game_id", input.gameId)
          .eq("status", "active");
      }
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
  // cascade via ON DELETE CASCADE. A true removal (L3-b) — the danger-zone Delete.
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

  // resetScoring — owner-only, ONE game. Clears this game's RESULTS back to
  // unscored; keeps config + identity (incl. its per-match point value). The
  // per-game rung of the danger-zone ladder (below it: resetToSkeleton; below
  // that: delete) — the level-down sibling of competitions.resetScoring (#442).
  // Delegates to the transactional plpgsql primitive (migration 066); the SQL
  // wrapper re-asserts owner on the game's REAL trip (authoritative), so this
  // can't be spoofed by passing a trip you own + a foreign gameId.
  resetScoring: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("reset_game_scoring", {
        p_game_id: input.gameId,
      });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reset game scoring: ${error.message}`,
        });
      }
      return { success: true };
    }),

  // resetToSkeleton — owner-only, ONE game. SUPERSET of resetScoring: the SQL
  // primitive clears scoring then additionally clears config back to an
  // unconfigured shell (keeps identity + the per-match point value, §E-1).
  // The level-down sibling of competitions.resetToSkeleton.
  resetToSkeleton: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("reset_game_to_skeleton", {
        p_game_id: input.gameId,
      });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reset game to skeleton: ${error.message}`,
        });
      }
      return { success: true };
    }),
});
