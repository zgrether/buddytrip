/**
 * The DOUBLE-ELIMINATION draw — pure, client-safe, no server/DB deps (CLAUDE.md #8).
 *
 * Companion to `bracket.ts`, which builds a single-elimination tree. This builds the
 * whole double-elim structure as ONE array of matches: the winners' bracket (`main`),
 * the second-life bracket (`lower`), and the grand final (`final`).
 *
 * ── Composition, not a branch inside `buildDraw` ────────────────────────────
 * The winners' bracket of a double-elim draw IS a single-elim bracket, so it is
 * `buildDraw` called unchanged and concatenated — not reimplemented, and not produced
 * by teaching `buildDraw` a format flag. A module that has to ask "which format am I
 * in?" is the signal that the abstraction is wrong; here nothing asks, because the
 * shared part is genuinely shared and the extra parts are genuinely extra.
 *
 * ── Shape only, like everything else in this engine ─────────────────────────
 * Every `lower` and `final` match is emitted with BOTH seats null. That is not an
 * omission: the draw is a function of the entrant COUNT alone, and who occupies a
 * lower-bracket seat depends on results that have not happened. `resolveDraw`'s job
 * (Phase 2) is to fill them from the winners recorded below. The same rule already
 * governs main rounds 2+, so this is the existing model extended rather than a second
 * one introduced.
 *
 * ── LIVES, the model this is shaped around ─────────────────────────────────
 * An entrant has `lives = 2 - losses`: alive at 2 or 1, eliminated at 0. A first loss
 * moves you from `main` into `lower`; a second ends you. The structure below exists to
 * give every entrant somewhere to go for exactly one more loss, which is why the lower
 * bracket has twice as many rounds as the winners' bracket has after its first.
 */

import { bracketSize, buildDraw, roundCount, type BracketDrawMatch } from "./bracket";

/**
 * How many rounds the lower bracket takes: `2 * (winnersRounds - 1)`.
 *
 * The doubling is the whole geometry of double elimination. Each winners' round after
 * the first sends a fresh batch of losers down, and the lower bracket can only absorb
 * one batch at a time — so it alternates:
 *
 *   MINOR (odd k)   lower survivors play each other, halving the field
 *   MAJOR (even k)  the survivors meet the batch that just dropped from `main`
 *
 * Two lower rounds per winners' round after the first, hence `2 * (W - 1)`.
 *
 * Zero when the winners' bracket is a single match (W <= 1): there is no second round
 * to drop from, so there is nothing for a lower bracket to do.
 */
export function lowerRoundCount(entrantCount: number): number {
  const w = roundCount(entrantCount);
  return w <= 1 ? 0 : 2 * (w - 1);
}

/**
 * Matches in lower round `k` (1-based).
 *
 * Rounds pair up: (1,2) both hold `size/4`, (3,4) both hold `size/8`, and so on. A
 * MINOR round halves the survivors; the MAJOR round after it refills that half from
 * `main`, so the count does not change between a minor and the major following it —
 * which is exactly why they come in pairs.
 */
export function lowerRoundSize(entrantCount: number, k: number): number {
  const size = bracketSize(entrantCount);
  if (size === 0 || k < 1 || k > lowerRoundCount(entrantCount)) return 0;
  return size / 2 ** (Math.floor((k + 1) / 2) + 1);
}

/**
 * Which `main` round feeds lower round `k`, or null for a minor round.
 *
 * Major round `2j` takes the losers of `main` round `j + 1`. Round 1's losers are not
 * a drop — they are what STARTS the lower bracket (lower round 1), so no major round
 * claims them.
 */
export function feederMainRound(k: number): number | null {
  return k % 2 === 0 ? k / 2 + 1 : null;
}

/**
 * THE DROP PATTERN — where a `main` loser lands in the lower bracket.
 *
 * This is the part most likely to be quietly wrong, so the reasoning is here rather
 * than only in the shape.
 *
 * The naive choice is the identity map: the loser of `main` round `j+1` slot `i` drops
 * into lower slot `i`. That is WRONG in a specific and unpleasant way. Lower slot `i`
 * of a major round is occupied by the survivor of lower slot `i` below it, and — trace
 * it back — that survivor came from the losers of `main` round `j` slots `2i-1` and
 * `2i`. The `main` round `j+1` match at slot `i` is contested by the WINNERS of those
 * same two slots. So the identity map drops each `main` loser straight onto one of the
 * two people they just knocked down: an immediate rematch, every time, for the whole
 * bracket.
 *
 * So the incoming batch is REVERSED against the lower slot order:
 *
 *   lower slot i  <-  main loser from slot (count + 1 - i)
 *
 * Reversal is the cheapest map that breaks the adjacency, and it is what the standard
 * printed brackets do. It does not GUARANTEE no rematch ever — with enough rounds two
 * entrants can meet again legitimately, and a rematch after several rounds is a real
 * result rather than an artefact. What it removes is the systematic case, where the
 * structure itself manufactured a rematch at the first opportunity.
 *
 * Stated as its own exported function, not inlined, because it is the one rule here a
 * reader will want to check against a printed bracket — and because Phase 2 has to
 * apply the identical map when it resolves occupants. Two implementations of this is
 * how the shape and the resolution come to disagree.
 */
