/**
 * Bracket ADVANCEMENT — who occupies each match, derived from the winners below.
 *
 * Pure and client-safe, no server/DB deps (CLAUDE.md #8), and the companion to
 * `bracket.ts`: that module answers "what is the tree?", this one answers "who is
 * standing in it right now?". Both speak SEEDS, never people — which person or
 * pair holds a seed is `bracket_entrants`' business, and keeping the two apart is
 * what lets a re-seed change who plays whom without touching this logic.
 *
 * ── Derived, never materialised (migration 112's model) ─────────────────────
 * Later rounds are computed, not stored. `bracket_matches` persists round-1 seeds
 * and at most a `winner_entrant_id` per match; every other occupant in the tree
 * is a function of those. That is CLAUDE.md #11's rule — derive, don't snapshot —
 * and it is what makes an undo ONE COLUMN wide: clear a winner and everything
 * above it re-derives, with no cascade to unwind and no second write path that
 * could disagree. Picking the wrong winner is a certainty, so the cost of the fix
 * is a design constraint, not an afterthought.
 *
 * The same consequence in the other direction: nothing here writes, and nothing
 * here needs to be kept in sync. The ONE resolver feeds the bracket view, the
 * pick mutation's validation, and (later) the finalize's placement computation,
 * so a seat shown on screen and a seat the server will accept a pick for cannot
 * differ.
 */

import { roundCount, type BracketDrawMatch, type BracketSide } from "./bracket";

/** A match's identity within one game's draw — the same triple the schema makes
 *  UNIQUE, and the same one the config hash folds the table in by. */
export interface BracketMatchRef {
  bracket: BracketSide;
  round: number;
  slot: number;
}

/** Stable string form of a match's identity, for map keys. Mirrors the UNIQUE
 *  (bracket, round, slot) constraint, so two matches share a key only if the
 *  schema would have refused them both. */
export function matchKey(m: BracketMatchRef): string {
  return `${m.bracket}:${m.round}:${m.slot}`;
}

/** Recorded winners, keyed by `matchKey`, valued by the WINNING SEED. A match
 *  with no pick yet is absent (or null) — never zero. */
export type WinnerBySeed = Record<string, number | null | undefined>;

/** A draw match with its occupants resolved. */
export interface ResolvedMatch extends BracketDrawMatch {
  /** The seed occupying the A seat once advancement is applied, or null while
   *  the match below it is undecided. */
  aSeed: number | null;
  bSeed: number | null;
  /** The recorded winner, or null. Only ever one of this match's own occupants
   *  — see `winnerOf` for why a stale pick is dropped rather than trusted. */
  winnerSeed: number | null;
  /** Nobody to play: a round-1 seat with no opponent. Advances without a pick,
   *  and must never be offered as something to decide. */
  bye: boolean;
  /** Both seats known and no winner recorded — the matches actually waiting on
   *  someone. Drives "this match still needs a result" readouts. */
  playable: boolean;
  /**
   * Both seats known and somebody actually played — a real contest, whether or
   * not it has been decided yet.
   *
   * The difference from `playable` is ONLY whether a winner is already recorded,
   * and that difference is the whole of item 8: a decided match is still
   * DECIDABLE, because picking the other competitor is a legal, one-tap
   * correction (`games.pickWinner` accepts a straight replacement and never
   * required a clear first). Keying the board's tap targets on `playable` made
   * the loser's row go dead the moment anyone won, so switching a wrong pick
   * needed two taps and a round trip in between.
   *
   * A sibling field rather than a predicate re-derived in the view, so the next
   * bracket surface cannot answer "can I tap this?" differently (CLAUDE.md #24).
   */
  decidable: boolean;
  /**
   * NOBODY WILL EVER OCCUPY THIS ROW — not "both seats are null right now".
   *
   * The distinction Phase 2 named as the three seat states: filled, WAITING, and
   * PERMANENTLY EMPTY. `aSeed === null && bSeed === null` conflates the last two,
   * and it is only equivalent to this field in ROUND 1, where seats are seeded at
   * build time and there is no upstream to wait for. Everywhere else a row with
   * two null seats is usually just waiting on its feeders.
   *
   * A sibling field for the same reason `decidable` is one: three separate places
   * were each answering this question their own way, and two of the three were
   * answering it wrongly (see the header of `bracketDoubleAdvance.ts`). Derived
   * during resolution, where the feeder chain is actually known — a consumer
   * holding a single `ResolvedMatch` CANNOT compute it, which is precisely why
   * every consumer that tried got it wrong.
   */
  neverContested: boolean;
  /**
   * Who FORFEITED this match by withdrawing (ruling 8, migration 209): the
   * withdrawn seed(s) at a match NOT decided before they left. One seed is a
   * WALKOVER — the other side advanced with no pick; two means nobody is left
   * and the slot is empty (`neverContested`), which the next round treats as a
   * bye. Empty for every ordinary match.
   *
   * A walkover is NOT a bye, and the difference is the reason this field exists:
   * a bye has no loser, so a withdrawn entrant modelled as one would never be
   * placed and never lose a life. A forfeiter is eliminated outright, placed in
   * the round it withdrew, and in double elimination is never sent down.
   */
  forfeited: number[];
}

