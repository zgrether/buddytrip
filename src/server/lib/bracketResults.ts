import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import type { BracketDrawMatch } from "@/lib/bracket";
import { resolveDraw, matchKey, drawComplete, type WinnerBySeed } from "@/lib/bracketAdvance";
import { bracketPlacements } from "@/lib/bracketPlacements";
import { readBracketDraw } from "./bracketDraw";

/**
 * The DB-read wrapper over the pure bracket placement rule — CLAUDE.md #8's split,
 * applied to the fourth engine.
 *
 * The rule itself (who finished where) is `src/lib/bracketPlacements.ts`, which is
 * client-safe and has no idea a database exists. This module does the reading and
 * the refusing, then calls it. So the placement preview a finalize screen renders
 * and the record `games.finish` writes come from ONE function and cannot diverge —
 * which for a bracket matters more than usual, because the tree is derived rather
 * than stored and a second derivation would be a second answer to "who won".
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 * It does not write. `games.finish` commits the rows it returns through
 * `writeManualResults`, the same path the entered-order arm uses — a bracket
 * DERIVES its placements where a manual game types them, and that is the whole of
 * the difference. The spec's constraint ("do not write placements by a different
 * path than the manual arm") is satisfied by there being no second write, not by
 * two writes that happen to match.
 */

/** A placement row as `writeManualResults` takes it. `entityId` is a
 *  `bracket_entrants.id` — the entrant is the competitor (migration 119), and the
 *  roll-up to cup teams happens at READ time in the leaderboard. */
export interface BracketPlacementRow {
  entityId: string;
  position: number;
}

/**
 * Where every entrant finished, ready to commit.
 *
 * ── Refuses rather than posting half a bracket ──────────────────────────────
 * `drawComplete` is the gate, and it is the same predicate the play surface uses
 * to decide whether to offer the finalize CTA. It asks "is every match that CAN
 * be decided decided?", which is not the same as "does the final have a winner":
 * a draw carrying a consolation match is not finished while the play-off is
 * open, and posting there would record two tied thirds for a game that is about
 * to separate them.
 *
 * An empty draw fails the same gate — `drawComplete([])` is false — so a bracket
 * whose field was never built cannot be finalized into an empty result. That is
 * the read-side counterpart of migration 117's go-live gate rather than a
 * duplicate of it: 117 stops such a game going live, this stops one that somehow
 * did from posting nothing.
 */
export async function deriveBracketPlacements(
  supabase: SupabaseClient,
  gameId: string
): Promise<BracketPlacementRow[]> {
  const { matches, seedOf, idOfSeed, error } = await readBracketDraw(supabase, gameId);
  if (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to read the bracket draw: ${error}`,
    });
  }

  const draw: BracketDrawMatch[] = matches.map((m) => ({
    bracket: m.bracket,
    round: m.round,
    slot: m.slot,
    aSeed: seedOf(m.entrant_a_id),
    bSeed: seedOf(m.entrant_b_id),
  }));
  const winners: WinnerBySeed = {};
  for (const m of matches) winners[matchKey(m)] = seedOf(m.winner_entrant_id);

  const resolved = resolveDraw(draw, winners);
  if (!drawComplete(resolved)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This bracket still has matches to decide — record every result before posting it.",
    });
  }

  const placements = bracketPlacements(resolved);
  // `drawComplete` and a placeable draw are not quite the same claim: the pure
  // rule returns [] when there is no decided final to place anyone against.
  // Refusing here rather than writing an empty result keeps the game finishable
  // (status stays non-complete, the compute is idempotent, tapping Finish again
  // recovers) instead of locking it with nothing recorded.
  if (placements.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This bracket has no result to post yet.",
    });
  }

  return placements.map((p) => {
    const entityId = idOfSeed(p.seed);
    // Unreachable in practice — `idOfSeed` composes the deterministic id as a
    // fallback, and every placed seed came from a row we just read. Checked
    // anyway because the alternative is an INSERT with a null entity_id, which
    // the CHECK would refuse mid-finalize with a message about nothing.
    if (entityId === null) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `The bracket draw has no entrant for seed ${p.seed}.`,
      });
    }
    return { entityId, position: p.position };
  });
}
