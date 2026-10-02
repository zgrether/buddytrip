import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { competitionHasResults } from "./rosterLock";
import { assertRosterUnchanged, readRosterFingerprint } from "./rosterFingerprint";
import { readPersonParticipation } from "./participationGuard";
import { countOrThrow, rowsOrThrow } from "./rowOrThrow";

/**
 * Roster changes after results (PR 8b) — what replaced the roster lock.
 *
 * ── What the lock was holding up, and what holds it up now ────────────────
 *
 * Until 8b, `assertRosterUnlocked` refused every Organizer move, removal and
 * team delete once any game in the cup had a result. Lifting a guard exposes
 * everything behind it at once (CLAUDE.md), so each thing it made unreachable
 * is answered here or elsewhere, by name:
 *
 *  - A FINISHED game re-crediting through the new roster on a correction —
 *    8a: every finished game is credited through the roster it finalized with
 *    (`games.credited_roster`, migration 203). A trade moves no banked points.
 *  - An UNFINISHED team-dependent game (a match, a scramble, rack, pick'em, a
 *    bracket…) the person is in — its sides were built on their old team, so
 *    the change is REFUSED, naming the game (Zach, 2026-10-02).
 *  - An unfinished team-INDEPENDENT game (stroke, skins) — allowed; it credits
 *    the person's team at finalize (ruling 15: points are earned at finalize).
 *  - A team deleted while it carries banked points — refused (ruling 15: a
 *    team carrying banked points cannot vanish); see `assertTeamDeletable`.
 *  - A change confirmed against a roster another organizer has since changed —
 *    refused by the fingerprint the preview was built on (#1517).
 *  - Captaincy riding along on a move — `teamAssignments.assign` clears it.
 *  - The clinch. A trade moves no banked points, and live games count their
 *    owner-set total (#1425 ruling 2), so in reachable data a trade cannot move
 *    the target — but a legacy game with no owner total sizes its pool from
 *    team sizes. So a post-results change settles the clinch exactly as a
 *    finalize does (`settleClinchAfterRosterChange` in teamAssignments):
 *    announce one it created, release one it undid, after the response.
 *
 * Before results nothing here applies: a stale move is visible, reversible and
 * scores nothing, so the working drag-to-move flow is left exactly as it was.
 * Captains are untouched — they lose roster rights at results (ruling 29), in
 * SQL (`_competition_roster_locked`).
 */

export interface RosterGame {
  gameId: string;
  name: string;
}

/** The games a roster change would move this person's future credit in, split
 *  by whether the change is allowed there. Finished games are not listed: a
 *  change moves nothing in them (8a). */
export interface PersonGames {
  /** Unfinished and team-DEPENDENT: the change is refused while any exists. */
  blocking: RosterGame[];
  /** Unfinished and team-INDEPENDENT: allowed; counts for the new team. */
  moving: RosterGame[];
}

/** One unregistered type counts as team-dependent: a refusal that fails closed
 *  costs a confirm, a wrong "allowed" costs a match built on a team that moved. */
const isTeamDependent = (gameTypeId: string | null) =>
  getGameTypeDefinition(gameTypeId)?.teamDependent ?? true;

export async function personUnfinishedGames(
  supabase: SupabaseClient,
  competitionId: string,
  userId: string
): Promise<PersonGames> {
  const games = rowsOrThrow(
    await supabase
      .from("games")
      .select("id, name, game_type_id, status")
      .eq("competition_id", competitionId)
      .neq("status", "complete"),
    "cup's games"
  );
  const out: PersonGames = { blocking: [], moving: [] };
  if (games.length === 0) return out;
  const p = await readPersonParticipation(supabase, games.map((g) => g.id as string), userId);
  for (const g of games) {
    const id = g.id as string;
    if (!p.gameIds.has(id) && !p.entrantGameIds.has(id)) continue;
    const entry = { gameId: id, name: (g.name as string | null) ?? "Untitled game" };
    (isTeamDependent(g.game_type_id as string | null) ? out.blocking : out.moving).push(entry);
  }
  return out;
}