/**
 * Settle one match from its two seats — THE rule for walkovers, byes and empty
 * slots, so the three are one rule rather than three.
 *
 * A seat arrives as an occupant, or as nobody: WAITING (still to be decided
 * below) or EMPTY (`aEmpty`/`bEmpty`: nobody will ever come). A withdrawn
 * occupant counts as nobody — but only at a match not already decided: a
 * result recorded before the withdrawal is history and stands.
 *
 *   - nobody on either side     -> an empty slot (`neverContested`); the next
 *                                  round sees an EMPTY seat
 *   - nobody on one side, an    -> the present side advances with no pick: a
 *     occupant on the other        BYE if the empty side never had anyone, a
 *                                  WALKOVER if it was a withdrawn entrant
 *   - otherwise                 -> an ordinary match, waiting or played
 *
 * The resolver never needs to know WHY a side is empty, which is what lets a
 * chain of withdrawals resolve with no special case (Zach, 2026-10-08).
 *
 * A recorded winner counts ONLY IF that seed is one of this match's resolved
 * occupants (moved here from the old `winnerOf`, whose reasoning still holds): the
 * pool can be re-seeded, and `save_game_config` only refuses a rebuild once a
 * winner EXISTS (`HAS_PICKS`) — it cannot guarantee that a winner left over from
 * some other arrangement still names someone in this match. Trusting it would
 * advance a seed that isn't playing, which is worse in every direction than
 * showing the match as undecided. And a BYE stores no winner by design (migration
 * 112): it advances its occupant with no pick, because nobody played.
 */
export function settle(
  m: BracketDrawMatch,
  aSeed: number | null,
  bSeed: number | null,
  aEmpty: boolean,
  bEmpty: boolean,
  recorded: number | null,
  withdrawn: ReadonlySet<number>,
): ResolvedMatch {
  if (aSeed !== null && bSeed !== null && (recorded === aSeed || recorded === bSeed)) {
    return { ...m, aSeed, bSeed, winnerSeed: recorded, bye: false, playable: false, decidable: true, neverContested: false, forfeited: [] };
  }
  const aGone = aSeed !== null && withdrawn.has(aSeed);
  const bGone = bSeed !== null && withdrawn.has(bSeed);
  const aOut = aSeed === null ? aEmpty : aGone;
  const bOut = bSeed === null ? bEmpty : bGone;
  const forfeited = [aGone ? aSeed : null, bGone ? bSeed : null].filter((x): x is number => x !== null);

  if (aOut && bOut) {
    return { ...m, aSeed, bSeed, winnerSeed: null, bye: false, playable: false, decidable: false, neverContested: true, forfeited };
  }
  if (aOut && bSeed !== null) {
    return { ...m, aSeed, bSeed, winnerSeed: bSeed, bye: !aGone, playable: false, decidable: false, neverContested: false, forfeited };
  }
  if (bOut && aSeed !== null) {
    return { ...m, aSeed, bSeed, winnerSeed: aSeed, bye: !bGone, playable: false, decidable: false, neverContested: false, forfeited };
  }
  const both = aSeed !== null && bSeed !== null;
  return { ...m, aSeed, bSeed, winnerSeed: null, bye: false, playable: both, decidable: both, neverContested: false, forfeited: [] };
}

