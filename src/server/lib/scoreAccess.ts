import type { SupabaseClient } from "@supabase/supabase-js";
import { maybeRowOrThrow, rowsOrThrow } from "./rowOrThrow";
import { canEditGame, type TripRole } from "@/server/middleware";
import { memberCanScoreUnit, type ScoreUnitMatch, type ScoreUnitSide } from "@/lib/scoreUnit";

/**
 * canWriteScore — the SERVER source of truth for "may this caller write THIS
 * score?" (score-entry permissions). Owner / Organizer / delegate-of-this-game →
 * any unit (via `canEditGame`, the reused elevated-tier check). A plain member →
 * only the unit they participate in, resolved per format by `memberCanScoreUnit`
 * (the pure, client-safe core the UI also reads).
 *
 * Called by both `scores.upsertEntry` and `scores.deleteEntry` so no write path
 * is left on the old "any member" rule. Defense-in-depth: RLS on `score_entries`
 * enforces the same rule via `can_score_unit()` for direct (non-tRPC) writes.
 */
type ScoreCtx = {
  supabase: { from: (t: string) => unknown };
  user: { id: string } | null;
  membershipCache: Map<string, Promise<TripRole>>;
};

export async function canWriteScore(
  ctx: ScoreCtx,
  tripId: string,
  gameId: string,
  participantId: string,
  participantType: "user" | "play_group",
): Promise<boolean> {
  // Owner / Organizer / delegate of THIS game → any unit. Reuses the same helper
  // the rest of the game-edit surface uses (Phase 0 #3/#4), so the elevated tier
  // can't drift from the config/run gates.
  if (await canEditGame(ctx, tripId, gameId)) return true;

  const meId = ctx.user?.id;
  if (!meId) return false;

  const db = ctx.supabase as unknown as SupabaseClient;

  // Every read here goes through the rowOrThrow family (#1276). A failed read
  // used to come back as `null` and answer `false`, which the score write turns
  // into a terminal FORBIDDEN, and a terminal refusal clears the score outbox:
  // a database blip lost the score on the next reload. A failure now throws a
  // retryable 500, which the outbox keeps and re-sends.

  // The game TYPE decides cart-scoping (rack) vs individual (stroke) — NOT whether the
  // target is grouped (089 made stroke groupings mandatory, so grouped ≠ rack).
  const gameRow = maybeRowOrThrow(
    await db.from("games").select("game_type_id").eq("id", gameId).maybeSingle(),
    "game's format"
  );
  const groupScoped = (gameRow as { game_type_id: string | null } | null)?.game_type_id === "gtt_rack_n_stack";

  // This game's matches (empty for stroke + rack). side_a/side_b are jsonb
  // {type,id}; an empty slot stays null.
  const matchRows = rowsOrThrow(
    await db.from("game_matches").select("side_a, side_b").eq("game_id", gameId),
    "game's matches"
  );
  const matches: ScoreUnitMatch[] = ((matchRows as { side_a: ScoreUnitSide | null; side_b: ScoreUnitSide | null }[] | null) ?? []).map(
    (r) => ({ side_a: r.side_a, side_b: r.side_b }),
  );

  // The scorer's own participant row (+ the target user's, for rack) — one query.
  const wantUsers = participantType === "user" ? [meId, participantId] : [meId];
  const partRows = rowsOrThrow(
    await db.from("game_participants").select("user_id, play_group_id").eq("game_id", gameId).in("user_id", wantUsers),
    "game's players"
  );
  const parts = (partRows as { user_id: string; play_group_id: string | null }[] | null) ?? [];
  const meRow = parts.find((p) => p.user_id === meId);
  const targetRow = parts.find((p) => p.user_id === participantId);

  return memberCanScoreUnit({
    meId,
    participantId,
    participantType,
    matches,
    myPlayGroupId: meRow?.play_group_id ?? null,
    targetPlayGroupId: participantType === "user" ? targetRow?.play_group_id ?? null : null,
    meIsParticipant: !!meRow,
    groupScoped,
  });
}
