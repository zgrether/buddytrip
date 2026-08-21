import { describe, it, expect } from "vitest";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDoubleDraw } from "./bracketDoubleAdvance";
import { matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";

/**
 * REMATCH QUALITY — what the drop pattern exists to buy.
 *
 * The reversal in `dropSlot` is there so a `main` loser does not land straight back on
 * the person who just knocked them down. That was argued from the structure; this
 * measures it on played-out draws, which is the only way to know it holds at every size.
 *
 * A rematch is not automatically wrong. Two entrants can legitimately meet again after
 * several rounds, and in the grand final they are SUPPOSED to. What must never happen is
 * the structural case — an entrant meeting their conqueror in the very next match they
 * play, manufactured by the mapping rather than produced by results.
 */

const play = (n: number): ResolvedMatch[] => {
  const draw = buildDoubleDraw(n);
  const winners: WinnerBySeed = {};
  for (let i = 0; i < draw.length + 5; i++) {
    const resolved = resolveDoubleDraw(draw, winners);
    const next = resolved.find((m) => m.playable);
    if (!next) return resolved;
    winners[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
  }
  throw new Error("did not settle at " + n);
};

/** Every contested, decided pairing, in play order. */
const meetings = (resolved: ResolvedMatch[]) =>
  resolved
    .filter((m) => !m.bye && m.aSeed !== null && m.bSeed !== null && m.winnerSeed !== null)
    .map((m) => ({ ref: matchKey(m), a: m.aSeed!, b: m.bSeed!, winner: m.winnerSeed!, bracket: m.bracket }));

describe("the drop pattern's rematch behaviour", () => {
  it.each([8, 16, 32, 64])("never sends a dropper straight back onto their conqueror at %i", (n) => {
    const met = meetings(play(n));
    const beatenBy = new Map<number, { by: number; at: number }>();
    const offences: string[] = [];

    met.forEach((m, i) => {
      for (const seat of [m.a, m.b]) {
        const prior = beatenBy.get(seat);
        if (!prior) continue;
        const other = seat === m.a ? m.b : m.a;
        const nothingInBetween = met
          .slice(prior.at + 1, i)
          .every((x) => x.a !== seat && x.b !== seat);
        if (other === prior.by && nothingInBetween && m.bracket === "lower") {
          offences.push(m.ref + ": seed " + seat + " replays " + prior.by + " immediately");
        }
      }
      const loser = m.winner === m.a ? m.b : m.a;
      beatenBy.set(loser, { by: m.winner, at: i });
    });

    expect(offences, "immediate rematches at " + n + ": " + offences.join("; ")).toEqual([]);
  });

  it.each([8, 16, 32, 64])("only ever rematches for a structural reason at %i", (n) => {
    /**
     * The first version of this asserted a rematch RATE below 10% and failed at 14%,
     * which measured nothing. Listing the offenders showed every one was structural:
     *
     *   1 v 2   main final -> grand final    the grand final IS a rematch, by design
     *   2 v 3   main semi  -> lower final    both semi-finalists drop, and the lower
     *                                        final is where the main-final loser meets
     *                                        the lower survivor. No mapping avoids it.
     *
     * So the honest property is not "few rematches" but "no rematch the mapping caused".
     * A rematch is structural when BOTH entrants played somebody else in between — the
     * tournament brought them back together, rather than the drop map handing one
     * straight to the other.
     */
    const met = meetings(play(n));
    const manufactured: string[] = [];

    met.forEach((m, i) => {
      // The GRAND FINAL is excluded, and definitionally rather than as a concession:
      // it is a rematch by design, and the main-bracket winner plays NOTHING between
      // their last match and it — they idle while the lower bracket resolves. So "both
      // played someone in between" can never hold there, and requiring it would be
      // asserting that the format's defining match is a defect.
      if (m.bracket === "final") return;
      const previous = met
        .map((x, j) => ({ x, j }))
        .filter(({ x, j }) => j < i && ((x.a === m.a && x.b === m.b) || (x.a === m.b && x.b === m.a)))
        .pop();
      if (!previous) return;
      const between = met.slice(previous.j + 1, i);
      const aPlayed = between.some((x) => x.a === m.a || x.b === m.a);
      const bPlayed = between.some((x) => x.a === m.b || x.b === m.b);
      if (!aPlayed || !bPlayed) {
        manufactured.push(m.ref + ": " + m.a + " v " + m.b + " with no match in between");
      }
    });

    expect(
      manufactured,
      "rematches the structure did not require at " + n + ": " + manufactured.join("; "),
    ).toEqual([]);
  });
});