/**
 * Resolve every match's occupants from the stored draw plus the recorded winners.
 *
 * Processes rounds in order, so each round is resolved before the round it feeds.
 * A match whose feeders are undecided keeps null seats — an unknown occupant is
 * shown as unknown, never guessed at.
 *
 * The CONSOLATION match is the exception to "winners flow upward": it is
 * contested by the two LOSING semi-finalists, so it derives from the same
 * matches the final does, taking the other side of each. It resolves only once a
 * semi has both an occupant pair and a decision — a semi-final still in progress
 * has no loser yet, and half a consolation pairing is not a fixture.
 *
 * `draw` is taken as data rather than rebuilt from an entrant count, because the
 * persisted draw is the authority once a game exists: a field edited after the
 * draw was built would otherwise resolve against a tree nobody is playing.
 */
/** Nobody has withdrawn — the default for every caller that has no withdrawals to pass. */
const NO_ONE: ReadonlySet<number> = new Set<number>();

export function resolveDraw(
  draw: BracketDrawMatch[],
  winners: WinnerBySeed = {},
  withdrawn: ReadonlySet<number> = NO_ONE,
): ResolvedMatch[] {
  if (draw.length === 0) return [];

  const main = draw.filter((m) => m.bracket === "main");
  const consolation = draw.filter((m) => m.bracket === "consolation");
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);

  const resolved = new Map<string, ResolvedMatch>();
  const at = (round: number, slot: number) => resolved.get(matchKey({ bracket: "main", round, slot }));

  // Round 1 carries its seeds (a null seat there is EMPTY: seeded at build time,
  // nothing can arrive later). Every later round takes them from the round below:
  // a decided feeder sends its winner, an empty slot sends nobody EVER, and an
  // undecided one leaves the seat WAITING. `settle` turns that into walkovers,
  // byes and empty slots — including above round 1, where the only way to get an
  // empty seat is a chain of withdrawals.
  for (let round = 1; round <= lastRound; round++) {
    for (const m of main.filter((x) => x.round === round)) {
      const recorded = winners[matchKey(m)] ?? null;
      if (round === 1) {
        resolved.set(matchKey(m), settle(m, m.aSeed, m.bSeed, m.aSeed === null, m.bSeed === null, recorded, withdrawn));
        continue;
      }
      // Slots 2s-1 and 2s of the round below feed slot s — the odd one into seat A,
      // the even one into seat B: the inverse of `buildDraw`'s halving.
      const fa = at(round - 1, m.slot * 2 - 1);
      const fb = at(round - 1, m.slot * 2);
      resolved.set(
        matchKey(m),
        settle(m, fa?.winnerSeed ?? null, fb?.winnerSeed ?? null, !fa || fa.neverContested, !fb || fb.neverContested, recorded, withdrawn),
      );
    }
  }

  // The 3rd-place play-off. `buildDraw` only emits one when there are semis to
  // lose (rounds >= 2), so the lookup below always has real matches to read. Its
  // seats are the semis' LOSERS: a semi that is an empty slot can never produce
  // one (EMPTY), an undecided one has not yet (WAITING), and a semi won by
  // walkover sends its forfeiter — who, being withdrawn, gives the play-off away
  // in turn.
  for (const m of consolation) {
    const semis = [1, 2].map((slot) => at(lastRound - 1, slot));
    resolved.set(
      matchKey(m),
      settle(
        m,
        loserOf(semis[0]),
        loserOf(semis[1]),
        !semis[0] || semis[0].neverContested,
        !semis[1] || semis[1].neverContested,
        winners[matchKey(m)] ?? null,
        withdrawn,
      ),
    );
  }

  // Emitted in the caller's order so the view can render the draw as stored.
  // Rows this resolver does not handle (a double-elim draw's `lower`/`final`) are
  // DROPPED rather than emitted as `undefined`. The non-null assertion here used to
  // put holes in the array, and the first consumer to read `.bracket` off one threw —
  // which is exactly how a double-elim pick failed: it crashed in the optimistic
  // cascade before the mutation was ever sent, so there was no error to see anywhere.
  // A resolver that returns a hole is worse than one that returns less.
  return draw.map((m) => resolved.get(matchKey(m))).filter((m): m is ResolvedMatch => m !== undefined);
}

