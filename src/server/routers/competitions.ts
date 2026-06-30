import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole, requireCompetitionRole } from "../middleware";
import { computeCompetitionLeaderboard } from "../lib/competitionLeaderboard";

const SCOREBOARD_STYLES = [
  "grid",
  "leaderboard",
  "heatmap",
  "cards",
  "bars",
  "podium",
  "stadium",
  "minimal",
] as const;

/**
 * competitions — top-level container per trip.
 *
 * MVP rule: one competition per trip, enforced in this router (the schema
 * allows multiple to leave the door open for future series-style usage).
 */
export const competitionsRouter = router({
  // -----------------------------------------------------------------------
  // getByTrip — return the trip's competition (or null)
  // -----------------------------------------------------------------------
  getByTrip: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from("competitions")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch competition: ${error.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // leaderboard — the derived roll-up (D1 §5/§6): points-available, per-team
  // totals, the win number, points-to-clinch. Renders from Phase-1 fields alone
  // (distribution + order) and recomputes from the LIVE game set every read, so
  // dropping/restoring a game moves the win number. Any trip member can view it.
  // -----------------------------------------------------------------------
  leaderboard: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx, input }) => computeCompetitionLeaderboard(ctx.supabase, input.competitionId)),

  // -----------------------------------------------------------------------
  // faceBootstrap — the competition face's single boundary resolve (Stage A).
  //
  // ONE round-trip that returns everything BOTH face states need: the shared
  // base (competition + teams + games + assignments) plus the leaderboard
  // roll-up (board) and the raw games rows the setup guide reads for per-game
  // config status. Collapses the old 3-wave client waterfall into one parallel
  // fetch, and serves both states so flipping setup↔leaderboard never re-fetches.
  //
  // It is the ONE place trip-coupling lives: the viewer's competition role is
  // live-derived from THIS request's trip role (resolved fresh by
  // requireTripMember — no cross-request cache, so demoting an organizer revokes
  // co-admin on the next load). Standalone later swaps only this resolve.
  //
  // Shapes match the individual procedures (getByTrip / teams.list /
  // teamAssignments.list / games.listByTrip / myDelegateGameIds / leaderboard)
  // so the client can seed those caches from one call.
  // -----------------------------------------------------------------------
  faceBootstrap: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const tripId = ctx.tripId;
      const myCompetitionRole =
        ctx.tripRole === "Owner"
          ? "owner"
          : ctx.tripRole === "Organizer"
            ? "co_admin"
            : "member";

      const { data: competition } = await ctx.supabase
        .from("competitions")
        .select("*")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!competition) {
        // Clean no-competition state — the face renders the enable/empty state.
        return {
          competition: null,
          myCompetitionRole,
          myDelegateGameIds: [] as string[],
          teams: [] as unknown[],
          assignments: [] as unknown[],
          games: [] as unknown[],
          leaderboard: null,
        };
      }
      const competitionId = competition.id as string;

      // All independent — one round-trip, parallel DB work. `leaderboard` is the
      // SAME compute competitions.leaderboard runs (parallelized internally), so
      // its shape matches for cache-seeding.
      const [teams, assignments, games, myDelegateGameIds, leaderboard] =
        await Promise.all([
          ctx.supabase
            .from("teams")
            .select("*")
            .eq("competition_id", competitionId)
            .order("created_at", { ascending: true })
            .then((r) => r.data ?? []),
          ctx.supabase
            .from("team_assignments")
            .select("*")
            .eq("competition_id", competitionId)
            .then((r) => r.data ?? []),
          ctx.supabase
            .from("games")
            .select("*")
            .eq("trip_id", tripId)
            .order("created_at", { ascending: false })
            .then((r) => r.data ?? []),
          ctx.supabase
            .from("game_delegates")
            .select("game_id")
            .eq("user_id", ctx.user!.id)
            .then((r) => (r.data ?? []).map((x) => x.game_id as string)),
          computeCompetitionLeaderboard(ctx.supabase, competitionId),
        ]);

      return {
        competition,
        myCompetitionRole,
        myDelegateGameIds,
        teams,
        assignments,
        games,
        leaderboard,
      };
    }),

  // -----------------------------------------------------------------------
  // teamAssignmentCounts — per-team member headcount for this competition.
  // Used by GameSheet to project per_match total before pairings exist:
  // projected cap = min(...counts), projected total = value × cap.
  // -----------------------------------------------------------------------
  teamAssignmentCounts: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data } = await ctx.supabase
        .from("team_assignments")
        .select("team_id")
        .eq("competition_id", input.competitionId);
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        const tid = r.team_id as string;
        counts[tid] = (counts[tid] ?? 0) + 1;
      }
      return counts;
    }),

  // -----------------------------------------------------------------------
  // create — new competition for a trip (canEdit, MVP one-per-trip)
  //
  // `scoringModel` is the SHAPE chooser's decision, written at creation and
  // FROZEN thereafter (no update path writes it — delete-and-restart to change
  // shape). It is the only source for a distinction team count cannot supply
  // (a 2-team competition can be points-based):
  //   match_play — head-to-head (win/halve/lose); locked at 2 teams.
  //   points     — points-per-finish; 2–N teams (add more after creation).
  // Both seed 2 placeholder teams; the difference is the post-create add-team
  // affordance (gated on scoring_model in the UI), not the seed.
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        name: z.string().min(2).max(200),
        tagline: z.string().max(500).optional(),
        scoringModel: z.enum(["match_play", "points"]).default("match_play"),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // MVP: only one competition per trip. The DB schema allows N for
      // future-proofing (e.g. seasonal series), but the UI is built for 1.
      const { data: existing } = await ctx.supabase
        .from("competitions")
        .select("id")
        .eq("trip_id", ctx.tripId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A competition already exists for this trip",
        });
      }

      // RLS INSERT RETURNING split — see CLAUDE.md
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from("competitions")
        .insert({
          trip_id: ctx.tripId,
          name: input.name,
          tagline: input.tagline ?? null,
          scoring_model: input.scoringModel,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create competition: ${insertErr?.message}`,
        });
      }

      // Seed two placeholder teams so the bones board's team hero renders
      // immediately ("Team A / Team B · 0–0"). Teams up front, rosters not — the
      // team_assignments are built later in the Team Rosters page. Best-effort:
      // a seed failure doesn't block creation (the team builder can still add
      // teams), so the competition is usable either way.
      await ctx.supabase.from("teams").insert([
        { competition_id: inserted.id, name: "Team A", short_name: "A", color: "#3b82f6", color_dim: "#0a1a2a" },
        { competition_id: inserted.id, name: "Team B", short_name: "B", color: "#ef4444", color_dim: "#2a0a0a" },
      ]);

      const { data, error } = await ctx.supabase
        .from("competitions")
        .select("*")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created competition: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — edit metadata (owner/co-admin).
  //
  // The `status` (go-live) write path was REMOVED with the GO LIVE control
  // (option A): a competition is visible the moment it exists, so there is no
  // setup↔active toggle to drive. The `competitions.status` column is retained
  // (no live reader/writer of the distinction remains; a future `completed`
  // state may reuse it) but is intentionally NOT writable here — do not re-add a
  // competition-level reveal/go-live mutation.
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        name: z.string().min(2).max(200).optional(),
        tagline: z.string().max(500).nullable().optional(),
        scoreboardStyle: z.enum(SCOREBOARD_STYLES).optional(),
        // The roster-setup progression (building → saved → dismissed). "Save
        // rosters" advances to saved; dismissing the moved-to-Settings signpost
        // advances to dismissed. One-way, but the server stays permissive (the
        // check constraint guards the value set).
        rosterSetup: z.enum(["building", "saved", "dismissed"]).optional(),
      })
    )
    .use(requireCompetitionRole("co_admin"))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.tagline !== undefined) patch.tagline = input.tagline;
      if (input.scoreboardStyle !== undefined) patch.scoreboard_style = input.scoreboardStyle;
      if (input.rosterSetup !== undefined) patch.roster_setup = input.rosterSetup;

      const { data, error } = await ctx.supabase
        .from("competitions")
        .update(patch)
        .eq("id", input.competitionId)
        .eq("trip_id", ctx.tripId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update competition: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove a competition. DESTRUCTIVE → competition owner only
  // (co-admins are owner-minus-destructive).
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireCompetitionRole("owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("competitions")
        .delete()
        .eq("id", input.competitionId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete competition: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // resetScoring — owner-only. Clears every game's RESULTS back to unscored;
  // keeps full config (pairings, course, points, handicaps) + identity. Games are
  // immediately re-scoreable. Delegates to the transactional plpgsql primitive
  // (migration 063) — all-or-nothing per competition. The danger-zone ladder's
  // first rung (below it: resetToSkeleton; below that: delete).
  resetScoring: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireCompetitionRole("owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("reset_competition_scoring", {
        p_trip_id: input.tripId,
        p_competition_id: input.competitionId,
      });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reset scoring: ${error.message}`,
        });
      }
      return { success: true };
    }),

  // resetToSkeleton — owner-only. SUPERSET of resetScoring: the SQL primitive
  // CALLS reset_competition_scoring first, then additionally clears config back
  // to unconfigured shells (keeps teams + game shells + point values). Used for
  // "set up wrong, redo" and cleaning a competition's test games. Also the op the
  // future scoring_model-change path will call (pre-score model switch).
  resetToSkeleton: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireCompetitionRole("owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("reset_competition_to_skeleton", {
        p_trip_id: input.tripId,
        p_competition_id: input.competitionId,
      });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reset to skeleton: ${error.message}`,
        });
      }
      return { success: true };
    }),
});
