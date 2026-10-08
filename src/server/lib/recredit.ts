import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import {
  finishersByTeam, isRecreditEligible, recreditTeamRows, recreditedRoster, TEAM_SCORING, unevenTeams,
  type RecreditPreview, type StandingGame, type TeamPoints, type TeamResultRow, type UnevenTeams,
} from "@/lib/recredit";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { parseCreditedRoster } from "./creditRoster";
import { readPersonParticipation } from "./participationGuard";
import { maybeRowOrThrow, rowsOrThrow } from "./rowOrThrow";
import { tripDisplayNames } from "./tripDisplayNames";

/**
 * RE-CREDIT, the server half (PR 8c, ruling 18; Zach's rulings 2026-10-04).
 *
 * The trip Owner moves ONE person's credit in chosen FINISHED games to the team
 * they are on now — or to no team — game by game. It fixes a mistake, so it is
 * opt-in per game: a deliberate trade leaves the rounds before it where they
 * were earned, and only the rounds that were wrong move.
 *
 * Only formats whose result did not depend on the teams (`teamDependent:
 * false` — stroke play, skins). Every other finished game the person played
 * whose credit differs is still LISTED, as standing as played, so the Owner
 * sees why it is not offered rather than wondering where it went.
 *
 * The write is one database transaction (`recredit_games`, migration 204):
 * the stored roster, the team rows and the record move together or not at
 * all. This module computes the new team rows and what the board says before
 * and after — through the board's own `computeCompetitionLeaderboard`, with a
 * what-if, never a second copy of its maths.
 */

interface FinishedGame {
  id: string;
  name: string;
  game_type_id: string | null;
  corrections_open: boolean;
  config: unknown;
  roster: Record<string, string> | null;
}

async function readFinishedGames(supabase: SupabaseClient, competitionId: string): Promise<FinishedGame[]> {
  const rows = rowsOrThrow(
    await supabase
      .from("games")
      .select("id, name, game_type_id, corrections_open, config, credited_roster")
      .eq("competition_id", competitionId)
      .eq("status", "complete")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    "cup's finished games"
  );
  return rows.map((g) => ({
    id: g.id as string,
    name: (g.name as string | null) ?? "Untitled game",
    game_type_id: (g.game_type_id as string | null) ?? null,
    corrections_open: g.corrections_open === true,
    config: g.config,
    // NULL would mean a finished game never credited — none exist (the 8b
    // zero-check, 2026-10-04). Such a game is skipped rather than guessed at.
    roster: g.credited_roster == null ? null : parseCreditedRoster(g.credited_roster, g.id as string),
  }));
}

async function currentTeamOf(supabase: SupabaseClient, competitionId: string, userId: string): Promise<string | null> {
  const row = maybeRowOrThrow(
    await supabase
      .from("team_assignments")
      .select("team_id")
      .eq("competition_id", competitionId)
      .eq("user_id", userId)
      .maybeSingle(),
    "player's current team"
  );
  return (row?.team_id as string | undefined) ?? null;
}

/** Person rows of the given games, by game. Every person, not only this one:
 *  a team's total is built from all its players. */
async function personRowsByGame(supabase: SupabaseClient, gameIds: string[]) {
  const out = new Map<string, { entity_id: string; raw_score: number | null; position: number | null }[]>();
  if (gameIds.length === 0) return out;
  const rows = rowsOrThrow(
    await supabase
      .from("game_results")
      .select("game_id, entity_id, raw_score, position")
      .in("game_id", gameIds)
      .eq("entity_type", "user"),
    "games' player results"
  );
  for (const r of rows) {
    const list = out.get(r.game_id as string) ?? [];
    list.push({
      entity_id: r.entity_id as string,
      raw_score: r.raw_score == null ? null : Number(r.raw_score),
      position: (r.position as number | null) ?? null,
    });
    out.set(r.game_id as string, list);
  }
  return out;
}

const hasResult = (rows: { entity_id: string; raw_score: number | null; position: number | null }[] | undefined, userId: string) =>
  !!rows?.some((r) => r.entity_id === userId && r.raw_score !== null && r.position !== null);

/**
 * Which people have at least one game an Owner could re-credit — the Edit Team
 * entry point's question. No board computation: a person is a candidate when a
 * finished, eligible, not-in-review game holds a result of theirs credited to a
 * team other than the one they are on now.
 */
export async function recreditCandidates(supabase: SupabaseClient, competitionId: string): Promise<string[]> {
  const games = (await readFinishedGames(supabase, competitionId)).filter(
    (g) => g.roster && isRecreditEligible(g.game_type_id) && !g.corrections_open
  );
  if (games.length === 0) return [];
  const [rows, assigns] = await Promise.all([
    personRowsByGame(supabase, games.map((g) => g.id)),
    supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
  ]);
  const teamNow = new Map(
    rowsOrThrow(assigns, "cup's rosters").map((a) => [a.user_id as string, a.team_id as string])
  );
  const out = new Set<string>();
  for (const g of games) {
    for (const r of rows.get(g.id) ?? []) {
      if (r.raw_score === null || r.position === null) continue;
      if ((g.roster?.[r.entity_id] ?? null) !== (teamNow.get(r.entity_id) ?? null)) out.add(r.entity_id);
    }
  }
  return [...out];
}