/** "Hole 7 Match" / "Hole 7 Match and The Scramble" / "A, B and 2 more". */
function nameGames(games: RosterGame[]): string {
  const names = games.map((g) => g.name);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function blockedRefusal(personName: string, games: RosterGame[]): string {
  return (
    `${personName} is still playing in ${nameGames(games)}, which was set up with their current team. ` +
    `Finish ${games.length === 1 ? "it" : "those games"} or take them out of ${games.length === 1 ? "it" : "them"} first.`
  );
}

export const PREVIEW_REQUIRED_MESSAGE =
  "Results are in, so a roster change has to be reviewed first. Open the player again to see what it does.";

/**
 * The server half of every Organizer move or removal. Before results: nothing.
 * After: the change must carry the fingerprint its preview was built on, and
 * the person must not be in an unfinished team-dependent game. Every read is
 * made before the caller's first write.
 */
export async function assertRosterChangeAllowed(
  supabase: SupabaseClient,
  input: { tripId: string; competitionId: string; userId: string; personName: string; rosterFingerprint?: string }
): Promise<{ hasResults: boolean }> {
  if (!(await competitionHasResults(supabase, input.competitionId))) return { hasResults: false };
  if (!input.rosterFingerprint) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: PREVIEW_REQUIRED_MESSAGE });
  }
  await assertRosterUnchanged(supabase, input.tripId, input.competitionId, input.rosterFingerprint);
  const { blocking } = await personUnfinishedGames(supabase, input.competitionId, input.userId);
  if (blocking.length > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: blockedRefusal(input.personName, blocking) });
  }
  return { hasResults: true };
}

export interface RosterChangePreview {
  /** The roster this preview was built on; the confirm sends it back. */
  fingerprint: string;
  /** False: no preview needed, the change goes straight through (pre-results). */
  hasResults: boolean;
  /** Finished games in the cup: none of their points move. */
  finishedGames: number;
  /** Unfinished team-independent games that will count for the new team (or none). */
  moving: RosterGame[];
  /** Non-empty means the change will be refused — shown, not offered. */
  blocking: RosterGame[];
}

export async function previewRosterChange(
  supabase: SupabaseClient,
  input: { tripId: string; competitionId: string; userId: string }
): Promise<RosterChangePreview> {
  const [fingerprint, hasResults, finished, games] = await Promise.all([
    readRosterFingerprint(supabase, input.tripId, input.competitionId),
    competitionHasResults(supabase, input.competitionId),
    supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", input.competitionId)
      .eq("status", "complete"),
    personUnfinishedGames(supabase, input.competitionId, input.userId),
  ]);
  return {
    fingerprint,
    hasResults,
    finishedGames: countOrThrow(finished, "cup's finished games"),
    moving: games.moving,
    blocking: games.blocking,
  };
}

export const TEAM_HAS_RESULTS_MESSAGE = (teamName: string) =>
  `${teamName} has results banked, and points stay with the team they were won for, so it can't be deleted. You can rename it instead.`;

export const TEAM_NOT_EMPTY_MESSAGE = (teamName: string) =>
  `Results are in, so move or remove ${teamName}'s players first. Each change is reviewed on its own.`;

/**
 * Deleting a team. Before results: allowed, as before. After results:
 *  - never a team with banked points — a `game_results` row credited to it, or
 *    a finished game whose credited roster puts someone on it (rack and pick'em
 *    build their team list from `teams`, so a deleted team's members would
 *    credit nowhere on a correction);
 *  - never a team that still has players: removing them is a roster change,
 *    and each one gets its own preview and refusal rather than a bulk path that
 *    would skip both.
 */
export async function assertTeamDeletable(
  supabase: SupabaseClient,
  input: { competitionId: string; teamId: string; teamName: string }
): Promise<void> {
  if (!(await competitionHasResults(supabase, input.competitionId))) return;
  const [credited, finished, members] = await Promise.all([
    supabase
      .from("game_results")
      .select("id", { count: "exact", head: true })
      .eq("credited_team_id", input.teamId),
    supabase
      .from("games")
      .select("credited_roster")
      .eq("competition_id", input.competitionId)
      .eq("status", "complete"),
    supabase
      .from("team_assignments")
      .select("user_id", { count: "exact", head: true })
      .eq("competition_id", input.competitionId)
      .eq("team_id", input.teamId),
  ]);
  const inRoster = rowsOrThrow(finished, "cup's finished games").some((g) =>
    Object.values((g.credited_roster ?? {}) as Record<string, string>).includes(input.teamId)
  );
  if (countOrThrow(credited, "team's results") > 0 || inRoster) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: TEAM_HAS_RESULTS_MESSAGE(input.teamName) });
  }
  if (countOrThrow(members, "team's players") > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: TEAM_NOT_EMPTY_MESSAGE(input.teamName) });
  }
}
