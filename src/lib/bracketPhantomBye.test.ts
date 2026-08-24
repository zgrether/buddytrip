import { describe, it, expect } from "vitest";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDoubleDraw } from "./bracketDoubleAdvance";
import { matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";

/**
 * THE PHANTOM BYE — a waiting seat read as permanently empty, so the entrant
 * beside it advanced without playing.
 *
 * From a device report: match 13 took `Winner of 12` and `Loser of 7`. The dropper
 * from 7 arrived first, match 12 was still undecided because ITS feeders had not
 * been played, and the board showed `Johnny D ✓` vs `Bye` with Johnny D already in
 * the grand final.
 *
 * ── Why the existing suite could not catch this ─────────────────────────────
 * `bracketDoubleAdvance.test.ts` plays every draw to completion by repeatedly
 * taking the FIRST playable match. That fills seats in one fixed order, and it is
 * an order in which the bug does not fire: lower rounds resolve as they become
 * playable, so a major's minor feeder is decided before the dropper is looked at.
 * All 649 bracket tests passed against the defect.
 *
 * So the property under test here is ORDER, not outcome. Every test below either
 * constructs a specific intermediate state, or plays the same match set in two
 * different orders and demands the same answer.
 */

const play = (draw: ReturnType<typeof buildDoubleDraw>, winners: WinnerBySeed) =>
  resolveDoubleDraw(draw, winners);

const at = (rs: ResolvedMatch[], bracket: string, round: number, slot: number) =>
  rs.find((m) => m.bracket === bracket && m.round === round && m.slot === slot)!;

/** Record the favourite as winner for every match matching a filter, one pass. */
function decide(
  draw: ReturnType<typeof buildDoubleDraw>,
  winners: WinnerBySeed,
  pick: (m: ResolvedMatch) => boolean,
): WinnerBySeed {
  const out = { ...winners };
  for (let i = 0; i < draw.length + 5; i++) {
    const resolved = resolveDoubleDraw(draw, out);
    const next = resolved.find((m) => m.playable && pick(m));
    if (!next) return out;
    out[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
  }
  throw new Error("did not settle");
}

describe("a dropper arriving before its opposite feeder resolves", () => {
  /**
   * The reported state, reconstructed exactly: decide the WHOLE upper bracket and
   * NOTHING in the lower one.
   *
   * At 8 entrants that leaves the lower final (round 4) holding the upper final's
   * loser in one seat, with the other seat fed by lower round 3 — which is empty
   * because rounds 1-3 are all unplayed. Two null seats on the feeder, which the
   * old test read as "nobody is ever coming".
   */
  it.each([4, 8, 16])("does not become a bye at %i entrants", (n) => {
    const draw = buildDoubleDraw(n);
    const winners = decide(draw, {}, (m) => m.bracket === "main");

    const resolved = play(draw, winners);
    const lower = resolved.filter((m) => m.bracket === "lower");

    // The upper bracket really is finished — otherwise this state is not the one
    // that was reported and the test is exercising something else.
    expect(
      resolved.filter((m) => m.bracket === "main" && m.playable),
      `upper bracket must be complete at ${n}`,
    ).toHaveLength(0);

    // Not one lower match may be a bye: every seat in the lower bracket is either
    // filled or waiting on a match that has not been played, and at these counts
    // there are no upstream byes at all.
    const byes = lower.filter((m) => m.bye).map((m) => `lower:${m.round}:${m.slot}`);
    expect(byes, `phantom byes at ${n}: ${byes.join(", ")}`).toEqual([]);

    // And nobody has reached the grand final from the lower side — the dropper is
    // still waiting to play the lower final.
    const gf = at(resolved, "final", 1, 1);
    expect(gf.bSeed, `nobody may reach the grand final from the lower bracket at ${n}`).toBeNull();
    expect(gf.playable).toBe(false);
  });

  it("the specific reported row: the lower final waits, it does not pass a dropper through", () => {
    // 8 entrants — the size in the report. lower:4:1 is match 13, fed by lower:3:1
    // (match 12) and the loser of main:3:1 (match 7).
    const draw = buildDoubleDraw(8);
    const winners = decide(draw, {}, (m) => m.bracket === "main");
    const resolved = play(draw, winners);

    const lowerFinal = at(resolved, "lower", 4, 1);
    const feeder = at(resolved, "lower", 3, 1);

    // The feeder is genuinely empty RIGHT NOW — this is the state the old code
    // misread, so asserting it keeps the test honest about what it reproduces.
    expect(feeder.aSeed, "the feeder has nobody in it yet").toBeNull();
    expect(feeder.bSeed).toBeNull();
    // …but it is reachable, which is the distinction the fix turns on.
    expect(feeder.neverContested, "the feeder is WAITING, not permanently empty").toBe(false);

    // Exactly one occupant, and it is not going anywhere.
    const occupants = [lowerFinal.aSeed, lowerFinal.bSeed].filter((s) => s !== null);
    expect(occupants, "the dropper is here, alone").toHaveLength(1);
    expect(lowerFinal.bye, "one occupant + a waiting seat is NOT a bye").toBe(false);
    expect(lowerFinal.winnerSeed, "and it has not been won").toBeNull();
    expect(lowerFinal.playable, "nor can it be played yet").toBe(false);
  });
});

describe("a bye is STRUCTURAL, so it can never be transient", () => {
  /**
   * The invariant that actually catches this, and the reason the existing suite
   * did not.
   *
   * THE PHANTOM BYE IS TRANSIENT. Measured on the pre-fix code at 8 entrants:
   *
   *   after all of `main` is decided   → byes: lower:4:1
   *   after everything is decided      → byes: (none)
   *
   * `lower:4:1` is a bye in the middle of the tournament and not at the end,
   * because once its minor feeder finally gains occupants the feed stops reading
   * NEVER and the row becomes a real match again. So every end-state assertion in
   * the suite — all 649 of them — was blind to it by construction, and so was the
   * first version of this block, which compared two completed draws and passed
   * against the bug.
   *
   * That transience is what made it damaging rather than merely wrong: the board
   * showed `Bye`, showed the dropper advanced into the grand final, and let
   * somebody pick a winner there — recording a result for a match whose occupants
   * were going to change.
   *
   * ── The invariant is MONOTONICITY, and the first version of it was wrong ───
   * "The bye set never changes" is too strong, and this test failed against the
   * FIXED code until that was corrected. A bye legitimately APPEARS as its
   * occupant arrives: at 3 entrants `main:1:1` is a bye, so it sends no loser
   * down, and `lower:1:1` holds one permanently-empty seat — but only becomes a
   * bye once `main:1:2` is decided and delivers the other seat's occupant. Before
   * that it is an empty row, not a bye.
   *
   * What can never happen is a bye DISAPPEARING. That is the phantom exactly: the
   * row was called a bye while a real match was still owed to it, and the call was
   * withdrawn once that match produced someone. So the set may only grow.
   */
  it.each([3, 4, 5, 6, 7, 8, 9, 16])("the bye set only ever GROWS at %i entrants", (n) => {
    const draw = buildDoubleDraw(n);
    const byesOf = (w: WinnerBySeed) =>
      new Set(play(draw, w).filter((m) => m.bye).map(matchKey));

    // Walk one match at a time, checking at every step rather than only at the end
    // — the states in between are the only place this lives.
    const w: WinnerBySeed = {};
    let previous = byesOf(w);
    for (let i = 0; i < draw.length + 5; i++) {
      const next = play(draw, w).find((m) => m.playable);
      if (!next) break;
      w[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
      const now = byesOf(w);

      const lost = [...previous].filter((k) => !now.has(k));
      expect(
        lost,
        `at ${n} entrants, deciding ${matchKey(next)} REVOKED a bye on ${lost.join(", ")} — ` +
          `that row was called a bye while a real match was still owed to it`,
      ).toEqual([]);
      previous = now;
    }
  });

  it("the reported order specifically: finishing the upper bracket creates no LOWER bye", () => {
    /**
     * The exact sequence from the device report, asserted as a DELTA rather than a
     * final state. Pre-fix this added `lower:4:1` to the bye set.
     *
     * At 8 entrants the draw is full, so there are no upstream byes anywhere and
     * the legitimate appearance described above cannot occur — which makes the
     * whole lower bracket bye-free at this point, and makes this the cleanest
     * statement of the defect available.
     */
    const draw = buildDoubleDraw(8);
    expect(
      play(draw, {}).filter((m) => m.bracket === "main" && m.bye),
      "precondition: a full 8-draw has no byes to propagate",
    ).toHaveLength(0);

    const afterUpper = play(draw, decide(draw, {}, (m) => m.bracket === "main"));
    const lowerByes = afterUpper.filter((m) => m.bracket === "lower" && m.bye).map(matchKey);
    expect(lowerByes, "deciding the upper bracket must not manufacture a bye").toEqual([]);
  });

  it("a dropper landing before vs after its minor feeder resolves gives the same row", () => {
    const draw = buildDoubleDraw(8);

    // ORDER A — the whole upper bracket, then the lower rounds.
    const afterUpper = decide(draw, {}, (m) => m.bracket === "main");
    const a = decide(draw, afterUpper, () => true);

    // ORDER B — lower rounds 1-3 first (so the minor feeder is decided BEFORE the
    // upper final's loser drops), then everything else.
    const afterMinors = decide(draw, {}, (m) => m.bracket === "lower" && m.round <= 3);
    const b = decide(draw, afterMinors, () => true);

    const ra = play(draw, a);
    const rb = play(draw, b);

    // The lower final was contested in both — not skipped in either.
    for (const [label, rs] of [["A", ra], ["B", rb]] as const) {
      const lf = at(rs, "lower", 4, 1);
      expect(lf.bye, `order ${label}: the lower final must be played, not byed`).toBe(false);
      expect(lf.aSeed, `order ${label}: two real occupants`).not.toBeNull();
      expect(lf.bSeed).not.toBeNull();
    }
  });
});

describe("a genuinely unreachable row still reads as a bye — the regression guard", () => {
  /**
   * The fix must not overcorrect. At entrant counts with byes, a `main` round-1 bye
   * produces no loser, so the lower seat it feeds really is permanently empty and
   * the entrant beside it MUST advance free — the behaviour that makes odd counts
   * work at all.
   */
  it.each([3, 5, 6, 7, 9])("advances a lone occupant past an all-bye chain at %i", (n) => {
    const draw = buildDoubleDraw(n);
    // Decide only main round 1, so the lower bracket sees exactly the round-1
    // droppers — the state in which upstream byes are the ONLY source of emptiness.
    const winners = decide(draw, {}, (m) => m.bracket === "main" && m.round === 1);
    const resolved = play(draw, winners);

    const r1Byes = resolved.filter((m) => m.bracket === "main" && m.round === 1 && m.bye);
    expect(r1Byes.length, `precondition: ${n} entrants must produce round-1 byes`).toBeGreaterThan(0);

    // Some lower round-1 row must be either a bye (one dropper, one never-arriving)
    // or unreachable (no droppers at all) — otherwise the odd-count path is not
    // being exercised and the guard is decorative.
    const lower1 = resolved.filter((m) => m.bracket === "lower" && m.round === 1);
    const byeOrEmpty = lower1.filter((m) => m.bye || m.neverContested);
    expect(
      byeOrEmpty.length,
      `at ${n} entrants the lower bracket must show an upstream-bye effect`,
    ).toBeGreaterThan(0);

    // A bye here advances its occupant, exactly as before the fix.
    for (const m of lower1.filter((x) => x.bye)) {
      expect(m.aSeed, "a bye has its occupant normalised into seat A").not.toBeNull();
      expect(m.winnerSeed, "and advances without a recorded result").toBe(m.aSeed);
    }
  });

  it("plays out to one champion at every count, unchanged", () => {
    // The end-to-end behaviour the fix must preserve. Kept here rather than relying
    // on the existing walk suite, because that suite's fill order is the one the bug
    // hid in — a green there did not mean the format still worked.
    for (const n of [3, 4, 5, 6, 7, 8, 9, 16]) {
      const draw = buildDoubleDraw(n);
      const winners = decide(draw, {}, () => true);
      const resolved = play(draw, winners);
      expect(resolved.filter((m) => m.playable), `settles at ${n}`).toHaveLength(0);
    }
  });
});

describe("neverContested — the field the three sites now share", () => {
  it("is false for a row that is merely waiting, true for one nothing can reach", () => {
    const draw = buildDoubleDraw(8);

    // Nothing played: every lower row is empty, and every one of them is WAITING.
    const fresh = play(draw, {});
    for (const m of fresh.filter((x) => x.bracket === "lower")) {
      expect(m.aSeed).toBeNull();
      expect(m.bSeed).toBeNull();
      expect(
        m.neverContested,
        `lower:${m.round}:${m.slot} is empty but reachable — it must not read unreachable`,
      ).toBe(false);
    }

    // The if-necessary final IS unreachable once the upper entrant takes the first
    // grand final — the one case where "no occupants" is the truth about the row.
    const winners = decide(draw, {}, () => true);
    const resolved = play(draw, winners);
    const gf1 = at(resolved, "final", 1, 1);
    const reset = at(resolved, "final", 2, 1);
    if (gf1.winnerSeed === gf1.aSeed) {
      expect(reset.neverContested, "an unnecessary reset is genuinely unreachable").toBe(true);
    }
  });

  it("round 1 is the only place two null seats mean unreachable", () => {
    // 5 entrants in an 8-draw: main round 1 carries three byes, and no round-1 row
    // is fully empty — so this asserts the RULE, not an accident of the count.
    const draw = buildDoubleDraw(5);
    const fresh = play(draw, {});
    for (const m of fresh.filter((x) => x.bracket === "main" && x.round === 1)) {
      expect(m.neverContested).toBe(m.aSeed === null && m.bSeed === null);
    }
  });
});