/** The new team rows for each game, once this person's credit moves. */
function teamRowsAfter(
  game: FinishedGame,
  rows: { entity_id: string; raw_score: number | null; position: number | null }[],
  userId: string,
  toTeamId: string | null
): TeamResultRow[] {
  const scoring = TEAM_SCORING[game.game_type_id as string];
  if (!scoring) {
    // `recredit.guard.test.ts` makes this unreachable for a declared format.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `No team ranking known for ${game.name}.` });
  }
  return recreditTeamRows(rows, recreditedRoster(game.roster ?? {}, userId, toTeamId), scoring(game.config));
}

function pointsByGame(
  board: Awaited<ReturnType<typeof computeCompetitionLeaderboard>>,
  gameIds: string[]
): Map<string, TeamPoints[]> {
  const nameOf = new Map(board.teams.map((t) => [t.id as string, (t.name as string | null) ?? "Team"]));
  const out = new Map<string, TeamPoints[]>();
  for (const gameId of gameIds) {
    const cells = board.cells.filter((c) => c.gameId === gameId);
    out.set(
      gameId,
      board.teams.map((t) => {
        const c = cells.find((x) => x.unitId === t.id);
        return { teamId: t.id as string, teamName: nameOf.get(t.id as string) ?? "Team", place: c?.place ?? null, points: c?.points ?? 0 };
      })
    );
  }
  return out;
}

interface Plan {
  personName: string;
  toTeamId: string | null;
  toTeamName: string | null;
  eligible: { game: FinishedGame; fromTeamId: string | null; teamRows: TeamResultRow[]; uneven: UnevenTeams | null }[];
  standing: StandingGame[];
}

async function plan(
  supabase: SupabaseClient,
  input: { tripId: string; competitionId: string; userId: string }
): Promise<Plan> {
  const [games, toTeamId, teams, names] = await Promise.all([
    readFinishedGames(supabase, input.competitionId),
    currentTeamOf(supabase, input.competitionId, input.userId),
    supabase.from("teams").select("id, name").eq("competition_id", input.competitionId),
    tripDisplayNames(supabase, input.tripId, [input.userId]),
  ]);
  const teamName = new Map(rowsOrThrow(teams, "cup's teams").map((t) => [t.id as string, t.name as string]));
  const played = await readPersonParticipation(supabase, games.map((g) => g.id), input.userId);
  const eligibleGames = games.filter((g) => g.roster && isRecreditEligible(g.game_type_id));
  const rows = await personRowsByGame(supabase, eligibleGames.map((g) => g.id));

  const out: Plan = {
    personName: names.get(input.userId) ?? "This player",
    toTeamId,
    toTeamName: toTeamId ? teamName.get(toTeamId) ?? "Team" : null,
    eligible: [],
    standing: [],
  };
  for (const g of games) {
    if (!isRecreditEligible(g.game_type_id)) {
      // A team-dependent game they played stands as played. Listed when its
      // credit differs from where they are now — or when it has no stored
      // roster to say: a manual or bracket finish credits teams directly and
      // records none, so "differs" cannot be asked and the game is shown.
      const differs = !g.roster || (g.roster[input.userId] ?? null) !== toTeamId;
      if (differs && (played.gameIds.has(g.id) || played.entrantGameIds.has(g.id))) {
        out.standing.push({ gameId: g.id, name: g.name, reason: "team_dependent" });
      }
      continue;
    }
    if (!g.roster) continue; // an eligible finished game always has one (8b zero-check)
    const fromTeamId = g.roster[input.userId] ?? null;
    if (fromTeamId === toTeamId) continue; // already counts where they are now
    if (!hasResult(rows.get(g.id), input.userId)) continue; // no result, nothing to move
    if (g.corrections_open) {
      out.standing.push({ gameId: g.id, name: g.name, reason: "in_review" });
      continue;
    }
    const gameRows = rows.get(g.id) ?? [];
    out.eligible.push({
      game: g,
      fromTeamId,
      teamRows: teamRowsAfter(g, gameRows, input.userId, toTeamId),
      // #1561's ruling: warn, never block. Said of the round AFTER the move,
      // because that is the state the Owner is choosing — and the one that
      // explains a result that looks backwards.
      uneven: unevenTeams({
        scoring: TEAM_SCORING[g.game_type_id as string](g.config),
        counts: finishersByTeam(gameRows, recreditedRoster(g.roster, input.userId, toTeamId)),
        teams: [...teamName].map(([teamId, name]) => ({ teamId, teamName: name })),
      }),
    });
  }
  return out;
}

async function fingerprints(supabase: SupabaseClient, competitionId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("recredit_fingerprints", { p_competition_id: competitionId });
  if (error) throw refusal(error);
  return new Map(((data ?? []) as { game_id: string; fingerprint: string }[]).map((r) => [r.game_id, r.fingerprint]));
}

