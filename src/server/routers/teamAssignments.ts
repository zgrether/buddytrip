import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";
import { assertRosterUnlocked, competitionHasScore } from "../lib/rosterLock";

/**
 * team_assignments — composite PK (competition_id, user_id) means a user
 * is on at most one team per competition. assign() upserts that pairing;
 * remove() deletes it (Owner only per spec).
 */

/** Shared between teamAssignments.list and competitions.hydrate. */
export async function listTeamAssignments(
  ctx: { supabase: SupabaseClient },
  competitionId: string,
) {
  // Canonical roster order (mig 070): order by sort_order WITHIN each team. Every
  // team-roster chooser filters this list by team_id, so the per-team relative
  // order is what carries through — grouping by team_id first keeps the raw list
  // tidy too. This single ordered read is what makes the order canonical.
  const { data, error } = await ctx.supabase
    .from("team_assignments")
    .select("*")
    .eq("competition_id", competitionId)
    .order("team_id", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to fetch team assignments: ${error.message}`,
    });
  }
  return data ?? [];
}

export const teamAssignmentsRouter = router({
  // -----------------------------------------------------------------------
  // list — all assignments for a competition
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx, input }) => listTeamAssignments(ctx, input.competitionId)),

  // rosterLocked — has scoring started (any score entered)? Drives the Rosters
  // sheet's disabled remove/delete controls (C1 is the enforcement; this is so the
  // block isn't a surprising error). Adds stay enabled regardless.
  rosterLocked: authedProcedure
    .input(z.object({ tripId: z.string(), competitionId: z.string() }))
    .use(requireTripMember)
    .query(({ ctx, input }) => competitionHasScore(ctx.supabase, input.competitionId)),

  // -----------------------------------------------------------------------
  // assign — set a user's team (canEdit). Upsert behaviour relies on the
  // composite PK (competition_id, user_id) — assign-twice replaces.
  // -----------------------------------------------------------------------
  assign: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        userId: z.string(),
        teamId: z.string(),
      })
    )
    .use(requireTripRole("Organizer"))
    .mutation(async ({ ctx, input }) => {
      // Roster-removal lock — asymmetric: a pure ADD (no prior assignment) always
      // passes. A MOVE/TRADE (already on a DIFFERENT team) removes them from that
      // team, so it's blocked once scoring has started. (Re-assigning to the same
      // team is a no-op, not a removal — passes.)
      const { data: existing } = await ctx.supabase
        .from("team_assignments")
        .select("team_id")
        .eq("competition_id", input.competitionId)
        .eq("user_id", input.userId)
        .maybeSingle();
      const isSameTeam = !!existing && (existing.team_id as string) === input.teamId;
      const isMove = !!existing && (existing.team_id as string) !== input.teamId;
      if (isMove) await assertRosterUnlocked(ctx.supabase, input.competitionId);

      // sort_order (mig 070): a genuine ADD or a MOVE to a different team lands at
      // the END of the target team's canonical order. A same-team re-assign is a
      // no-op — leave sort_order untouched so it doesn't jump to the bottom.
      const payload: {
        competition_id: string;
        user_id: string;
        team_id: string;
        sort_order?: number;
      } = {
        competition_id: input.competitionId,
        user_id: input.userId,
        team_id: input.teamId,
      };
      if (!isSameTeam) {
        const { data: maxRow } = await ctx.supabase
          .from("team_assignments")
          .select("sort_order")
          .eq("competition_id", input.competitionId)
          .eq("team_id", input.teamId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        payload.sort_order = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;
      }

      const { data: inserted, error } = await ctx.supabase
        .from("team_assignments")
        .upsert(payload, { onConflict: "competition_id,user_id" })
        .select()
        .single();

      if (error || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to assign team: ${error?.message}`,
        });
      }

      return inserted;
    }),

  // -----------------------------------------------------------------------
  // remove — clear a user's assignment (Owner only per spec)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        userId: z.string(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      // Roster-removal lock: a removal is blocked once any game in the competition
      // has a score (it could orphan the player in a configured match).
      await assertRosterUnlocked(ctx.supabase, input.competitionId);

      const { error } = await ctx.supabase
        .from("team_assignments")
        .delete()
        .eq("competition_id", input.competitionId)
        .eq("user_id", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to remove team assignment: ${error.message}`,
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // setCaptain — mark/unmark a player as their team's captain (Owner only).
  // Appointing a captain is a STRUCTURE act (the owner appoints; the captain
  // doesn't pass it on). Delegates to the atomic plpgsql swap (migration 064):
  // isCaptain=true clears the team's prior captain then sets this one (one per
  // team, declaratively enforced); isCaptain=false unmarks just this user.
  // Throws if the target isn't assigned to the team.
  // -----------------------------------------------------------------------
  setCaptain: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        teamId: z.string(),
        userId: z.string(),
        isCaptain: z.boolean(),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("set_team_captain", {
        p_trip_id: input.tripId,
        p_competition_id: input.competitionId,
        p_team_id: input.teamId,
        p_user_id: input.userId,
        p_is_captain: input.isCaptain,
      });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to set captain: ${error.message}`,
        });
      }
      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // reorder — set a team's canonical roster order (Owner only). Persists the
  // drag-reorder from the Edit Team modal. Pure REORDER, not assign: the input
  // must be exactly the team's current members (a permutation) — we validate
  // that so reorder can never sneak a player onto/off the team or change
  // membership. sort_order = the index in orderedUserIds. Allowed regardless of
  // the roster-removal lock: reordering orphans no one (it's cosmetic order).
  // -----------------------------------------------------------------------
  reorder: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        competitionId: z.string(),
        teamId: z.string(),
        orderedUserIds: z.array(z.string()),
      })
    )
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
      const { data: current, error: readErr } = await ctx.supabase
        .from("team_assignments")
        .select("user_id")
        .eq("competition_id", input.competitionId)
        .eq("team_id", input.teamId);
      if (readErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read roster: ${readErr.message}`,
        });
      }

      // The input must be a permutation of the team's current roster — same set,
      // no extras, no omissions. Anything else is a stale/forged order; reject it
      // rather than silently mutate membership.
      const currentIds = new Set((current ?? []).map((r) => r.user_id as string));
      const inputIds = new Set(input.orderedUserIds);
      const isPermutation =
        currentIds.size === inputIds.size &&
        input.orderedUserIds.length === inputIds.size &&
        [...inputIds].every((id) => currentIds.has(id));
      if (!isPermutation) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Order must be exactly this team's current roster.",
        });
      }
      if (input.orderedUserIds.length === 0) return { success: true };

      // All rows already exist → the upsert resolves to UPDATE on the (comp,user)
      // PK conflict, setting only sort_order (is_captain + team_id retained).
      const rows = input.orderedUserIds.map((userId, i) => ({
        competition_id: input.competitionId,
        user_id: userId,
        team_id: input.teamId,
        sort_order: i,
      }));
      const { error } = await ctx.supabase
        .from("team_assignments")
        .upsert(rows, { onConflict: "competition_id,user_id" });
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to reorder roster: ${error.message}`,
        });
      }
      return { success: true };
    }),
});
