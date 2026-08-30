import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { picksEverOpened, picksRevealed, type PickemClock } from "@/lib/pickemLifecycle";
import {
  pickemFinalize,
  type PickemFinalizeInput,
  type PickemFinalizeResult,
} from "@/lib/pickemFinalize";
import { effectiveDistribution, type PointsDistribution } from "@/lib/pointsDistribution";
import type { ScoredPick } from "@/lib/pickemScoring";
import { writeGameResults, type WriteFailureMode } from "./writeGameResults";

/**
 * The DB half of pick'em's finalize — CLAUDE.md #8's split, applied to the fifth
 * engine.
 *
 * The rule (what this game pays each team) is `src/lib/pickemFinalize.ts`, which
 * is client-safe and composes the board's own functions rather than computing
 * anything of its own. This module reads, refuses, and writes.
 *
 * ── THE REFUSAL IS A DOMAIN RULE, AND IT IS *NOT* AN RLS ONE ────────────────
 *
 * A finalize records what the sheets say. While picking is open they can still
 * change, and nothing recomputes `game_results` afterwards — the finalize is
 * pick'em's only writer of that table. So finalizing early does not produce a
 * wrong number so much as a number that silently stops matching the sheets it
 * came from, on a board that gives no sign of it. That is the reason to refuse,
 * and the runner has one tap that clears it.
 *
 * ── The reason it is NOT an RLS one, written down because I got it wrong ────
 *
 * The first version of this gate was justified by `pickem_picks_select`: that
 * policy hides an unrevealed sheet, so an early finalize would read back the
 * runner's own sheet alone and award a cup on it. It reads well and it is false.
 *
 * MEASURED, with the gate removed and picks open: the cup was awarded correctly
 * to the opponent's better sheet. The policy has a THIRD arm —
 * `_pickem_can_proxy_for` — under which staff read every sheet, and every caller
 * who can reach this code is staff, because `requireGameEdit` is the same
 * owner/organizer/delegate set. The reveal arm never binds here.
 *
 * Worth keeping rather than quietly deleting, in both directions: nobody should
 * relax this gate believing the data argument was its point, and nobody should
 * add a defensive re-read believing the sheets arrive incomplete. They do not.
 *
 * ── Two states, two sentences ──────────────────────────────────────────────
 *
 * Never opened and currently open are both "not revealed", and one message for
 * both would send half its readers to a button that is not on their screen. A
 * game that never opened is told to start picking; a game mid-picks is told to
 * close it.
 *
 * ── What this does NOT do ──────────────────────────────────────────────────
 *
 * It does not decide anything. Every figure comes back from `pickemFinalize`,
 * which is the same function a pre-finalize preview calls, so what the runner is
 * shown and what is recorded are one computation rather than two that agree.
 */

/** The competition context the resolution needs. Null for a standalone game,
 *  which has no teams and therefore nothing to award. */
interface PickemCompetition {
  /** `competitions.scoring_model` — a points cup overrides `roll_up` entirely. */
  pointsMode: boolean;
  teams: { id: string; memberIds: string[] }[];
}

export interface PickemResultsOptions {
  /**
   * The finalize path passes `"throw"` (#776) — a game marked complete with an
   * empty results table is worse than one that did not finish, and the compute is
   * idempotent so re-tapping recovers.
   */
  onFailure?: WriteFailureMode;
}

/**
 * Compute and persist a pick'em game's cup award.
 *
 * Returns what was decided so the caller can report it — the resolution used,
 * the per-team points, and how many contests were never resolved (which the
 * runner was warned about before pressing the button, and which score zero for
 * everyone exactly as a cancellation does).
 */
