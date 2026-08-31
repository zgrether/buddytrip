import type { SupabaseClient } from "@supabase/supabase-js";
import { startedGameIds } from "./gameStarted";

/**
 * The "don't destroy history by removing a person" guard (#951, extended #997).
 *
 * Removing someone from a trip deletes their `trip_members` row, and
 * `delete_orphan_guest_user` then hard-deletes their `users` row once they are
 * on no trips. Nothing cascades usefully and almost nothing errors, so the
 * removal is a SILENT SUCCESS that takes their history with it.
 *
 * ── THE RULE: participation without a result is a PLAN. With a result it is
 *    HISTORY. Plans are removable; history is not. ────────────────────────────
 *
 * Being drawn into a bracket months before the trip is a plan — remove them and
 * the slot becomes a bye, which the tree builder already handles at every
 * entrant count. Winning a match is a result. The same shape applies to a
 * `game_participants` row in a game nobody has scored: slotted in for a round
 * that hasn't happened.
 *
 * This is the definition, expressed as predicates over existing columns. It is
 * written here because it is the thing that would otherwise be re-derived
 * differently by the next person — which is exactly how the gap below opened:
 *
 *   | Concept                  | Signal                                          |
 *   |--------------------------|-------------------------------------------------|
 *   | own scores (result)      | `score_entries.participant_id` — theirs or their side's |
 *   | own game result (result) | `game_results.entity_id` — theirs or their side's |
 *   | decided match (result)   | `game_matches.result IS NOT NULL` or `status='complete'`, with them a side |
 *   | decided bracket (result) | `bracket_matches.winner_entrant_id IS NOT NULL`, their entrant a side |
 *   | played game (result)     | `game_participants` row, OR a `pickem_picks` sheet, in a game anyone has PLAYED |
 *   | draw only (PLAN)         | `bracket_entrant_members` with no decided match involving them |
 *   | slotted only (PLAN)      | `game_participants` in a game nobody has played |
 *   | sheet only (PLAN)        | `pickem_picks` in a game with no slate result yet |
 *   | receipts (always result) | `expenses.paid_by_user_id`, `expense_splits.user_id` |
 *
 * Note it never reads `bracket_matches.bracket`. The question is "does a decided
 * result involve this person", which is independent of bracket STRUCTURE — so
 * migration 127's `lower`/`final` values, and the double-elim work generally,
 * cannot change this guard's answer.
 *
 * ── A PERSON is not the only shape a side comes in (#1016) ─────────────────
 * Two of the signals above are asked of a SIDE, and a side is a person only in
 * 1v1. A 2v2 side is a minted `play_group` — `{type:"play_group", id:<pgId>}` in
 * the JSONB, and `entity_type='play_group'` in `game_results` (`mkResult` keys
 * the row by the side ref's own id). So comparing a side id to a USER id answers
 * "no" for every doubles match ever played, and answers it silently.
 *
 * Prod's completed 2v2 game carries four `game_results` rows — two `play_group`,
 * two `team`, and NOT ONE keyed to a user. `score_entries` is the third: a 2v2
 * entry is one row per SIDE, written with `participant_type='play_group'`. All
 * three therefore resolve a side through `game_participants.play_group_id`,
 * which is what makes a person a member of a doubles side (`setPairings`'
 * `mkSide`). That is also why the queries run in two rounds — a side id is not
 * knowable until the participant rows come back.
 *
 * ── PLAYED is not a synonym for `score_entries` (#1016) ────────────────────
 * `entry_mode='outcome'` match play stores the score in `match_hole_outcomes` —
 * read directly by `computeMatchPlayResults`, with no gross, no handicap, no
 * stroke index. An outcome game has ZERO `score_entries` rows however many holes
 * are decided, so a "has anyone played this?" probe over `score_entries` alone
 * reports an 18-hole match as untouched.
 *
 * This exact derivation had already been made, and already needed the second
 * source: `competitionLeaderboard` runs a `match_hole_outcomes` query beside its
 * `score_entries` one, commented "an outcome game never has score_entries rows,
 * so it needs its OWN 'started' source". This guard was the same derivation
 * WITHOUT that source — so the board could show a game underway while the guard
 * held that nobody had played it.
 *
 * The two gaps compounded: `matchOutcomes.setHole` deliberately does not run
 * `computeMatchPlayResults` (no per-write recompute, mirroring `scores`), so
 * until `games.finish` an outcome game has no `game_results` and no decided
 * `game_matches` either. Every column this guard read was empty, at any side
 * shape, for a game seventeen holes in.
 *
 * ── AND THE FIX FOR IT WAS ITSELF A THIRD COPY (#1151/#1018) ───────────────
 * #1016 answered "has anyone played this" by adding the second table beside the
 * first. That was the right answer to the wrong-sized question: it enumerated
 * the shapes that existed THEN, and two formats have arrived since that write
 * neither table. A pick'em records outcomes in `pickem_slate_games.result` and
 * non-golf Matches declares `game_matches.result`, so the two-source probe went
 * on reporting "nobody has played this" for a pick'em at every stage of its
 * life — a live one, and equally a FINALIZED one already paying the cup.
 *
 * The list is now `public.game_started` (migrations 161/170) and this guard
 * reads it through `gameStarted.ts` rather than keeping a private copy of the
 * list. That is what makes the next format's arrival a no-op here instead of a
 * fourth instance: the sweep unit is the PREDICATE, and it now has one home.
 *
 * Note the symmetry with the paragraph above. #1016's lesson was that the
 * derivation already existed elsewhere and should have been reused; the same
 * sentence applies to #1016's own fix, one level out.
 *
 * ── A PICK'EM PLAYER IS NOT ALWAYS A `game_participants` ROW ───────────────
 * Knowing the game started is only half of it — the guard must also see that
 * this person is IN it, and for pick'em the participant row is present in only
 * one of the three shapes. `save_pickem_matches` reconciles `game_participants`
 * when it writes the pairing, so a PAIRED head-to-head player has one. A
 * POINTS-mode game has no matches at all, and an UNPAIRED player's sheet
 * deliberately outlives their pairing, so neither has a row. The sheet is the
 * membership signal that covers all three.
 *
 * ── Money is a result the moment it exists ────────────────────────────────
 * A receipt has no plan phase: it records money that already moved. Both
 * directions block — the payer, and everyone split into it. The second is the
 * one that gets dismissed: "Charlie hasn't done anything" feels true right up
 * until you notice removing him changes what everyone else owes, because the
 * total no longer reconciles.
 *
 * ── Why ONE guard rather than a cascade per table ──────────────────────────
 * `game_matches.side_a/side_b` hold `{type,id}` inside JSONB, which cannot be
 * an FK and therefore cannot cascade. Of the nine columns recording a
 * contribution, ONE currently refuses a delete, four are structurally invisible
 * to the database, and five actively CASCADE. So an application guard is the
 * only available mechanism; FK RESTRICT is a backstop for the six it can see,
 * never the primary defence.
 *
 * ── Why this one is APPLICATION-layer, unlike #824's and #957's guards ─────
 * The criterion is whether bypassing the app GAINS the actor something:
 *
 *   #824 role trigger (DB)   an Organizer setting their own role to Owner
 *                            gains a privilege.
 *   #957/#123 Owner-row (DB) removing the Owner strands the trip for everyone.
 *   THIS ONE (app)           the actor is ALREADY entitled to delete the row.
 *                            Bypassing gains nothing; the consequence is a mess
 *                            on their own trip, and it is recoverable.
 */

