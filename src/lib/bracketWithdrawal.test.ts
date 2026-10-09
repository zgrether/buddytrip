import { describe, it, expect } from "vitest";
import { buildDraw, type BracketDrawMatch } from "./bracket";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDraw, drawComplete, matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";
import { resolveDoubleDraw, lossesBySeed, livesOf } from "./bracketDoubleAdvance";
import { bracketPlacements } from "./bracketPlacements";
import { doubleBracketPlacements } from "./bracketDoublePlacements";

/**
 * Ruling 8 (Zach, 2026-10-08): a withdrawn entrant, read by both resolvers.
 *
 *   - one side with nobody left is a WALKOVER: the other advances, no pick;
 *   - nobody left on either side is an EMPTY SLOT the next round treats as a bye,
 *     so any chain of withdrawals resolves without a special case;
 *   - a result recorded BEFORE the withdrawal stands;
 *   - the forfeiter is eliminated outright (never sent to the lower bracket) and
 *     placed in the round it withdrew; a grand final won by walkover owes no reset.
 *
 * Matches are found by who is in them, not by slot, so nothing here depends on
 * how the draw happens to be laid out.
 */

type Resolver = (draw: BracketDrawMatch[], w: WinnerBySeed, out: ReadonlySet<number>) => ResolvedMatch[];
const single: Resolver = (d, w, o) => resolveDraw(d, w, o);
const double: Resolver = (d, w, o) => resolveDoubleDraw(d, w, o);
const favourite = (m: ResolvedMatch) => Math.min(m.aSeed!, m.bSeed!);

/** Play the favourite at every playable match until `stop` says so (or nothing is left). */
function play(
  draw: BracketDrawMatch[],
  resolve: Resolver,
  winners: WinnerBySeed,
  out: ReadonlySet<number>,
  stop: (next: ResolvedMatch) => boolean = () => false,
  choose: (m: ResolvedMatch) => number = favourite,
): ResolvedMatch[] {
  for (let i = 0; i < draw.length + 5; i++) {
    const resolved = resolve(draw, winners, out);
    const next = resolved.find((m) => m.playable);
    if (!next || stop(next)) return resolved;
    winners[matchKey(next)] = choose(next);
  }
  throw new Error("did not settle");
}

const has = (m: ResolvedMatch, seed: number) => m.aSeed === seed || m.bSeed === seed;
const firstWith = (r: ResolvedMatch[], seed: number, bracket = "main") =>
  r.filter((m) => m.bracket === bracket && has(m, seed)).sort((a, b) => a.round - b.round)[0];
const placeOf = (p: { seed: number; position: number }[], seed: number) => p.find((x) => x.seed === seed)?.position;