/** The side of a decided match that did NOT advance. Null while the match is
 *  undecided — a match in progress has no loser, only two people still in it. */
function loserOf(m: ResolvedMatch | undefined): number | null {
  if (!m || m.winnerSeed === null) return null;
  return m.winnerSeed === m.aSeed ? m.bSeed : m.aSeed;
}

/**
 * Record a winner on ONE match of a stored draw, returning a new array.
 *
 * The optimistic half of a pick (CLAUDE.md #1): the client writes exactly the
 * column `games.pickWinner` writes — `winnerSeed` on the addressed match — and
 * nothing else. Everything downstream stays DERIVED, so feeding the patched rows
 * through `resolveDraw` gives the same answer as re-fetching would.
 *
 * That is the whole safety argument for guessing here, and it is why this lives
 * beside the resolver rather than inside the surface: an optimistic pick and a
 * fetched one must not travel two code paths. Generic over the row shape so the
 * router payload can be patched without this module knowing about it.
 *
 * A ref matching no match returns the rows unchanged — a pick into a draw that
 * has since been rebuilt patches nothing rather than inventing a match.
 */
export function applyPick<T extends BracketMatchRef & { winnerSeed: number | null }>(
  rows: readonly T[],
  ref: BracketMatchRef,
  winnerSeed: number | null
): T[] {
  return rows.map((m) =>
    m.bracket === ref.bracket && m.round === ref.round && m.slot === ref.slot
      ? { ...m, winnerSeed }
      : m
  );
}

/**
 * Record a winner AND clear everything it orphans — the cascading pick.
 *
 * ── This REVERSES #925, deliberately ───────────────────────────────────────
 * #925 made clearing non-cascading: later rounds are derived, so clearing a semi
 * already un-decided everything above it and nothing else needed writing. The
 * stored picks stayed, and re-picking the same entrant made them valid again —
 * flagged at the time as surprising-but-defensible, on the reasoning that
 * nothing about the final had changed.
 *
 * That reasoning was wrong. Deliberately correcting a result and watching the
 * downstream clear is a STATEMENT: those results are void. Silently reviving
 * them decides that your clearing didn't count. And the concrete case is worse
 * than untidy — correct a semi because the wrong person advanced, the final
 * clears, then you realise the original was right after all: the final's result
 * was recorded against a bracket state you had just repudiated, and it should
 * not come back on a technicality.
 *
 * So an orphaned pick is DELETED, not left recoverable.
 *
 * ── #924 still stands, and is now the belt to this braces ──────────────────
 * `winnerOf` still drops a stored winner who isn't a resolved occupant, so a row
 * that escapes this cascade (a rebuild, a stale client, a failed second write)
 * still READS as undecided. The cascade means it should rarely fire; it is not
 * replaced by it.
 *
 * ── One pass is transitive ─────────────────────────────────────────────────
 * `resolveDraw` walks rounds in order, so clearing a round-1 winner leaves the
 * round-2 seats null, which drops round 2's stored winner, which leaves round 3
 * null, and so on up. Every orphan in the tree is visible in a single resolve —
 * no loop, and no second definition of "orphaned".
 */
/**
 * The cascade, generic over the RESOLVER.
 *
 * "Orphaned" is defined here as *a stored winner who is no longer one of their match's
 * occupants after re-resolution* — which needs no knowledge of the tree's shape and so
 * works for both formats. The single-elim version walks upward positionally; that walk
 * cannot describe a double-elim draw, where changing a `main` result moves people
 * between two brackets rather than only upward.
 *
 * Same guarantee either way (#925): clearing a result is a STATEMENT that what followed
 * is void, and those downstream picks must not revive if the original is re-picked.
 */