/** Why a game blocks. Ordered roughly by how irreplaceable the data is. */
export type BlockReason =
  | "scores"
  | "result"
  | "decided-match"
  | "decided-bracket"
  | "played-game";

export interface GameBlocker {
  gameId: string;
  gameName: string;
  reasons: BlockReason[];
  /** Real per-hole scores exist for THEM. The half that is irreplaceable. */
  hasScores: boolean;
}

export interface ContributionBlockers {
  games: GameBlocker[];
  /** Receipts they paid for. */
  expensesPaid: number;
  /** Receipts someone else paid that they are split into. */
  expenseSplits: number;
}

export function hasContributions(b: ContributionBlockers): boolean {
  return b.games.length > 0 || b.expensesPaid > 0 || b.expenseSplits > 0;
}

const EMPTY: ContributionBlockers = { games: [], expensesPaid: 0, expenseSplits: 0 };

/**
 * Everything in `tripId` that makes removing `userId` destroy a result.
 *
 * An empty result means removing them is clean — the common case, and it must
 * stay frictionless: someone added by mistake, or who dropped out during
 * planning before anything happened, deletes without argument.
 */
export async function findContributionBlockers(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<ContributionBlockers> {
  const [{ data: games, error: gamesErr }, paid, splits] = await Promise.all([
    supabase.from("games").select("id, name").eq("trip_id", tripId),
    supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .eq("paid_by_user_id", userId),
    // expense_splits has no trip_id — scope through the parent expense.
    supabase
      .from("expense_splits")
      .select("expense_id, expenses!inner(trip_id)", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("expenses.trip_id", tripId),
  ]);
  if (gamesErr) throw new Error(`Failed to read the trip's games: ${gamesErr.message}`);
  if (paid.error) throw new Error(`Failed to read expenses: ${paid.error.message}`);
  if (splits.error) throw new Error(`Failed to read expense splits: ${splits.error.message}`);

  const money = { expensesPaid: paid.count ?? 0, expenseSplits: splits.count ?? 0 };

  const gameIds = (games ?? []).map((g) => g.id as string);
  if (gameIds.length === 0) return { ...EMPTY, ...money };

  // ── Round 1: who they are in these games, and what the games look like ────
  // Everything here is answerable from their user id alone. The queries that
  // need to know their SIDE ids wait for round 2, because a doubles side id is
  // only discoverable from the participant rows this round returns.
  const [parts, decidedMatches, entrantRows, sheets] = await Promise.all([
    supabase
      .from("game_participants")
      .select("game_id, play_group_id")
      .eq("user_id", userId)
      .in("game_id", gameIds),
    // Decided matches only, filtered for THEM in JS rather than with a
    // PostgREST `->>` filter on the JSONB. The filter form would be fewer rows,
    // but its syntax is the one thing here that cannot be checked without a
    // live PostgREST — and a mistyped filter returns the WRONG SET rather than
    // an error, which is precisely how a guard silently stops guarding.
    // `game_matches` is tens of rows per trip; the trade is not close.
    supabase
      .from("game_matches")
      .select("game_id, result, status, side_a, side_b")
      .in("game_id", gameIds),
    supabase.from("bracket_entrant_members").select("entrant_id").eq("user_id", userId),
    // PICK'EM MEMBERSHIP (#1151). A sheet is the participation, and it is the
    // only signal for two of the three shapes a pick'em player comes in:
    //
    //   paired head-to-head  `save_pickem_matches` reconciles `game_participants`
    //                        in the same transaction as the pairing, so the row
    //                        above already finds them
    //   POINTS MODE          the format has no matches at all, so nobody in the
    //                        game has a participant row
    //   UNPAIRED in H2H      the sheet deliberately SURVIVES being unpaired, so
    //                        the participant row is gone and the sheet is not
    //
    // A ROW IS A PICK. `pickem_picks.pick` is NOT NULL (migration 146, verified
    // against the live schema and never relaxed — 166's header states the
    // consequence deliberately: "no row exists for a game with no pick. That is
    // the accepted cost of keeping 'has any rows' meaning 'has submitted
    // something'"). Every row is written by `_pickem_write_sheet` from an item
    // the person or their proxy supplied; nothing seeds a row per participant,
    // so this cannot degenerate into blocking the whole roster.
    //
    // Rows, not a `head:true` count, because the answer needed is WHICH games —
    // and unlike the played-probe this is filtered to ONE user, so the reply is
    // bounded by (their games × slate size), tens of rows, not the unfiltered
    // hundreds the 1000-row cap note below is about.
    supabase.from("pickem_picks").select("game_id").eq("user_id", userId).in("game_id", gameIds),
  ]);
  for (const [what, res] of [
    ["game participants", parts],
    ["matches", decidedMatches],
    ["bracket entrants", entrantRows],
    ["pick'em sheets", sheets],
  ] as const) {
    if (res.error) throw new Error(`Failed to read ${what}: ${res.error.message}`);
  }

  // Every id this person answers to as a SIDE: themselves, plus any doubles
  // group they are a member of. `game_participants.play_group_id` is what
  // `setPairings`' `mkSide` writes when it mints a 2v2 side, so it is the only
  // link from a person to the id their side is recorded under — and the same id
  // `scores.upsertEntry` writes as `participant_id` for a 2v2 entry.
  const mySideIds = new Set<string>([userId]);
  const myGameIds = new Set<string>();
  for (const r of parts.data ?? []) {
    myGameIds.add(r.game_id as string);
    const pgId = r.play_group_id as string | null;
    if (pgId) mySideIds.add(pgId);
  }
  // A sheet makes them a member of the game exactly as a participant row does.
  // NOT added to `mySideIds`: a pick'em side is `{type:"user", id:<user_id>}`,
  // so `userId` already covers them there — a sheet mints no second id the way
  // a doubles `play_group` does.
  for (const r of sheets.data ?? []) myGameIds.add(r.game_id as string);
  const sideIds = [...mySideIds];

  // ── Round 2: what has been PLAYED, and what is recorded under their sides ──
  //
  // "Has anyone played this game?" is asked as a COUNT per game they are in,
  // not by fetching the games' score rows and collecting the distinct ids the
  // reply happens to contain. PostgREST caps a response at 1000 rows, and a
  // scored 16-player round is 288 of them — so the row-collecting form would
  // start dropping game ids out of the "played" set a few games into a real
  // trip, and every dropped id is a game this guard then reports as unplayed.
  // A guard that gets more permissive the more a trip is used is worse than no
  // guard. `head: true` returns the count and no rows, so it cannot be capped.
  //
  // ONE read of `game_started` (migrations 161/170) for the whole trip, which
  // REPLACES the per-game fan-out that used to live here — two `head:true`
  // counts per game they participate in, over `score_entries` and
  // `match_hole_outcomes`.
  //
  // Those two tables are the golf shapes and only the golf shapes. A pick'em
  // records its outcomes in `pickem_slate_games.result` and non-golf Matches in
  // `game_matches.result`, so the old probe answered "nobody has played this"
  // for a pick'em at EVERY stage of its life — including one already finalized
  // and paying the cup (#1151). The view carries an arm per format, and 161's
  // header is explicit that a new format adds its arm there rather than a
  // fourth query at a call site: this is that call site taking it up.
  //
  // Also strictly cheaper — one request instead of 2N, and the 1000-row cap the
  // note above is about cannot reach a `SELECT DISTINCT` over game ids.
  const [ownScores, results, started] = await Promise.all([
    supabase
      .from("score_entries")
      .select("game_id")
      .in("participant_id", sideIds)
      .in("game_id", gameIds),
    supabase.from("game_results").select("game_id").in("entity_id", sideIds).in("game_id", gameIds),
    startedGameIds(supabase, gameIds),
  ]);
  if (ownScores.error) throw new Error(`Failed to read score entries: ${ownScores.error.message}`);
  if (results.error) throw new Error(`Failed to read game results: ${results.error.message}`);

  const reasons = new Map<string, Set<BlockReason>>();
  const add = (gameId: string, reason: BlockReason) => {
    if (!gameIds.includes(gameId)) return;
    const set = reasons.get(gameId) ?? new Set<BlockReason>();
    set.add(reason);
    reasons.set(gameId, set);
  };

  const scoredGameIds = new Set((ownScores.data ?? []).map((r) => r.game_id as string));
  scoredGameIds.forEach((id) => add(id, "scores"));

  // PLAN vs RESULT: membership only blocks once the game has been played by
  // somebody. Slotted into an unplayed round — or holding a sheet for a slate
  // nobody has resolved — is removable.
  //
  // Restricted to games they are IN, deliberately: `started` covers the whole
  // trip because one batch read is cheaper than a filtered one, but a game
  // being underway is not a reason to keep someone who has nothing to do with
  // it.
  for (const gid of myGameIds) if (started.has(gid)) add(gid, "played-game");

  for (const r of results.data ?? []) add(r.game_id as string, "result");

  for (const m of decidedMatches.data ?? []) {
    const decided = m.result !== null || m.status === "complete";
    if (!decided) continue;
    const sideId = (side: unknown) =>
      side && typeof side === "object" ? (side as { id?: string }).id : undefined;
    const a = sideId(m.side_a);
    const b = sideId(m.side_b);
    if ((a && mySideIds.has(a)) || (b && mySideIds.has(b))) {
      add(m.game_id as string, "decided-match");
    }
  }

  // Bracket: a draw is a plan. A decided match involving their entrant is not.
  const entrantIds = (entrantRows.data ?? []).map((r) => r.entrant_id as string);
  if (entrantIds.length > 0) {
    const { data: bm, error: bmErr } = await supabase
      .from("bracket_matches")
      .select("game_id, entrant_a_id, entrant_b_id, winner_entrant_id")
      .in("game_id", gameIds)
      .not("winner_entrant_id", "is", null);
    if (bmErr) throw new Error(`Failed to read bracket matches: ${bmErr.message}`);
    const mine = new Set(entrantIds);
    for (const r of bm ?? []) {
      if (mine.has(r.entrant_a_id as string) || mine.has(r.entrant_b_id as string)) {
        add(r.game_id as string, "decided-bracket");
      }
    }
  }

  const nameOf = new Map(
    (games ?? []).map((g) => [g.id as string, (g.name as string | null) ?? "Untitled game"])
  );
  const blockers: GameBlocker[] = [...reasons.entries()].map(([gameId, set]) => ({
    gameId,
    gameName: nameOf.get(gameId) ?? "Untitled game",
    reasons: [...set],
    hasScores: scoredGameIds.has(gameId),
  }));

  return { games: blockers, ...money };
}

/**
 * The refusal message.
 *
 * Counts PER CATEGORY, because "no" on its own is useless to someone deciding
 * whether this is one stray thing they could unwind or a real history. It must
 * also offer a next move — a refusal with no available action is a dead end,
 * and this codebase has produced three of those (the ownership-transfer message
 * with no eligible target, the disabled delete button with no stated reason,
 * and this one before it said anything actionable).
 */
export function contributionRefusalMessage(
  displayName: string,
  b: ContributionBlockers
): string {
  const clauses: string[] = [];

  if (b.games.length > 0) {
    const names = b.games.slice(0, 3).map((g) => `"${g.gameName}"`);
    const rest = b.games.length - names.length;
    const list = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
    const scored = b.games.filter((g) => g.hasScores).length;
    const g = (n: number) => `${n} game${n === 1 ? "" : "s"}`;
    // The count and the LIST must describe the same set. An earlier version
    // said "has scores in 1 game" and then named two, because the count came
    // from the scored subset while the list came from all blockers.
    const what =
      scored === 0
        ? `has results in ${g(b.games.length)}`
        : scored === b.games.length
          ? `has scores in ${b.games.length > 1 ? "all " : ""}${g(b.games.length)}`
          : `has results in ${g(b.games.length)}, with scores in ${scored}`;
    clauses.push(`${what}: ${list}`);
  }

  if (b.expensesPaid > 0) {
    clauses.push(`paid for ${b.expensesPaid} expense${b.expensesPaid === 1 ? "" : "s"}`);
  }
  if (b.expenseSplits > 0) {
    clauses.push(
      `is split into ${b.expenseSplits} ${b.expensesPaid > 0 ? "more" : `expense${b.expenseSplits === 1 ? "" : "s"}`}`
    );
  }

  const joined =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;

  // The next move is category-aware. "Enter a score for them" is the documented
  // workaround (GAME_FORMATS.md) for someone who can't play, and it is real
  // advice when a GAME is the blocker — but it is nonsense when the blocker is
  // a receipt, and a suggestion that doesn't apply is the same dead end as no
  // suggestion at all.
  const moves = [
    b.games.length > 0 ? "enter a score for them if they can't play" : null,
    "rename them if the name is wrong",
    "leave them on the roster",
  ].filter((x): x is string => x !== null);

  return (
    `${displayName} can't be removed — ${joined}. Removing them would change results ` +
    `other people are part of. You can ${moves.slice(0, -1).join(", ")}, or ` +
    `${moves[moves.length - 1]} — either way their history stays attached.`
  );
}
