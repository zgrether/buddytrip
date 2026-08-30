import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole, requireCompetitionRole } from "../middleware";
import { computeCompetitionLeaderboard } from "../lib/competitionLeaderboard";
import { reconcileClinchClaim } from "../lib/gameFinishNotify";
import { viewerTeamForTrip } from "../lib/viewerTeam";
import { myDelegateGameIds as computeMyDelegateGameIds } from "../lib/myDelegateGameIds";
import { SEED_TEAM_COLORS, MAX_SEED_TEAMS, seedTeamName } from "@/lib/teamColors";

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
  /**
   * myTeamColor — the VIEWER's team identity for this trip, or null.
   *
   * Feeds the account avatar in the app bar, which reads in the user's team
   * colour instead of the default teal once they are on a team. Deliberately
   * trip-scoped rather than competition-scoped: the avatar lives on the shared
   * `TopNav` across Home · Trip · Cup · Chat, and the caller has a trip id in
   * hand at every one of those, not a competition id.
   *
   * ── Why its own procedure and not a field on `trips.getById` ──────────────
   * The avatar has TWO hosts with different trip sources: `/trips/[tripId]`
   * (which does call `trips.getById`) and `/dashboard`, whose Home tab knows the
   * current trip only as `remoteTripId` and fetches `trips.list`. Putting the
   * answer on `getById` would cover one host; putting it on `list` would mean a
   * competition + assignment lookup PER ROW of the trip list. One small
   * trip-keyed query serves both hosts and is precise to invalidate when a
   * roster or a team colour changes.
   *
   * Returns null — not an error — for the ordinary cases: the trip has no
   * competition, or the viewer simply isn't on a team. Those are the default
   * state for most trips, and the avatar falls back to teal.
   */
  myTeamColor: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      // Same "the trip's competition" rule as getByTrip — earliest created wins
      // under the one-competition-per-trip MVP rule. Kept identical on purpose:
      // an avatar reading a different competition than the Cup tab would be a
      // silent inconsistency nobody would think to check.
      //
      // That "kept identical on purpose" is now MECHANICAL rather than
      // observed: the rule moved to `viewerTeamForTrip` and team chat reads the
      // same function, because a third hand-copy is exactly how the
      // inconsistency this comment warns about arrives.
      const team = await viewerTeamForTrip(ctx.supabase, ctx.tripId!, ctx.user!.id);
      if (!team) return null;

      // Return shape unchanged — `teamVisibleFrom` is team chat's business and
      // no caller of this procedure has any use for it.
      return {
        teamId: team.teamId,
        teamName: team.teamName,
        color: team.color,
        colorDim: team.colorDim,
      };
    }),

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
      // its shape matches for cache-seeding. `myDelegateGameIds` is the SAME
      // helper `games.myDelegateGameIds` calls (server/lib/myDelegateGameIds) —
      // must stay identical, since this payload seeds that query's cache
      // (LiveFaceClient.tsx) and a drifting second implementation would desync
      // the two the moment one of them changed.
      const [teams, assignments, games, myDelegateGameIds, leaderboard] =
        await Promise.all([
          ctx.supabase
            .from("teams")
            .select("*")
            .eq("competition_id", competitionId)
            .order("created_at", { ascending: true })
            .then((r) => r.data ?? []),
          // ORDERING IS LOAD-BEARING — must match `listTeamAssignments`
          // (teamAssignments.ts) exactly. This payload SEEDS the
          // `teamAssignments.list` cache (LiveFaceClient.tsx), so the same query
          // key must hold identically-ordered rows whether it was fetched
          // directly or seeded from here — consumers that trust array position
          // (RackGameView's roster order + group-builder pool) can't tell which
          // writer produced their rows.
          //
          // This `.order()` was MISSING here while the procedure had it. That was
          // a latent contract violation, not an actively-firing bug: measured on
          // the local stack, the planner serves the unordered form via
          // `team_assignments_team_sort_idx` (competition_id, team_id, sort_order),
          // whose index order happens to BE the canonical order — but only while
          // the competition_id filter stays selective enough to pick that index.
          // A seq scan (few competitions relative to table size — verified: 400
          // rows in one competition plans as Seq Scan) returns heap order instead,
          // and heap order diverges from canonical after any single-row rewrite
          // (e.g. setCaptain following a reorder — verified in SQL). Making the
          // ordering explicit removes the dependency on a plan choice.
          // `facebootstrap.ordering.test.ts` pins the two paths together.
          ctx.supabase
            .from("team_assignments")
            .select("*")
            .eq("competition_id", competitionId)
            .order("team_id", { ascending: true })
            .order("sort_order", { ascending: true })
            .then((r) => r.data ?? []),
          ctx.supabase
            .from("games")
            .select("*")
            .eq("trip_id", tripId)
            .order("created_at", { ascending: false })
            .then((r) => r.data ?? []),
          computeMyDelegateGameIds(ctx.supabase, tripId, ctx.user!.id, ctx.tripRole === "Owner"),
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
        // How many default teams to seed (points shape; the create picker, §1). Match-play
        // is locked at 2. Clamped 2..MAX so a bad client can't over-seed.
        teamCount: z.number().int().min(2).max(MAX_SEED_TEAMS).default(2),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // MVP: only one competition per trip. The DB schema allows N for
      // future-proofing (e.g. seasonal series), but the UI is built for 1.
      //
      // ── TEAM CHAT DEPENDS ON THIS GUARD ───────────────────────────────────
      // Read this before relaxing it. There is no UNIQUE(competitions.trip_id)
      // behind it — deliberately, so the seasonal series above stays possible —
      // which makes this `if` the only thing holding the invariant.
      //
      // "Your team" has to name exactly one team for the Team chat tab to be
      // unambiguous (`src/server/lib/viewerTeam.ts`, and it says the same thing
      // from the other end). With two competitions in a trip, one person can
      // hold two assignments, `viewerTeamForTrip` silently picks the earliest
      // competition's, and the Team tab shows one team's private chat while the
      // Cup tab shows the other. The RLS policy stays correct throughout — it
      // gates per team — so nothing errors and nothing leaks; the tab just
      // quietly names the wrong room.
      //
      // Relaxing this therefore means deciding what the Team tab becomes: a
      // picker over several team chats, or a tab that names which team. That is
      // a feature, not a follow-up — see the team-chat work for why it was
      // scoped out (prod had 0 trips with two competitions when it was built).
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

      // Seed N default-named teams (§1: the create picker drives the count; match-play is
      // locked at 2) so the board's team hero renders immediately. Names/colors come from
      // the shared palette (Team A/B/C/D…, renameable later in the team editor). Rosters are
      // built later in the Team Rosters page. Best-effort: a seed failure doesn't block
      // creation (the team builder can still add teams), so the competition is usable either way.
      const teamCount = input.scoringModel === "match_play" ? 2 : input.teamCount;
      await ctx.supabase.from("teams").insert(
        Array.from({ length: teamCount }, (_, i) => {
          const { name, shortName } = seedTeamName(i);
          const swatch = SEED_TEAM_COLORS[i] ?? SEED_TEAM_COLORS[SEED_TEAM_COLORS.length - 1];
          return { competition_id: inserted.id, name, short_name: shortName, color: swatch.color, color_dim: swatch.colorDim };
        }),
      );

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
        // Short label for the bottom-nav tab (empty string clears it → null).
        shortName: z.string().max(40).nullable().optional(),
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
      if (input.shortName !== undefined) patch.short_name = input.shortName;
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
      // Cascade-delete (Phase 1): remove the competition AND its games (the new
      // default), atomically and in the load-bearing order (games-by-competition
      // FIRST so they're deleted rather than SET NULL-detached, then the
      // competition — CASCADEs teams + assignments), via the plpgsql primitive.
      // `p_delete_games: true` is the near-term default; the deferred "keep games"
      // branch (false → games detach) is gated on the future orphan-display UI.
      // Owner gate unchanged: requireCompetitionRole('owner') here + the RPC's own
      // assert_competition_owner (defence-in-depth against a direct PostgREST call).
      const { error } = await ctx.supabase.rpc("delete_competition_cascade", {
        p_trip_id: ctx.tripId,
        p_competition_id: input.competitionId,
        p_delete_games: true,
      });

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
      // Clears every game's results at once — can only lower totals, never
      // raise pointsAvailable (config/points survive), so this is un-clinch or
      // no-op, never a fresh clinch. Same reconcile-only helper as the other
      // paths regardless, rather than a special-cased unconditional clear.
      await reconcileClinchClaim(input.competitionId);
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
      // Same reasoning as resetScoring — points survive, so this can't create
      // a clinch, only remove or leave one.
      await reconcileClinchClaim(input.competitionId);
      return { success: true };
    }),
});
