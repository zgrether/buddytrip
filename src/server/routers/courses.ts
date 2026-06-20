import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { validateStrokeIndex } from "@/lib/courseIndex";

/**
 * courses — the GLOBAL course library (Slice C part 2, §5). Course par + stroke
 * index + per-tee yards are global facts (not circle-scoped), so any member can
 * read the whole library and add to it. Looked-up and hand-built courses persist
 * identically here; applying a course to a game is `games.applyCourse` (the
 * snapshot write — separate, because it mutates a trip-scoped game).
 *
 * The stroke index is re-validated server-side as a complete permutation of
 * 1..holeCount — the client enforces it via swap-on-edit, but a course can never
 * be saved with a broken index regardless of the caller (§3).
 */

// The full per-tee record (mig 059). Ratings are optional + nullable —
// golfcourseapi supplies them; manual entry leaves them out (par + stroke index
// alone still score). Stored verbatim in courses.tee_sets (jsonb).
// golfcourseapi.com free tier: 50 requests/day, keyed to 0000 UTC. The counter
// is provider-scoped so a future second provider gets its own row + cap.
const GOLF_API_PROVIDER = "golfcourseapi";
const GOLF_API_DAILY_LIMIT = 50;

const teeSetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  courseRating: z.number().positive().max(99).nullable().optional(),
  slopeRating: z.number().int().min(55).max(155).nullable().optional(),
  bogeyRating: z.number().positive().max(99).nullable().optional(),
  yards: z.array(z.number().int().positive().nullable()).optional(),
});

export const coursesRouter = router({
  // create — save a looked-up or hand-built course to the global library.
  create: authedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        location: z.string().trim().max(200).optional(),
        holeCount: z.union([z.literal(9), z.literal(18)]),
        par: z.array(z.number().int().min(3).max(7)),
        handicapIndex: z.array(z.number().int().min(1)).optional(),
        hasStrokeIndex: z.boolean().optional(),
        teeSets: z.array(teeSetSchema).max(12).optional(),
        source: z.enum(["manual", "golfcourseapi"]).optional(),
        providerId: z.string().max(120).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const n = input.holeCount;
      const hasIndex = input.hasStrokeIndex ?? true;
      if (input.par.length !== n) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `par must have ${n} entries` });
      }
      // Permutation gate — only when the course HAS an index; never persist a
      // broken one. Index-off courses store an empty index (net unavailable).
      if (hasIndex) {
        if ((input.handicapIndex ?? []).length !== n) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `handicapIndex must have ${n} entries` });
        }
        if (!validateStrokeIndex(input.handicapIndex!, n).valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Stroke index must be a complete permutation of 1..N (no gaps or duplicates)",
          });
        }
      }

      const id = crypto.randomUUID();
      const { error: insertErr } = await ctx.supabase.from("courses").insert({
        id,
        name: input.name,
        location: input.location ?? null,
        hole_count: n,
        par: input.par,
        handicap_index: hasIndex ? input.handicapIndex : [],
        has_stroke_index: hasIndex,
        tee_sets: input.teeSets ?? [],
        source: input.source ?? "manual",
        provider_id: input.providerId ?? null,
        created_by: ctx.user!.id,
      });
      if (insertErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save course: ${insertErr.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("courses")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read saved course: ${error?.message}`,
        });
      }
      return data;
    }),

  // search — LOCAL typeahead against the global library (name ILIKE). This is
  // the free, always-on first stage of the two-stage picker: keystroke search
  // hits THIS, never golfcourseapi, so it's unaffected by the daily API cap.
  // The explicit "Search the full database" control is the only API path.
  search: authedProcedure
    .input(
      z.object({
        q: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(20).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Escape LIKE wildcards in user input so a literal % / _ doesn't widen the
      // match (defense — course names with these are rare but possible).
      const term = input.q.replace(/[\\%_]/g, "\\$&");
      const { data, error } = await ctx.supabase
        .from("courses")
        .select("*")
        .ilike("name", `%${term}%`)
        .order("created_at", { ascending: false })
        .limit(input.limit ?? 10);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to search courses: ${error.message}`,
        });
      }
      return data ?? [];
    }),

  // apiUsage — today's golfcourseapi call count (UTC), for the picker to gate the
  // "Search the full database" control. Read-only; never increments.
  apiUsage: authedProcedure.query(async ({ ctx }) => {
    const today = new Date().toISOString().slice(0, 10); // UTC day (matches the DB key)
    const { data } = await ctx.supabase
      .from("api_usage_daily")
      .select("count")
      .eq("provider", GOLF_API_PROVIDER)
      .eq("usage_date", today)
      .maybeSingle();
    const count = (data?.count as number | undefined) ?? 0;
    return { count, limit: GOLF_API_DAILY_LIMIT, atCap: count >= GOLF_API_DAILY_LIMIT };
  }),

  // recordApiCall — atomic check-and-increment before an actual golfcourseapi
  // call (search or import). Returns permitted=false (without incrementing) when
  // already at the daily cap, so the caller must NOT fire the API. The atomicity
  // (a single DB function) is what makes "check before calling" race-safe.
  recordApiCall: authedProcedure.mutation(async ({ ctx }) => {
    const { data, error } = await ctx.supabase.rpc("record_api_call", {
      p_provider: GOLF_API_PROVIDER,
      p_limit: GOLF_API_DAILY_LIMIT,
    });
    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to record API usage: ${error.message}`,
      });
    }
    const newCount = data as number; // new count, or -1 when already at cap
    const permitted = newCount >= 0;
    return {
      permitted,
      count: permitted ? newCount : GOLF_API_DAILY_LIMIT,
      atCap: !permitted,
    };
  }),

  // list — recent courses for the empty-search "Recent courses" list (§2/§5).
  // Global most-recent, not per-circle.
  list: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("courses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(input?.limit ?? 20);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list courses: ${error.message}`,
        });
      }
      return data ?? [];
    }),

  // getById — fetch a single library course.
  getById: authedProcedure
    .input(z.object({ courseId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("courses")
        .select("*")
        .eq("id", input.courseId)
        .maybeSingle();
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch course: ${error.message}`,
        });
      }
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      return data;
    }),
});
