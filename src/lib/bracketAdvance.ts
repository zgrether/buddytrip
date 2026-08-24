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

import { isBye, roundCount, type BracketDrawMatch, type BracketSide } from "./bracket";

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
}

/**
 * Which seed leaves this match going upward.
 *
 * A BYE advances its occupant with no pick, because nobody played — the row
 * stores no winner by design (migration 112), so reading one would mean
 * inventing a result for a game that did not happen.
 *
 * Otherwise it is the recorded winner, but ONLY IF that seed is actually one of
 * this match's resolved occupants. A recorded winner that is neither occupant is
 * dropped, and that is deliberate rather than defensive noise: the pool can be
 * re-seeded, and `save_game_config` only refuses a rebuild once a winner EXISTS
 * (`HAS_PICKS`) — it does not, and cannot, guarantee that a winner left over
 * from some other arrangement still names someone in this match. Trusting it
 * would advance a seed that isn't playing, which is worse in every direction
 * than showing the match as undecided.
 */
function winnerOf(m: { aSeed: number | null; bSeed: number | null; bye: boolean }, recorded: number | null): number | null {
  if (m.bye) return m.aSeed;
  if (recorded == null) return null;
  return recorded === m.aSeed || recorded === m.bSeed ? recorded : null;
}

/** Where a match's winner goes: up one round, into the slot that pairs it with
 *  its neighbour. Slot 1 and 2 of round R both feed slot 1 of round R+1 — the
 *  odd one into seat A, the even one into seat B. Inverse of `buildDraw`'s
 *  halving, and the one place that relationship is written down. */
function parentOf(slot: number): { slot: number; seat: "a" | "b" } {
  return { slot: Math.ceil(slot / 2), seat: slot % 2 === 1 ? "a" : "b" };
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
export function resolveDraw(draw: BracketDrawMatch[], winners: WinnerBySeed = {}): ResolvedMatch[] {
  if (draw.length === 0) return [];

  const main = draw.filter((m) => m.bracket === "main");
  const consolation = draw.filter((m) => m.bracket === "consolation");
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);

  const resolved = new Map<string, ResolvedMatch>();
  // Occupants fed upward from the round below, filled in as each round resolves.
  const incoming = new Map<string, { a?: number | null; b?: number | null }>();
  /**
   * Rows nobody will ever occupy, PROPAGATED rather than re-tested per row.
   *
   * Round 1 is the only place "both seats null" means it: those seats are seeded
   * at build time, so nothing upstream can fill them later. Above round 1 a row is
   * unreachable only when BOTH of its feeders are unreachable — a rule that has to
   * be carried forward, which is why it is a set built during the walk rather than
   * a predicate over one row.
   *
   * Single elim does not manufacture byes above round 1 (`bye = round === 1 && …`),
   * so it never had the phantom-bye defect this field exists to fix. It fills the
   * field anyway so `neverContested` means the same thing in both formats and a
   * shared consumer cannot be reading a double-elim-only value.
   */
  const unreachable = new Set<string>();

  for (let round = 1; round <= lastRound; round++) {
    for (const m of main.filter((x) => x.round === round)) {
      const fed = incoming.get(matchKey(m)) ?? {};
      // Round 1 carries its seeds; every later round takes them from below.
      const aSeed = round === 1 ? m.aSeed : (fed.a ?? null);
      const bSeed = round === 1 ? m.bSeed : (fed.b ?? null);
      const bye = round === 1 && isBye(m);
      const winnerSeed = winnerOf({ aSeed, bSeed, bye }, winners[matchKey(m)] ?? null);

      const neverContested =
        round === 1
          ? m.aSeed === null && m.bSeed === null
          : [m.slot * 2 - 1, m.slot * 2].every((slot) =>
              unreachable.has(matchKey({ bracket: "main", round: round - 1, slot })),
            );
      if (neverContested) unreachable.add(matchKey(m));

      resolved.set(matchKey(m), {
        ...m,
        aSeed,
        bSeed,
        winnerSeed,
        bye,
        playable: aSeed !== null && bSeed !== null && winnerSeed === null,
        decidable: aSeed !== null && bSeed !== null && !bye,
        neverContested,
      });

      if (winnerSeed !== null && round < lastRound) {
        const parent = parentOf(m.slot);
        const key = matchKey({ bracket: "main", round: round + 1, slot: parent.slot });
        incoming.set(key, { ...(incoming.get(key) ?? {}), [parent.seat]: winnerSeed });
      }
    }
  }

  // The 3rd-place play-off. `buildDraw` only emits one when there are semis to
  // lose (rounds >= 2), so the lookup below always has real matches to read.
  for (const m of consolation) {
    const semis = [1, 2].map((slot) => resolved.get(matchKey({ bracket: "main", round: lastRound - 1, slot })));
    const losers = semis.map((s) => loserOf(s));
    const [aSeed, bSeed] = [losers[0] ?? null, losers[1] ?? null];
    const winnerSeed = winnerOf({ aSeed, bSeed, bye: false }, winners[matchKey(m)] ?? null);
    resolved.set(matchKey(m), {
      ...m,
      aSeed,
      bSeed,
      winnerSeed,
      bye: false,
      playable: aSeed !== null && bSeed !== null && winnerSeed === null,
      // No byes in a consolation match — it exists only when there are semis to
      // lose, so both seats are real people or neither is.
      decidable: aSeed !== null && bSeed !== null,
      // Fed by the two semis' LOSERS, so it is unreachable only when neither semi
      // can ever produce one — i.e. both are unreachable themselves. A semi that
      // is merely undecided leaves this waiting, not empty.
      neverContested: semis.every((s) => !s || s.neverContested),
    });
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
  winnerSeed: number | null
): T[] {
  const picked = applyPick(rows, ref, winnerSeed);

  const winners: WinnerBySeed = {};
  for (const m of picked) winners[matchKey(m)] = m.winnerSeed;
  const resolvedByKey = new Map(resolveDraw(picked, winners).map((r) => [matchKey(r), r]));

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
  winnerSeed: number | null
): BracketMatchRef[] {
  const after = applyPickCascading(rows, ref, winnerSeed);
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