export async function computePickemResults(
  supabase: SupabaseClient,
  gameId: string,
  opts: PickemResultsOptions = {}
): Promise<PickemFinalizeResult> {
  const { data: game } = await supabase
    .from("games")
    .select("id, competition_id, points_total, points_distribution")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  }

  const { data: cfg } = await supabase
    .from("pickem_games")
    .select("picks_opened_at, picks_deadline, picks_locked_at, roll_up, use_confidence")
    .eq("game_id", gameId)
    .maybeSingle();

  /**
   * THE GATE — a game still taking picks is not over. See the header for why
   * this is a domain rule and explicitly not an RLS one.
   *
   * A missing `pickem_games` row is an unconfigured game and fails it as
   * never-opened: the clock has not started.
   */
  const clock: PickemClock = {
    picksOpenedAt: (cfg?.picks_opened_at as string | null) ?? null,
    picksDeadline: (cfg?.picks_deadline as string | null) ?? null,
    picksLockedAt: (cfg?.picks_locked_at as string | null) ?? null,
  };
  if (!picksRevealed(clock)) {
    throw new TRPCError({
      code: "CONFLICT",
      // Each names the button that IS on the runner's panel in that state.
      message: picksEverOpened(clock)
        ? "Close picking before finalizing — sheets are still being entered."
        : "Start picking first — this game has no sheets to score.",
    });
  }

  const [slateRes, picksRes, matchRes, compRes] = await Promise.all([
    supabase
      .from("pickem_slate_games")
      .select("id, multiplier, result")
      .eq("game_id", gameId),
    /**
     * EVERY sheet, and the policy is the gate rather than a branch here — the
     * same shape `pickem.get` uses, for the same reason. Past the refusal above
     * the game is revealed, so this returns the field.
     */
    supabase
      .from("pickem_picks")
      .select("user_id, slate_game_id, pick, confidence")
      .eq("game_id", gameId),
    supabase
      .from("game_matches")
      .select("side_a, side_b, point_value")
      .eq("game_id", gameId),
    readCompetition(supabase, (game.competition_id as string | null) ?? null),
  ]);

  const sheets: Record<string, ScoredPick[]> = {};
  for (const row of picksRes.data ?? []) {
    const pick = row.pick as "away" | "home" | null;
    // A stored row with no side is a partial sheet's untouched game (migration
    // 166). It is not a pick and must not be scored as one.
    if (pick == null) continue;
    const uid = row.user_id as string;
    (sheets[uid] ??= []).push({
      slateGameId: row.slate_game_id as string,
      pick,
      confidence: (row.confidence as number | null) ?? null,
    });
  }

  const comp = compRes;
  const input: PickemFinalizeInput = {
    slate: (slateRes.data ?? []).map((g) => ({
      id: g.id as string,
      result: (g.result as PickemFinalizeInput["slate"][number]["result"]) ?? null,
      multiplier: (g.multiplier as number | null) ?? 1,
    })),
    sheets,
    matches: (matchRes.data ?? []).map((m) => ({
      sideAId: sideUserId(m.side_a),
      sideBId: sideUserId(m.side_b),
      pointValue: (m.point_value as number | null) ?? null,
    })),
    teams: comp?.teams ?? [],
    useConfidence: (cfg?.use_confidence as boolean | null) ?? true,
    rollUp: ((cfg?.roll_up as string | null) ?? "team_totals") as PickemFinalizeInput["rollUp"],
    pointsMode: comp?.pointsMode ?? false,
    pointsTotal: (game.points_total as number | null) ?? null,
    /**
     * The SHARED accessor, not `isPlacement(d) ? d.values : []`. Pick'em never
     * writes a `points_distribution` at all — `set_pickem_points_total` is its
     * only points writer and it sets the total alone — so this is the winner-
     * takes-all fallback in every real game, and the ternary would have paid
     * nobody. Same call the board's own placement schedule makes.
     */
    distribution: effectiveDistribution(
      game.points_distribution as PointsDistribution | null,
      game.points_total as number | null
    ),
  };

  const outcome = pickemFinalize(input);

  /**
   * ONE writer, two row shapes — see `PickemFinalizeWrite` for why the shapes
   * differ. `raw_score` mirrors `position` on the placement rows exactly as
   * `writeManualResults` does, so the leaderboard's `position ?? raw_score` read
   * lands on the same value whichever column it reaches for.
   *
   * `scope: "all"` because a finalize replaces the whole record: a game whose
   * resolution changed (a cup switched to points, a roll-up flipped) must not
   * keep the previous shape's rows beside the new ones and be counted twice.
   */
  const rows =
    outcome.write.kind === "placements"
      ? outcome.write.rows.map((r) => ({
          id: crypto.randomUUID(),
          entity_id: r.entityId,
          entity_type: "team" as const,
          position: r.position,
          raw_score: r.position,
        }))
      : outcome.write.rows.map((r) => ({
          id: crypto.randomUUID(),
          entity_id: r.entityId,
          entity_type: "team" as const,
          position: null,
          raw_score: r.points,
        }));

  await writeGameResults(supabase, {
    gameId,
    rows,
    scope: { kind: "all" },
    onFailure: opts.onFailure,
  });

  return outcome;
}

/**
 * The cup's teams and their rosters.
 *
 * Null for a STANDALONE game. A pick'em with no competition has nobody to award
 * — `pickemFinalize` returns an empty award map and the write clears the table,
 * which is the honest record of a game that pays no cup.
 */
async function readCompetition(
  supabase: SupabaseClient,
  competitionId: string | null
): Promise<PickemCompetition | null> {
  if (!competitionId) return null;
  const [compRes, teamRes, assignRes] = await Promise.all([
    supabase.from("competitions").select("scoring_model").eq("id", competitionId).maybeSingle(),
    supabase.from("teams").select("id").eq("competition_id", competitionId),
    supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
  ]);

  const memberIds = new Map<string, string[]>();
  for (const t of teamRes.data ?? []) memberIds.set(t.id as string, []);
  for (const a of assignRes.data ?? []) {
    memberIds.get(a.team_id as string)?.push(a.user_id as string);
  }

  return {
    pointsMode: (compRes.data?.scoring_model as string | null) === "points",
    teams: [...memberIds.entries()].map(([id, ids]) => ({ id, memberIds: ids })),
  };
}

/**
 * The USER behind a `game_matches` side.
 *
 * Pick'em pairs people, never play groups — its builder writes `{type:'user'}`
 * refs — so anything else is a side this format did not create and is treated as
 * unpaired rather than guessed at. Reading the id without checking the type is
 * how a play-group id would end up looked up in `sheets` and score zero while
 * looking like a real side.
 */
function sideUserId(side: unknown): string | null {
  if (side == null || typeof side !== "object") return null;
  const ref = side as { type?: unknown; id?: unknown };
  if (ref.type !== "user" || typeof ref.id !== "string") return null;
  return ref.id;
}
