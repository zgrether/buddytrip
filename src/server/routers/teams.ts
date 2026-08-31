import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireCompetitionRole, requireTeamIdentityEdit } from "../middleware";
import { assertRosterUnlocked } from "../lib/rosterLock";
import { reconcileClinchClaim } from "../lib/gameFinishNotify";
import { TEAM_NAME_MAX, TEAM_SHORT_MAX } from "@/lib/teamNameLimits";

/**
 * teams — competition-scoped teams.
 * The competition_id ties teams to a trip via the competitions row.
 */

/** Shared between teams.list and competitions.hydrate. */
export async function listTeams(
  ctx: { supabase: SupabaseClient },
  competitionId: string,
) {
  const { data, error } = await ctx.supabase
    .from("teams")
    .select("*")
    .eq("competition_id", competitionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch teams: ${error.message}`,
    });
  }
  return data ?? [];
}

export const teamsRouter = router({
  // -----------------------------------------------------------------------
  // list — all teams for a competition
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx, input }) => listTeams(ctx, input.competitionId)),

  // -----------------------------------------------------------------------
  // create — new team (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        name: z.string().min(1).max(TEAM_NAME_MAX),
        shortName: z.string().min(1).max(TEAM_SHORT_MAX),
        color: z.string().min(1).max(20),
        colorDim: z.string().min(1).max(20),
      })
    )
    .use(requireCompetitionRole("co_admin"))
    .mutation(async ({ ctx, input }) => {
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from("teams")
        .insert({
          competition_id: input.competitionId,
          name: input.name,
          short_name: input.shortName,
          color: input.color,
          color_dim: input.colorDim,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create team: ${insertErr?.message}`,
        });
      }

      const { data, error } = await ctx.supabase
        .from("teams")
        .select("*")
        .eq("id", inserted.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read created team: ${error?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // update — modify a team's IDENTITY: name / short name / color (PR b2).
  // Identity is the captain tier: owner OR the team's captain (requireTeamIdentityEdit).
  // Structure (create/delete/assign/remove) stays owner-only — unchanged.
  // -----------------------------------------------------------------------
  update: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        teamId: z.string(),
        name: z.string().min(1).max(TEAM_NAME_MAX).optional(),
        shortName: z.string().min(1).max(TEAM_SHORT_MAX).optional(),
        color: z.string().min(1).max(20).optional(),
        colorDim: z.string().min(1).max(20).optional(),
      })
    )
    .use(requireTeamIdentityEdit())
    .mutation(async ({ ctx, input }) => {
      // Through `update_team_identity` (migration 138) rather than the table,
      // because migration 139 removes the captain arm from `teams_update`. A
      // captain must still be able to rename and recolour a team they run, and
      // a row-level policy cannot say "these four columns only" — so the
      // capability lives in a definer whose UPDATE omits `competition_id` by
      // construction, and a captain can no longer move their team between cups.
      //
      // NULL means "leave alone", which is exactly what the optional inputs
      // already meant, so the argument list maps one-to-one onto the old patch.
      const { error } = await ctx.supabase.rpc("update_team_identity", {
        p_team_id: input.teamId,
        p_name: input.name ?? null,
        p_short_name: input.shortName ?? null,
        p_color: input.color ?? null,
        p_color_dim: input.colorDim ?? null,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update team: ${error.message}`,
        });
      }

      // Read back separately — the RPC returns void, and the caller's contract
      // is the updated row. Split rather than combined for the same reason
      // enforced pattern #4 splits INSERT..RETURNING: the write and the read
      // are answerable to different policies.
      const { data, error: readErr } = await ctx.supabase
        .from("teams")
        .select()
        .eq("id", input.teamId)
        .single();

      if (readErr || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read back team: ${readErr?.message}`,
        });
      }

      return data;
    }),

  // -----------------------------------------------------------------------
  // delete — remove a team (owner/co-admin). Editing teams is co-admin work
  // (not competition-destructive). Cascades clear assignments.
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), teamId: z.string() }))
    .use(requireCompetitionRole("co_admin"))
    .mutation(async ({ ctx, input }) => {
      // Roster-removal lock: deleting a team is a MASS removal (cascades to clear
      // its assignments), so it's blocked once the competition has any score.
      const { data: team } = await ctx.supabase
        .from("teams")
        .select("competition_id")
        .eq("id", input.teamId)
        .maybeSingle();
      if (team?.competition_id) {
        await assertRosterUnlocked(ctx.supabase, team.competition_id as string);
      }

      // #781 — count deliberately NOT asserted. Zero rows here means the
      // row was already gone, which on shared trip data is a concurrent
      // actor or a double-tap, not a defect — and the user's intent
      // ("remove this") is satisfied either way. Asserting would turn a
      // race into an error for no gain. Contrast archivedIdeas.remove,
      // which DOES assert: that row is user-scoped, so it has no second
      // actor.
      const { error } = await ctx.supabase
        .from("teams")
        .delete()
        .eq("id", input.teamId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete team: ${error.message}`,
        });
      }

      // The roster lock above blocks this once ANY score_entries row exists —
      // but it checks score_entries specifically, not game_results, so a
      // competition scored entirely through manual (non-golf) games — which
      // write straight to game_results and never touch score_entries — stays
      // UNLOCKED for team deletion even after it's fully decided. And for a
      // per_match rack competition, pointsAvailable is team-size-derived, so
      // losing a team's assignments can shift it in either direction. Both are
      // real, if narrow, un-clinch paths this lock doesn't close.
      if (team?.competition_id) {
        await reconcileClinchClaim(team.competition_id as string);
      }

      return { success: true };
    }),
});