describe("single elimination", () => {
  it("CONTROL: with nobody withdrawn, the resolver answers exactly as before", () => {
    const draw = buildDraw(8, { consolation: true });
    const w: WinnerBySeed = {};
    const r = play(draw, single, w, new Set());
    expect(resolveDraw(draw, w, new Set())).toEqual(resolveDraw(draw, w));
    expect(r.every((m) => m.forfeited.length === 0)).toBe(true);
  });

  it("a withdrawn entrant's first match is a WALKOVER: the opponent advances with no pick, and it is placed in that round", () => {
    const draw = buildDraw(8);
    const r = play(draw, single, {}, new Set([8]));
    const m = firstWith(r, 8);
    expect(m.forfeited).toEqual([8]);
    expect(m.winnerSeed).toBe(m.aSeed === 8 ? m.bSeed : m.aSeed);
    expect([m.bye, m.playable, m.decidable]).toEqual([false, false, false]);
    expect(drawComplete(r)).toBe(true);
    const p = bracketPlacements(r);
    expect(placeOf(p, 8)).toBe(5); // a round-1 exit at 8 entrants: the 5th–8th group
    expect(p).toHaveLength(8);
  });

  it("a result recorded BEFORE the withdrawal stands; the NEXT match is the walkover", () => {
    const draw = buildDraw(8);
    const w: WinnerBySeed = {};
    // Seed 8 wins its round-1 match (an upset), THEN withdraws.
    play(draw, single, w, new Set(), () => false, (m) => (has(m, 8) ? 8 : favourite(m)));
    const before = resolveDraw(draw, w);
    const r1 = firstWith(before, 8);
    // Rewind everything above round 1 so only 8's win is on record.
    const kept: WinnerBySeed = { [matchKey(r1)]: 8 };
    const r = play(draw, single, kept, new Set([8]));
    expect(firstWith(r, 8).winnerSeed).toBe(8);
    expect(firstWith(r, 8).forfeited).toEqual([]);
    const second = r.find((m) => m.round === 2 && has(m, 8))!;
    expect(second.forfeited).toEqual([8]);
    expect(placeOf(bracketPlacements(r), 8)).toBe(3); // out in round 2 of 3: the 3rd–4th group
  });

  it("BOTH sides withdrawn: an empty slot, and the next round treats it as a bye", () => {
    const draw = buildDraw(8);
    const opp = (() => { const m = firstWith(resolveDraw(draw), 1); return m.aSeed === 1 ? m.bSeed! : m.aSeed!; })();
    const r = play(draw, single, {}, new Set([1, opp]));
    const empty = firstWith(r, 1);
    expect(empty.neverContested).toBe(true);
    expect(empty.forfeited.sort()).toEqual([1, opp].sort());
    const next = r.find((m) => m.round === 2 && m.slot === Math.ceil(empty.slot / 2))!;
    expect(next.bye).toBe(true);
    expect(next.forfeited).toEqual([]);
    const p = bracketPlacements(r);
    expect([placeOf(p, 1), placeOf(p, opp)]).toEqual([5, 5]);
  });

  it("a CHAIN of withdrawals resolves with no special case: a whole half empties and the final is a bye", () => {
    const draw = buildDraw(8);
    const r0 = resolveDraw(draw);
    // Everyone in the two round-1 matches that feed round-2 slot 1.
    const half = r0.filter((m) => m.round === 1 && Math.ceil(m.slot / 2) === 1).flatMap((m) => [m.aSeed!, m.bSeed!]);
    const r = play(draw, single, {}, new Set(half));
    const semi = r.find((m) => m.round === 2 && m.slot === 1)!;
    expect(semi.neverContested).toBe(true);
    const final = r.find((m) => m.round === 3)!;
    expect(final.bye).toBe(true);
    expect(final.winnerSeed).not.toBeNull();
    expect(drawComplete(r)).toBe(true);
    expect(bracketPlacements(r).find((x) => x.position === 1)?.seed).toBe(final.winnerSeed);
  });

  it("a semi won by walkover sends its forfeiter to the play-off, which it gives away in turn", () => {
    const draw = buildDraw(4, { consolation: true });
    const w: WinnerBySeed = {};
    // Seed 4 wins its round-1 semi, then withdraws before the final.
    const semi = firstWith(resolveDraw(draw), 4);
    w[matchKey(semi)] = 4;
    const r = play(draw, single, w, new Set([4]));
    const final = r.find((m) => m.bracket === "main" && m.round === 2)!;
    expect(final.forfeited).toEqual([4]);
    const playoff = r.find((m) => m.bracket === "consolation")!;
    // 4 did not lose a semi, so it is not in the play-off: placed 2nd from the final.
    expect(has(playoff, 4)).toBe(false);
    expect(placeOf(bracketPlacements(r), 4)).toBe(2);
  });
});