export function dropSlot(mainSlot: number, count: number): number {
  return count + 1 - mainSlot;
}

/**
 * The full double-elimination draw for `entrantCount` entrants.
 *
 * Returns `[]` below two entrants, matching `buildDraw` — there is no draw to play.
 *
 * ── Byes are NOT special-cased here, deliberately ───────────────────────────
 * The lower bracket is emitted at full size for the bracket's `size`, even when the
 * entrant count leaves byes in `main` round 1. At 5 entrants of an 8-draw, `main` round
 * 1 has three byes and produces exactly ONE loser, so lower round 1 has one real
 * occupant and no opponent.
 *
 * That is the same situation `main` round 1 is already in, and it gets the same answer:
 * the SHAPE is a function of the size, and an unfillable seat resolves to nobody. The
 * alternative — pruning the lower bracket to the live entrant count — would make the
 * tree's shape depend on results-adjacent reasoning and would produce a different
 * structure for 5 entrants than the one people are looking at on paper.
 *
 * The consequence Phase 2 must handle, flagged here because this is where it
 * originates: a lower match both of whose feeders produced no loser is a match nobody
 * can ever play, and `drawComplete` must not wait for it. Same class as a bye.
 *
 * ── The grand final, and the one that may not happen ────────────────────────
 * `final` round 1 is the convergence: the `main` survivor against the `lower` survivor.
 *
 * `final` round 2 — the if-necessary final — is EMITTED ALWAYS but is only NECESSARY
 * when the `lower` entrant wins round 1, because at that point both sides hold exactly
 * one loss and the bracket has not yet produced anyone with two. Emitting it always is
 * a deliberate call in both directions:
 *
 *  - it must be visible as a possibility before it is played, or its appearance
 *    mid-game reads as a bug rather than as the rule working;
 *  - and its NECESSITY stays derived, never stored — nothing writes "a second final is
 *    needed", it is read off round 1's winner.
 *
 * The hazard that creates, again for Phase 2: an unnecessary round-2 row is a match
 * that will never be decided, so `drawComplete` must treat it as satisfied rather than
 * pending. It is the second instance of the same class as the unfillable lower match
 * above, which is worth noticing — both are "a row exists but nobody will ever play
 * it", and one predicate should cover both.
 */
export function buildDoubleDraw(entrantCount: number): BracketDrawMatch[] {
  const size = bracketSize(entrantCount);
  if (size === 0) return [];

  // The winners' bracket IS a single-elim draw. No consolation: double elimination
  // produces 3rd structurally, so a play-off would be a second answer to a settled
  // question (and the setup toggle hides it for exactly this reason).
  const matches: BracketDrawMatch[] = buildDraw(entrantCount, { consolation: false });

  const lowerRounds = lowerRoundCount(entrantCount);
  for (let round = 1; round <= lowerRounds; round++) {
    const slots = lowerRoundSize(entrantCount, round);
    for (let slot = 1; slot <= slots; slot++) {
      matches.push({ bracket: "lower", round, slot, aSeed: null, bSeed: null });
    }
  }

  // The grand final, and the if-necessary rematch. Slot 1 both times — the existing
  // UNIQUE (game_id, bracket, round, slot) separates them by ROUND, which is why the
  // if-necessary final needed no schema of its own.
  matches.push({ bracket: "final", round: 1, slot: 1, aSeed: null, bSeed: null });
  matches.push({ bracket: "final", round: 2, slot: 1, aSeed: null, bSeed: null });

  return matches;
}

/**
 * Total matches a double-elim draw can contain, including the if-necessary final.
 *
 * Exposed because it is the cheapest independent check on the structure: a double
 * elimination over N entrants eliminates N-1 entrants at two losses each, minus the
 * one loss the champion may never take — so a full draw is `2N - 2` matches, plus 1 if
 * the final resets. Byes reduce it, because a bye is a seat nobody played.
 *
 * Derived from the emitted draw rather than from a formula, so it cannot drift from
 * what `buildDoubleDraw` actually produced — a formula agreeing with itself proves
 * nothing.
 */
export function doubleDrawMatchCount(entrantCount: number): number {
  return buildDoubleDraw(entrantCount).length;
}
