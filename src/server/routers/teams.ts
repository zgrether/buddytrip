import { z } from "zod";
import { EITHER_COMPETITION } from "@/lib/vocabulary";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireCompetitionRole, requireTeamIdentityEdit } from "../middleware";
import { competitionHasResults } from "../lib/rosterLock";
import { assertTeamDeletable } from "../lib/rosterChange";
import { reconcileClinchClaim } from "../lib/gameFinishNotify";
import { countOrThrow, maybeRowOrThrow, rowsOrThrow } from "../lib/rowOrThrow";

/**
 * A team's name, and its short name, are unique within its competition,
 * ignoring case and spaces (migration 219's indexes; a blank short name may
 * repeat). The database refuses a clash with unique_violation (23505); these
 * are the sentences the person sees instead, each naming the fix.
 */
export function duplicateTeamNameMessage(name: string): string {
  return `Another team is already called ${name.trim()}. Pick a different name.`;
}
export function duplicateShortNameMessage(shortName: string): string {
  return `Another team already uses the short name ${shortName.trim()}. Pick a different one.`;
}
function violated(error: unknown, index: string): boolean {
  const e = error as { code?: string; message?: string } | null | undefined;
  return e?.code === "23505" && (e.message ?? "").includes(index);
}
const isDuplicateTeamName = (error: unknown) => violated(error, "teams_competition_name_unique");
const isDuplicateShortName = (error: unknown) => violated(error, "teams_competition_short_name_unique");
import { canPlayInTeamlessRace } from "@/lib/gameTypes";
import { isPlacement } from "@/lib/pointsDistribution";
import { validatePlacement } from "@/lib/gameConfig";
import { teamPlaceCapacity } from "@/lib/placeCapacity";
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

/**
 * Ruling 2 (PR 4): a head-to-head cup (`scoring_model = 'match_play'`) is
 * EXACTLY two teams. `competitions.create` seeds two, and the team editor hides
 * add and delete on one (`structureLocked`) — but that is a picker hiding a
 * control, not a refusal, and ruling 11 puts structural rules on the server.
 *
 * Both refusals name what the reader CAN do. The only reader who reaches one is
 * an API caller or a stale client, and "not allowed" alone leaves them nowhere.
 */
export const HEAD_TO_HEAD_NO_THIRD_TEAM =
  "A Cup is exactly two teams, so it can't take another. Rename or recolor one of the two in Rosters instead.";
export const HEAD_TO_HEAD_KEEPS_BOTH_TEAMS =
  "A Cup is exactly two teams, so neither can be deleted. Rename it in Rosters instead, or delete the whole cup in its settings.";
/** PR 7, ruling 23: individuals-or-teams locks at the first result. The way out
 *  that exists is clearing the results, which the competition's settings offer. */
export const INDIVIDUALS_LOCKED_AT_FIRST_RESULT =
  "This tournament is played as individuals and already has results, so it can't switch to teams: that would null everyone's points. Reset the tournament's scores in its settings first.";

/** How many teams a competition has, any kind (PR 7: a points race with none is
 *  played as individuals, ruling B). A failed read throws, never reads as 0. */
async function teamCount(supabase: SupabaseClient, competitionId: string): Promise<number> {
  return countOrThrow(
    await supabase.from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId),
    "teams"
  );
}

/**
 * The games whose placement split would have MORE places than teams once the
 * competition is down to `remaining` teams (#1427).
 *
 * Every place-split write refuses a split longer than the team count
 * (`validatePlacement` + `placeCapacity`), but deleting a team lowers the count
 * underneath splits already saved. A 5/3/2 game in a three-team tournament left
 * with two teams pays at most 8 of its 10, and the other 2 stay in
 * points-available, a target no team can reach. Same check, same ceiling, run
 * for the count the delete would leave.
 *
 * A bracket's ceiling is its field, not the teams, so a game with entrants is
 * left out. Reads fail closed (CLAUDE.md, "a failed read is never data").
 */
async function splitsOutrunningTeams(supabase: SupabaseClient, competitionId: string, remaining: number): Promise<string[]> {
  const games = rowsOrThrow(
    await supabase.from("games").select("id, name, points_total, points_distribution").eq("competition_id", competitionId),
    "games"
  );
  const capacity = teamPlaceCapacity(remaining);
  const over = games.filter((g) => {
    const d = g.points_distribution as unknown;
    if (!isPlacement(d)) return false;
    return validatePlacement((g.points_total as number | null) ?? 0, d.values, capacity).state === "too_many_places";
  });
  if (over.length === 0) return [];
  const brackets = rowsOrThrow(
    await supabase.from("bracket_entrants").select("game_id").in("game_id", over.map((g) => g.id as string)),
    "bracket entrants"
  );
  const isBracket = new Set(brackets.map((b) => b.game_id as string));
  return over.filter((g) => !isBracket.has(g.id as string)).map((g) => (g.name as string | null)?.trim() || "an unnamed game");
}

/**
 * How many teams a head-to-head cup holds, or null when the competition is not
 * head to head (a points race takes any number). Read, then written by the
 * caller — two concurrent creates could both read 1 and both add. Not defended:
 * the add control is hidden on a head-to-head cup, so that race needs two
 * direct API calls in the same instant, and a lock would buy nothing a person
 * can reach.
 */
