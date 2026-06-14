import type { SupabaseClient } from "@supabase/supabase-js";
import { playerStats, computeRack, type RackPlayer, type Team } from "@/lib/rackNStack";
import { effectiveStrokes } from "@/lib/handicap";
import { isPerMatch } from "@/lib/pointsDistribution";

/**
 * DB-persist side of rack-n-stack. Builds the SAME read-model the live client
 * board uses (shared `computeRack` — CLAUDE.md #8): net-to-par per player from
 * `score_entries` + `handicap_strokes` + the game's par/index, grouped by the
 * competition's two teams (via `team_assignments`), sorted and rank-paired. The
 * outcome is TEAM points (slot wins; halves = ½) distilled to `game_results`
 * (`entity_type='team'`). Slots are NOT persisted (derived read-model only).
 *
 * Rack is a set of rank-paired mini-matches, so it scores PER-MATCH (each slot
 * won = the game's per-match value; a halve = ½). When the game is configured
 * per_match (`{type:'per_match', value}`), we write the realized team points ×
 * value as `raw_score` with `position=null` — the shape the competition
 * leaderboard's per_match branch reads (value × matchCount available, awarded
 * from raw_score). A legacy/unconfigured rack (no per_match distribution) keeps
 * the placement shape (`position` = rank), so nothing already on a board breaks.
 *
 * `competition_points_earned` stays null. Computed in 'current' mode (the
 * canonical result; both display modes converge at 18 holes).
 */

export interface RackTeamOutcome {
  teamId: string;
  points: number;
  position: number;
}

interface SchemaShape {
  units?: { metadata?: { par?: number[]; handicap_index?: number[] } };
}

export async function computeRackNStackResults(
  supabase: SupabaseClient,
  gameId: string
): Promise<RackTeamOutcome[]> {
  const { data: game } = await supabase
    .from("games")
    .select("scorecard_schema, game_type_id, competition_id, points_distribution")
    .eq("id", gameId)
    .maybeSingle();
  if (!game?.competition_id) return []; // rack needs a competition (2 teams)

  // Per-match scoring (each slot = `value` pts) when configured so; else the
  // legacy placement shape (rank). value defaults to 1 (one point per slot won).
  const perMatch = isPerMatch(game.points_distribution);
  const value = perMatch ? (game.points_distribution as { value: number }).value : 1;

  // Effective par/index: the game's course snapshot, else its template default.
  let schema = game.scorecard_schema as SchemaShape | null;
  if (!schema?.units?.metadata?.par && game.game_type_id) {
    const { data: tmpl } = await supabase
      .from("game_type_templates")
      .select("scorecard_schema")
      .eq("id", game.game_type_id as string)
      .maybeSingle();
    schema = (tmpl?.scorecard_schema as SchemaShape | null) ?? null;
  }
  const par = schema?.units?.metadata?.par;
  const strokeIndex = schema?.units?.metadata?.handicap_index;
  if (!par || !strokeIndex) return [];
  const coursePar = par.reduce((a, p) => a + p, 0);

  // user_id → team_id, for this game's competition (the two teams).
  const { data: assigns } = await supabase
    .from("team_assignments")
    .select("user_id, team_id")
    .eq("competition_id", game.competition_id as string);
  const teamOf = new Map<string, string>();
  for (const a of assigns ?? []) teamOf.set(a.user_id as string, a.team_id as string);
  const teamIds = [...new Set([...teamOf.values()])].sort(); // deterministic A/B
  if (teamIds.length < 2) return []; // need exactly the two competing teams
  const slot: Record<string, Team> = { [teamIds[0]]: "A", [teamIds[1]]: "B" };

  const { data: parts } = await supabase
    .from("game_participants")
    .select("user_id, handicap_strokes")
    .eq("game_id", gameId);
  const hcap = new Map<string, number>();
  for (const p of parts ?? []) hcap.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));

  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, unit_label, value")
    .eq("game_id", gameId)
    .eq("participant_type", "user");
  const gross = new Map<string, Record<string, number>>();
  for (const e of entries ?? []) {
    if (e.value == null) continue;
    const pid = e.participant_id as string;
    if (!gross.has(pid)) gross.set(pid, {});
    gross.get(pid)![e.unit_label as string] = e.value as number;
  }

  const players: RackPlayer[] = [];
  for (const p of parts ?? []) {
    const uid = p.user_id as string;
    const teamId = teamOf.get(uid);
    if (!teamId || !(teamId in slot)) continue; // only the two competing teams
    players.push({
      id: uid,
      team: slot[teamId],
      stats: playerStats(gross.get(uid) ?? {}, hcap.get(uid) ?? 0, par, strokeIndex),
    });
  }

  const { points } = computeRack(players, "current", coursePar);
  const teamPoints: Record<string, number> = { [teamIds[0]]: points.A, [teamIds[1]]: points.B };

  // position: higher points lead (ties share 1).
  const ranked = teamIds.slice().sort((x, y) => teamPoints[y] - teamPoints[x]);
  const position = (id: string) =>
    teamPoints[id] === teamPoints[ranked[0]] ? 1 : 2;

  await supabase.from("game_results").delete().eq("game_id", gameId);
  const rows = teamIds.map((teamId) => ({
    id: crypto.randomUUID(),
    game_id: gameId,
    entity_id: teamId,
    entity_type: "team" as const,
    // per_match: realized slot points × value as raw_score (no position) — the
    // shape the leaderboard's per_match branch reads. placement: rank position.
    raw_score: perMatch ? teamPoints[teamId] * value : null,
    points: teamPoints[teamId],
    position: perMatch ? null : position(teamId),
    competition_points_earned: null,
  }));
  if (rows.length > 0) await supabase.from("game_results").insert(rows);

  return teamIds.map((teamId) => ({ teamId, points: teamPoints[teamId], position: position(teamId) }));
}