async function beforeAndAfter(
  supabase: SupabaseClient,
  competitionId: string,
  eligible: Plan["eligible"]
): Promise<{ before: Map<string, TeamPoints[]>; after: Map<string, TeamPoints[]> }> {
  const ids = eligible.map((e) => e.game.id);
  // One what-if covers every game at once: a game's per-game cells depend only
  // on its own rows, so overriding the others cannot change them.
  const override = new Map(eligible.map((e) => [e.game.id, e.teamRows]));
  const [now, then] = await Promise.all([
    computeCompetitionLeaderboard(supabase, competitionId),
    computeCompetitionLeaderboard(supabase, competitionId, { teamRowsOverride: override }),
  ]);
  return { before: pointsByGame(now, ids), after: pointsByGame(then, ids) };
}

export async function previewRecredit(
  supabase: SupabaseClient,
  input: { tripId: string; competitionId: string; userId: string }
): Promise<RecreditPreview> {
  const p = await plan(supabase, input);
  const [prints, points] = await Promise.all([
    p.eligible.length ? fingerprints(supabase, input.competitionId) : Promise.resolve(new Map<string, string>()),
    p.eligible.length
      ? beforeAndAfter(supabase, input.competitionId, p.eligible)
      : Promise.resolve({ before: new Map<string, TeamPoints[]>(), after: new Map<string, TeamPoints[]>() }),
  ]);
  return {
    personName: p.personName,
    toTeamId: p.toTeamId,
    toTeamName: p.toTeamName,
    eligible: p.eligible.map((e) => ({
      gameId: e.game.id,
      name: e.game.name,
      fromTeamId: e.fromTeamId,
      fromTeamName: e.fromTeamId ? (points.before.get(e.game.id)?.find((t) => t.teamId === e.fromTeamId)?.teamName ?? null) : null,
      before: points.before.get(e.game.id) ?? [],
      after: points.after.get(e.game.id) ?? [],
      fingerprint: prints.get(e.game.id) ?? "",
      uneven: e.uneven,
    })),
    standing: p.standing,
  };
}

export const RECREDIT_STALE_MESSAGE =
  "Something changed since you opened this — a result or this player's team. Open it again to review the change.";

/** A refusal names something the Owner can act on (CLAUDE.md). */
function refusal(error: { message?: string }): TRPCError {
  const m = error.message ?? "";
  if (m.includes("RECREDIT_OWNER_ONLY")) return new TRPCError({ code: "FORBIDDEN", message: "Only the trip owner can re-credit a game." });
  if (m.includes("RECREDIT_ROSTER_CHANGED") || m.includes("RECREDIT_RESULTS_CHANGED") || m.includes("RECREDIT_ALREADY_THERE"))
    return new TRPCError({ code: "CONFLICT", message: RECREDIT_STALE_MESSAGE });
  if (m.includes("RECREDIT_TEAM_DEPENDENT"))
    return new TRPCError({ code: "BAD_REQUEST", message: "That game's result depended on who was on which team, so it stands as played." });
  if (m.includes("RECREDIT_IN_REVIEW"))
    return new TRPCError({ code: "PRECONDITION_FAILED", message: "That game is open for score edits. Finish the review, then re-credit it." });
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The re-credit couldn't be saved. Nothing was changed — try again." });
}

export async function applyRecredit(
  supabase: SupabaseClient,
  input: {
    tripId: string;
    competitionId: string;
    userId: string;
    expectedTeamId: string | null;
    games: { gameId: string; fingerprint: string }[];
  }
): Promise<{ batchId: string; gameIds: string[] }> {
  const p = await plan(supabase, input);
  // The preview's destination must still be the destination. The database
  // checks this too, under a lock; checking here first avoids computing a
  // board for a change that is already stale.
  if (p.toTeamId !== input.expectedTeamId) throw new TRPCError({ code: "CONFLICT", message: RECREDIT_STALE_MESSAGE });

  const chosen = input.games.map((sel) => {
    const e = p.eligible.find((x) => x.game.id === sel.gameId);
    if (!e) {
      const standing = p.standing.find((x) => x.gameId === sel.gameId);
      if (standing?.reason === "team_dependent") throw refusal({ message: "RECREDIT_TEAM_DEPENDENT" });
      if (standing?.reason === "in_review") throw refusal({ message: "RECREDIT_IN_REVIEW" });
      throw new TRPCError({ code: "CONFLICT", message: RECREDIT_STALE_MESSAGE });
    }
    return { ...e, fingerprint: sel.fingerprint };
  });

  const { before, after } = await beforeAndAfter(supabase, input.competitionId, chosen);
  const items = chosen.map((c) => ({
    game_id: c.game.id,
    fingerprint: c.fingerprint,
    team_rows: c.teamRows,
    before: { teams: before.get(c.game.id) ?? [] },
    after: { teams: after.get(c.game.id) ?? [] },
  }));
  const { data, error } = await supabase.rpc("recredit_games", {
    p_competition_id: input.competitionId,
    p_user_id: input.userId,
    p_expected_team_id: input.expectedTeamId,
    p_items: items,
  });
  if (error) throw refusal(error);
  return { batchId: data as string, gameIds: chosen.map((c) => c.game.id) };
}
