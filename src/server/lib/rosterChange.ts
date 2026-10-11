import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { competitionHasResults } from "./rosterLock";
import { assertRosterUnchanged, readRosterFingerprint } from "./rosterFingerprint";
import { readPersonParticipation } from "./participationGuard";
import { countOrThrow, rowsOrThrow } from "./rowOrThrow";
import { playersByTeam, recreditedRoster, TEAM_SCORING, unevenTeams, type UnevenTeams } from "@/lib/recredit";

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
  /**
   * Has THIS person played in a finished game of the cup? Deliberately a yes/no
   * with no team in it. A finished game is credited through the roster it
   * finalized with (8a, `games.credited_roster`) — not through the person's
   * current team, and not "no team" for someone who is on none today. The first
   * add preview reasoned from the current assignment and told a re-added player
   * his finished games "stay counting for no team", which in a head-to-head cup
   * can never be true: the bug 8a fixed in the writers, recurring in the screen
   * (Zach's look, 2026-10-04). So the preview says only that those results stand.
   */
  hasFinishedGames: boolean;
  /** Unfinished team-independent games that will count for the new team (or
   *  none), each with the uneven-teams warning the change would leave it with
   *  (#1562) — null when its teams would be even. */
  moving: (RosterGame & { uneven: UnevenTeams | null })[];
  /** Non-empty means the change will be refused — shown, not offered. */
  blocking: RosterGame[];
}

export async function previewRosterChange(
  supabase: SupabaseClient,
  input: {
    tripId: string;
    competitionId: string;
    userId: string;
    /** Where the person goes: a team for a move or an add, null for a removal. */
    toTeamId: string | null;
  }
): Promise<RosterChangePreview> {
  const [fingerprint, hasResults, finished, games] = await Promise.all([
    readRosterFingerprint(supabase, input.tripId, input.competitionId),
    competitionHasResults(supabase, input.competitionId),
    supabase.from("games").select("id").eq("competition_id", input.competitionId).eq("status", "complete"),
    personUnfinishedGames(supabase, input.competitionId, input.userId),
  ]);
  // The SAME reading of "is this person in this game" the refusal uses
  // (`readPersonParticipation`): participant rows, 2v2 groups, pick'em sheets
  // and bracket entrants.
  const finishedIds = rowsOrThrow(finished, "cup's finished games").map((g) => g.id as string);
  const [played, uneven] = await Promise.all([
    readPersonParticipation(supabase, finishedIds, input.userId),
    unevenAfterChange(supabase, input, games.moving),
  ]);
  return {
    fingerprint,
    hasResults,
    hasFinishedGames: finishedIds.some((id) => played.gameIds.has(id) || played.entrantGameIds.has(id)),
    moving: games.moving.map((g) => ({ ...g, uneven: uneven.get(g.gameId) ?? null })),
    blocking: games.blocking,
  };
}

/**
 * UNEVEN TEAMS AFTER THE CHANGE (#1562; Zach's ruling on #1561: a stroke or
 * skins team total stays a sum — warn, never block).
 *
 * For each unfinished game the change moves (`moving`: the person is in it,
 * and it is team-independent), the tag the round would carry with this person
 * on `toTeamId`. Counted over the game's PARTICIPANTS, since a round still
 * being played has no finishers, through the cup's roster with this one entry
 * changed (`recreditedRoster` — the same "after" the re-credit sheet uses).
 * Finished games are not here at all: they keep the roster they finalized with
 * (8a), so a trade changes nothing in them.
 *
 * Only formats that say how their teams rank (`TEAM_SCORING`) are tagged; the
 * direction of the explanation comes from there, never worded here.
 */
async function unevenAfterChange(
  supabase: SupabaseClient,
  input: { competitionId: string; userId: string; toTeamId: string | null },
  moving: RosterGame[]
): Promise<Map<string, UnevenTeams | null>> {
  const out = new Map<string, UnevenTeams | null>();
  if (moving.length === 0) return out;
  const ids = moving.map((g) => g.gameId);
  const [gamesRes, partsRes, rosterRes, teamsRes] = await Promise.all([
    supabase.from("games").select("id, game_type_id, config").in("id", ids),
    supabase.from("game_participants").select("game_id, user_id").in("game_id", ids),
    supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", input.competitionId),
    supabase.from("teams").select("id, name").eq("competition_id", input.competitionId),
  ]);
  const roster = Object.fromEntries(
    rowsOrThrow(rosterRes, "cup's rosters").map((a) => [a.user_id as string, a.team_id as string])
  );
  const after = recreditedRoster(roster, input.userId, input.toTeamId);
  const teams = rowsOrThrow(teamsRes, "cup's teams").map((t) => ({ teamId: t.id as string, teamName: t.name as string }));
  const players = new Map<string, string[]>();
  for (const p of rowsOrThrow(partsRes, "games' players")) {
    const list = players.get(p.game_id as string) ?? [];
    list.push(p.user_id as string);
    players.set(p.game_id as string, list);
  }
  for (const g of rowsOrThrow(gamesRes, "games being moved")) {
    const scoringOf = TEAM_SCORING[g.game_type_id as string];
    if (!scoringOf) continue;
    out.set(
      g.id as string,
      unevenTeams({ scoring: scoringOf(g.config), counts: playersByTeam(players.get(g.id as string) ?? [], after), teams })
    );
  }
  return out;
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