describe("double elimination", () => {
  it("a main-bracket walkover is NOT sent down: the lower seat it fed is empty, and the forfeiter has no lives", () => {
    const draw = buildDoubleDraw(4);
    const r = play(draw, double, {}, new Set([4]));
    const m = firstWith(r, 4);
    expect(m.forfeited).toEqual([4]);
    expect(r.filter((x) => x.bracket === "lower").some((x) => has(x, 4))).toBe(false);
    expect(livesOf(lossesBySeed(r), 4)).toBe(0);
    expect(drawComplete(r)).toBe(true);
    // A round-1 forfeit is grouped with lower round 1's exits: last place at 4.
    expect(placeOf(doubleBracketPlacements(r), 4)).toBe(4);
  });

  it("the undefeated finalist withdraws before the grand final: walkover, and NO reset is owed", () => {
    const draw = buildDoubleDraw(4);
    const w: WinnerBySeed = {};
    const atFinal = play(draw, double, w, new Set(), (next) => next.bracket === "final");
    const gf = atFinal.find((m) => m.bracket === "final" && m.round === 1)!;
    const upper = gf.aSeed!;
    const lowerSurvivor = gf.bSeed!;
    const r = play(draw, double, w, new Set([upper]));
    const gf1 = r.find((m) => m.bracket === "final" && m.round === 1)!;
    expect(gf1.forfeited).toEqual([upper]);
    expect(gf1.winnerSeed).toBe(lowerSurvivor);
    // NO reset is owed — asserted on the reset row itself, not on `playable`: a reset
    // that WAS owed would also be unplayable, as a second walkover against the
    // same forfeiter, and would crown the same champion. The outcome cannot tell
    // the two apart; only the row can (a phantom walkover match on the board).
    const gf2 = r.find((m) => m.bracket === "final" && m.round === 2)!;
    expect(gf2.neverContested).toBe(true);
    expect(gf2.forfeited).toEqual([]);
    expect([gf2.aSeed, gf2.bSeed]).toEqual([null, null]);
    expect(drawComplete(r)).toBe(true);
    const p = doubleBracketPlacements(r);
    expect(placeOf(p, lowerSurvivor)).toBe(1);
    expect(placeOf(p, upper)).toBe(2);
  });

  it("#1417 meets ruling 8: with the reset OWED, the side that lost the first final withdraws — the reset is a walkover", () => {
    const draw = buildDoubleDraw(4);
    const w: WinnerBySeed = {};
    // Seed 1 drops into the lower bracket, comes back, wins the first final.
    let dropped = false;
    const comeback = (m: ResolvedMatch) => {
      if (has(m, 1) && m.bracket === "main" && !dropped) { dropped = true; return m.aSeed === 1 ? m.bSeed! : m.aSeed!; }
      return has(m, 1) ? 1 : favourite(m);
    };
    const owed = play(draw, double, w, new Set(), (next) => next.bracket === "final" && next.round === 2, comeback);
    const reset = owed.find((m) => m.bracket === "final" && m.round === 2)!;
    expect(reset.playable).toBe(true); // premise: the reset is owed
    expect(doubleBracketPlacements(owed)).toEqual([]); // #1417: nobody placed yet
    const other = reset.aSeed === 1 ? reset.bSeed! : reset.aSeed!;

    const r = resolveDoubleDraw(draw, w, new Set([other]));
    const settled = r.find((m) => m.bracket === "final" && m.round === 2)!;
    expect(settled.forfeited).toEqual([other]);
    expect(settled.winnerSeed).toBe(1);
    expect(drawComplete(r)).toBe(true);
    const p = doubleBracketPlacements(r);
    expect(placeOf(p, 1)).toBe(1);
    expect(placeOf(p, other)).toBe(2);
  });

  it("a forfeit in a LATER main round is placed with the lower round that loss would have fed", () => {
    const draw = buildDoubleDraw(4);
    const w: WinnerBySeed = {};
    // Play main round 1; seed 1 wins it, then withdraws before the main final.
    play(draw, double, w, new Set(), (next) => !(next.bracket === "main" && next.round === 1));
    const r = play(draw, double, w, new Set([1]));
    const mainFinal = r.find((m) => m.bracket === "main" && m.round === 2)!;
    expect(mainFinal.forfeited).toEqual([1]);
    // Main round 2 feeds lower round 2 = 2(2-1): its exit there is 3rd at 4 entrants.
    expect(placeOf(doubleBracketPlacements(r), 1)).toBe(3);
  });
});