async function headToHeadTeamCount(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<number | null> {
  const { data: comp, error } = await supabase
    .from("competitions")
    .select("scoring_model")
    .eq("id", competitionId)
    .maybeSingle();
  if (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Couldn't load the ${EITHER_COMPETITION}: ${error.message}` });
  }
  if (!comp || comp.scoring_model !== "match_play") return null;
  const { count, error: countErr } = await supabase
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", competitionId);
  if (countErr) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to count teams: ${countErr.message}` });
  }
  return count ?? 0;
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
    .use(requireCompetitionRole("organizer"))
    .mutation(async ({ ctx, input }) => {
      // Fewer than two is admitted: a head-to-head cup whose seed never landed
      // must be able to reach two. Two or more is refused.
      const h2hTeams = await headToHeadTeamCount(ctx.supabase, input.competitionId);
      if (h2hTeams !== null && h2hTeams >= 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: HEAD_TO_HEAD_NO_THIRD_TEAM });
      }
      // PR 7, ruling 23: a race's FIRST team switches it from individuals to teams
      // (a race plays as teams iff it has them, ruling B), and that is locked at
      // the first result — converting would make every participant a teamless
      // player joining a team, and ruling 17 would null the whole race.
      if (h2hTeams === null && (await teamCount(ctx.supabase, input.competitionId)) === 0) {
        if (await competitionHasResults(ctx.supabase, input.competitionId)) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: INDIVIDUALS_LOCKED_AT_FIRST_RESULT });
        }
      }

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

      if (isDuplicateTeamName(insertErr)) {
        throw new TRPCError({ code: "CONFLICT", message: duplicateTeamNameMessage(input.name) });
      }
      if (isDuplicateShortName(insertErr)) {
        throw new TRPCError({ code: "CONFLICT", message: duplicateShortNameMessage(input.shortName) });
      }
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

      if (isDuplicateTeamName(error) && input.name) {
        throw new TRPCError({ code: "CONFLICT", message: duplicateTeamNameMessage(input.name) });
      }
      if (isDuplicateShortName(error) && input.shortName) {
        throw new TRPCError({ code: "CONFLICT", message: duplicateShortNameMessage(input.shortName) });
      }
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
  // delete — remove a team (owner/Organizer). Editing teams is Organizer work
  // (not competition-destructive). Cascades clear assignments.
  // -----------------------------------------------------------------------
  delete: authedProcedure
    .input(z.object({ tripId: z.string(), teamId: z.string() }))
    .use(requireCompetitionRole("organizer"))
    .mutation(async ({ ctx, input }) => {
      // After results a team carrying banked points cannot be deleted, and one
      // with players has to be emptied first, one reviewed change at a time
      // (PR 8b, `assertTeamDeletable`). This replaced the roster lock.
      // #1469: a failed read must not read as "no such team" — `competition_id`
      // would be undefined, BOTH guards below skipped, and the delete run.
      const team = maybeRowOrThrow(
        await ctx.supabase.from("teams").select("competition_id, name").eq("id", input.teamId).maybeSingle(),
        "team"
      );
      if (team?.competition_id) {
        // Structure before the roster lock: a head-to-head cup can never lose a
        // team, scored or not, so that is the truer reason to give.
        const h2hTeams = await headToHeadTeamCount(ctx.supabase, team.competition_id as string);
        if (h2hTeams !== null && h2hTeams <= 2) {
          throw new TRPCError({ code: "BAD_REQUEST", message: HEAD_TO_HEAD_KEEPS_BOTH_TEAMS });
        }
        await assertTeamDeletable(ctx.supabase, {
          competitionId: team.competition_id as string,
          teamId: input.teamId,
          teamName: (team.name as string | null)?.trim() || "This team",
        });
        // #1427: a points race keeps every saved place split payable. Only when a
        // team would be LEFT: at zero the race goes teamless and the check below
        // governs what it may hold.
        if (h2hTeams === null) {
          const remaining = (await teamCount(ctx.supabase, team.competition_id as string)) - 1;
          if (remaining >= 1) {
            const names = await splitsOutrunningTeams(ctx.supabase, team.competition_id as string, remaining);
            if (names.length > 0) {
              const one = names.length === 1;
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${names.join(", ")} ${one ? "awards" : "award"} points to more places than ${remaining} ${remaining === 1 ? "team" : "teams"} can finish in. Shorten ${one ? "its" : "their"} points split first, or keep this team.`,
              });
            }
          }
        }
        // PR 7: deleting a points race's LAST team makes it a teamless race (ruling
        // B), which holds only formats that record a result per person. A game
        // that pays teams would then finish paying nobody, so it is named here.
        if (h2hTeams === null && (await teamCount(ctx.supabase, team.competition_id as string)) === 1) {
          const games = rowsOrThrow(
            await ctx.supabase.from("games").select("name, game_type_id").eq("competition_id", team.competition_id as string),
            "games"
          );
          const blocking = games.filter((g) => !canPlayInTeamlessRace(g.game_type_id as string | null));
          if (blocking.length > 0) {
            const names = blocking.map((g) => (g.name as string | null)?.trim() || "an unnamed game").join(", ");
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Without teams this tournament is played as individuals, and ${names} awards points to teams. Remove ${blocking.length === 1 ? "that game" : "those games"} first, or keep a team.`,
            });
          }
        }
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

      // The roster lock above blocks this once ANY game in the competition has
      // started — `game_started`, every format's own answer (#1018), not only
      // `score_entries` as this comment used to say (corrected in PR 7). What it
      // does not close: a per_match rack competition's pointsAvailable is
      // team-size-derived, so an unstarted cup losing a team's assignments can
      // shift the clinch target, which is why the claim is reconciled here.
      if (team?.competition_id) {
        await reconcileClinchClaim(team.competition_id as string);
      }

      return { success: true };
    }),
});