export function applyPickCascadingWith<T extends BracketDrawMatch & { winnerSeed: number | null }>(
  rows: readonly T[],
  ref: BracketMatchRef,
  winnerSeed: number | null,
  resolve: (draw: BracketDrawMatch[], winners: WinnerBySeed) => ResolvedMatch[]
): T[] {
  const picked = applyPick(rows, ref, winnerSeed);
  const winners: WinnerBySeed = {};
  for (const m of picked) winners[matchKey(m)] = m.winnerSeed;
  const byKey = new Map(resolve(picked, winners).map((r) => [matchKey(r), r]));

  const target = matchKey(ref);
  return picked.map((m) => {
    if (matchKey(m) === target || m.winnerSeed === null) return m;
    const r = byKey.get(matchKey(m));
    const stillIn = r && (r.winnerSeed === m.winnerSeed);
    return stillIn ? m : { ...m, winnerSeed: null };
  });
}

export function applyPickCascading<T extends BracketDrawMatch & { winnerSeed: number | null }>(
  rows: readonly T[],
  ref: BracketMatchRef,
  winnerSeed: number | null,
  withdrawn: ReadonlySet<number> = NO_ONE,
): T[] {
  const picked = applyPick(rows, ref, winnerSeed);

  const winners: WinnerBySeed = {};
  for (const m of picked) winners[matchKey(m)] = m.winnerSeed;
  const resolvedByKey = new Map(resolveDraw(picked, winners, withdrawn).map((r) => [matchKey(r), r]));

  const target = matchKey(ref);
  return picked.map((m) => {
    // The pick itself is the intent, never an orphan of itself.
    if (matchKey(m) === target) return m;
    const resolved = resolvedByKey.get(matchKey(m));
    // Stored a winner, but the resolver won't have them: orphaned. Delete it.
    return m.winnerSeed !== null && resolved && resolved.winnerSeed === null
      ? { ...m, winnerSeed: null }
      : m;
  });
}

/** Which matches `applyPickCascading` would clear — the write list, without the
 *  rows themselves. Used server-side to null exactly those rows in one
 *  statement alongside the pick. */
export function orphanedByPick<T extends BracketDrawMatch & { winnerSeed: number | null }>(
  rows: readonly T[],
  ref: BracketMatchRef,
  winnerSeed: number | null,
  withdrawn: ReadonlySet<number> = NO_ONE,
): BracketMatchRef[] {
  const after = applyPickCascading(rows, ref, winnerSeed, withdrawn);
  const before = new Map(rows.map((m) => [matchKey(m), m.winnerSeed]));
  return after
    .filter((m) => m.winnerSeed === null && (before.get(matchKey(m)) ?? null) !== null)
    .filter((m) => matchKey(m) !== matchKey(ref))
    .map((m) => ({ bracket: m.bracket, round: m.round, slot: m.slot }));
}

/** The seed that won the whole thing, or null while the final is undecided.
 *  Reads the resolved final rather than "the last recorded winner", which would
 *  be whichever pick happened most recently. */
export function championSeed(resolved: ResolvedMatch[]): number | null {
  const main = resolved.filter((m) => m.bracket === "main");
  if (main.length === 0) return null;
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);
  return main.find((m) => m.round === lastRound && m.slot === 1)?.winnerSeed ?? null;
}

/** Is every match that CAN be decided decided? True when nothing is playable —
 *  which is what "the bracket is finished" means, and is not the same as "the
 *  final has a winner" for a draw carrying a consolation match. */
export function drawComplete(resolved: ResolvedMatch[]): boolean {
  return resolved.length > 0 && resolved.every((m) => !m.playable);
}

/** How many rounds this resolved draw spans — re-exported through here so a
 *  caller rendering the tree needs only this module. */
export { roundCount };
