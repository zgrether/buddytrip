import { describe, it, expect } from "vitest";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDoubleDraw, lossesBySeed, livesOf, isMustWin } from "./bracketDoubleAdvance";
import { drawComplete, matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";

/**
 * The double-elimination WALK, played to completion at every entrant count.
 *
 * A shape test can only say the tree looks right. This plays it: pick every decidable
 * match until nothing is left, then assert the run was a real tournament — one champion,
 * everybody else out on exactly two losses, and nothing left pending.
 *
 * The two champion routes the spec names get their own strategies, because they exercise
 * different halves of the structure:
 *
 *   FAVOURITE   the better seed always wins. Seed 1 goes through `main` undefeated and
 *               takes the first grand final, so the reset is NEVER played.
 *   COMEBACK    seed 1 loses their opening `main` match and wins everything after it —
 *               through the whole lower bracket, the first grand final, AND the reset.
 *               This is the only path that exercises the if-necessary final at all.
 */

// 32 and 64 added for the scale pass: the odd counts got attention because that is
// where byes break, and the large ones had never been run at all.
const COUNTS = [3, 4, 5, 6, 7, 8, 9, 16, 32, 64];

/** Play a draw to completion, one decidable match at a time. Returns the recorded
 *  winners and the final resolution — the same pair a real game accumulates. */
function playOut(
  entrants: number,
  choose: (m: ResolvedMatch) => number,
): { resolved: ResolvedMatch[]; winners: WinnerBySeed; picks: number } {
  const draw = buildDoubleDraw(entrants);
  const winners: WinnerBySeed = {};
  let picks = 0;
  // Bounded so a structure that never settles fails loudly rather than hanging CI.
  const limit = draw.length + 5;
  for (;;) {
    const resolved = resolveDoubleDraw(draw, winners);
    const next = resolved.find((m) => m.playable);
    if (!next) return { resolved, winners, picks };
    winners[matchKey(next)] = choose(next);
    if (++picks > limit) throw new Error(`did not settle at ${entrants} entrants after ${picks} picks`);
  }
}

const favourite = (m: ResolvedMatch) => Math.min(m.aSeed!, m.bSeed!);

/**
 * Seed 1 loses the FIRST `main` match they actually play, then wins everything after.
 *
 * "First match" rather than "round 1" because at every count with byes the top seed
 * RECEIVES one — at 5 entrants seed 1 has no round-1 match to lose at all. Keying the
 * drop to round 1 made this strategy silently a no-op at 3, 5, 6, 7 and 9 entrants, so
 * it asserted a comeback champion while actually testing an undefeated one. Stateful
 * for that reason, and built per run so the flag cannot leak between counts.
 */
const comebackStrategy = () => {
  let dropped = false;
  return (m: ResolvedMatch) => {
    const has1 = m.aSeed === 1 || m.bSeed === 1;
    if (has1 && m.bracket === "main" && !dropped) {
      dropped = true;
      return m.aSeed === 1 ? m.bSeed! : m.aSeed!;
    }
    if (has1) return 1;
    return Math.min(m.aSeed!, m.bSeed!);
  };
};

const champion = (resolved: ResolvedMatch[]): number | null => {
  const losses = lossesBySeed(resolved);
  const seeds = new Set<number>();
  for (const m of resolved) {
    if (m.aSeed !== null) seeds.add(m.aSeed);
    if (m.bSeed !== null) seeds.add(m.bSeed);
  }
  const alive = [...seeds].filter((s) => livesOf(losses, s) > 0);
  return alive.length === 1 ? alive[0] : null;
};

describe.each(COUNTS)("a full run at %i entrants", (n) => {
  it("settles, with nothing left playable", () => {
    const { resolved } = playOut(n, favourite);
    expect(drawComplete(resolved)).toBe(true);
  });

  it("produces exactly one champion, and everyone else is out on two losses", () => {
    const { resolved } = playOut(n, favourite);
    const losses = lossesBySeed(resolved);
    const seeds = new Set<number>();
    for (const m of resolved) {
      if (m.aSeed !== null) seeds.add(m.aSeed);
      if (m.bSeed !== null) seeds.add(m.bSeed);
    }
    expect(seeds.size, `entrants seen at ${n}`).toBe(n);

    const alive = [...seeds].filter((s) => livesOf(losses, s) > 0);
    expect(alive, `exactly one survivor at ${n}`).toHaveLength(1);
    // The defining property of double elimination, asserted directly: you leave on the
    // SECOND loss, never the first.
    for (const s of seeds) {
      if (s === alive[0]) continue;
      expect(losses.get(s), `seed ${s} at ${n} must be out on exactly two losses`).toBe(2);
    }
  });

  it("FAVOURITE: seed 1 wins undefeated and the reset is never played", () => {
    const { resolved } = playOut(n, favourite);
    const losses = lossesBySeed(resolved);
    expect(champion(resolved)).toBe(1);
    expect(losses.get(1) ?? 0, "an undefeated champion has no losses").toBe(0);

    const reset = resolved.find((m) => m.bracket === "final" && m.round === 2)!;
    // Never contested, so it has no occupants — which is what keeps `drawComplete`
    // from waiting on it, with no second predicate anywhere.
    expect(reset.aSeed).toBeNull();
    expect(reset.bSeed).toBeNull();
    expect(reset.playable).toBe(false);
    expect(reset.winnerSeed).toBeNull();
  });

  it("COMEBACK: seed 1 loses first, comes through the lower bracket, and wins the reset", () => {
    const { resolved } = playOut(n, comebackStrategy());
    const losses = lossesBySeed(resolved);

    expect(champion(resolved), `champion at ${n}`).toBe(1);
    // One loss, taken in the opening round — the champion survived on their second life.
    expect(losses.get(1), "a comeback champion carries exactly one loss").toBe(1);

    const gf1 = resolved.find((m) => m.bracket === "final" && m.round === 1)!;
    const reset = resolved.find((m) => m.bracket === "final" && m.round === 2)!;
    expect(gf1.winnerSeed, "the lower-bracket entrant takes the first final").toBe(1);
    // Both sides now hold one loss, so the bracket has produced nobody with two and the
    // second final is REQUIRED. Automatic — nothing toggles it.
    expect(reset.decidable, `the reset must be played at ${n}`).toBe(true);
    expect(reset.winnerSeed).toBe(1);
  });

  it("keeps every entrant's losses at or below two", () => {
    for (const strategy of [favourite, comebackStrategy()]) {
      const { resolved } = playOut(n, strategy);
      for (const [seed, l] of lossesBySeed(resolved)) {
        expect(l, `seed ${seed} at ${n} played on after elimination`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("lives", () => {
  it("is 2 minus losses, floored at zero", () => {
    const losses = new Map([[1, 0], [2, 1], [3, 2], [4, 3]]);
    expect(losses.size).toBe(4);
    expect(livesOf(losses, 1)).toBe(2);
    expect(livesOf(losses, 2)).toBe(1);
    expect(livesOf(losses, 3)).toBe(0);
    expect(livesOf(losses, 4)).toBe(0); // can't go negative
    expect(livesOf(losses, 99)).toBe(2); // unseen entrant has not lost
  });

  it("makes must-win a PER-SIDE question, which is the point", () => {
    // The grand final's asymmetry, stated as the test that a match-level boolean fails:
    // the `main` survivor arrives with two lives, the `lower` survivor with one, so the
    // same match is must-win for exactly one of them.
    const losses = new Map([[1, 0], [5, 1]]);
    expect(isMustWin(losses, 5)).toBe(true);
    expect(isMustWin(losses, 1)).toBe(false);
  });

  it("reports must-win for the lower-bracket side of a real grand final", () => {
    const { resolved } = playOut(8, favourite);
    const gf1 = resolved.find((m) => m.bracket === "final" && m.round === 1)!;
    // Re-derive lives as they stood BEFORE the final was decided.
    const before = lossesBySeed(resolved.filter((m) => !(m.bracket === "final")));
    expect(isMustWin(before, gf1.bSeed!), "the lower-bracket finalist is playing for their life").toBe(true);
    expect(isMustWin(before, gf1.aSeed!), "the undefeated finalist is not").toBe(false);
  });
});

describe("byes in the lower bracket — the odd-count case", () => {
  it("advances a lone occupant instead of stalling, at 5 entrants", () => {
    // 5 of an 8-draw: three byes in main round 1, so it produces exactly ONE loser.
    // Lower round 1 therefore has a match with one occupant and one seat nobody is ever
    // coming to. That entrant advances free — the same answer main round 1 gives a bye.
    const { resolved } = playOut(5, favourite);
    const lowerR1 = resolved.filter((m) => m.bracket === "lower" && m.round === 1);
    const byes = lowerR1.filter((m) => m.bye);
    const empty = lowerR1.filter((m) => m.aSeed === null && m.bSeed === null);
    expect(byes.length + empty.length, "at 5 entrants lower round 1 cannot be fully contested").toBeGreaterThan(0);
    // Whatever the mix, nothing is left waiting.
    expect(drawComplete(resolved)).toBe(true);
  });

  it.each([3, 5, 6, 7, 9])("never leaves a permanently-empty match playable (%i)", (n) => {
    const { resolved } = playOut(n, favourite);
    for (const m of resolved) {
      if (m.aSeed === null && m.bSeed === null) {
        expect(m.playable, `${matchKey(m)} at ${n} is empty but pending`).toBe(false);
      }
    }
  });
});

describe("derivation", () => {
  it("resolves identically whether picks arrive one at a time or all at once", () => {
    // The property the whole engine rests on: advancement is a function of the recorded
    // winners, so a client that patched picks optimistically and a server that fetched
    // them must agree.
    const { winners } = playOut(8, comebackStrategy());
    const draw = buildDoubleDraw(8);
    expect(resolveDoubleDraw(draw, winners)).toEqual(playOut(8, comebackStrategy()).resolved);
  });

  it("drops a recorded winner who is not in the match", () => {
    // A re-seed can leave a stale pick naming somebody who is not playing this match.
    // Trusting it would advance a seed that isn't there.
    const draw = buildDoubleDraw(4);
    const gf1 = draw.find((m) => m.bracket === "final" && m.round === 1)!;
    const resolved = resolveDoubleDraw(draw, { [matchKey(gf1)]: 99 });
    expect(resolved.find((m) => m.bracket === "final" && m.round === 1)!.winnerSeed).toBeNull();
  });

  it("returns nothing for an empty draw", () => {
    expect(resolveDoubleDraw([])).toEqual([]);
  });
});
