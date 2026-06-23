import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireCompetitionRole, requireTeamIdentityEdit } from "../middleware";

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
        name: z.string().min(1).max(100),
        shortName: z.string().min(1).max(4),
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
        name: z.string().min(1).max(100).optional(),
        shortName: z.string().min(1).max(4).optional(),
        color: z.string().min(1).max(20).optional(),
        colorDim: z.string().min(1).max(20).optional(),
      })
    )
    .use(requireTeamIdentityEdit())
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.shortName !== undefined) patch.short_name = input.shortName;
      if (input.color !== undefined) patch.color = input.color;
      if (input.colorDim !== undefined) patch.color_dim = input.colorDim;

      const { data, error } = await ctx.supabase
        .from("teams")
        .update(patch)
        .eq("id", input.teamId)
        .select()
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update team: ${error?.message}`,
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

      return { success: true };
    }),
});
