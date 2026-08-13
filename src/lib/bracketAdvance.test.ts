import { describe, it, expect } from "vitest";
import { buildDraw } from "./bracket";
import {
  resolveDraw,
  matchKey,
  championSeed,
  drawComplete,
  type WinnerBySeed,
} from "./bracketAdvance";

/**
 * Advancement — the DERIVED half of the bracket.
 *
 * `bracket_matches` stores round-1 seeds and at most a winner per match; every
 * other occupant in the tree is computed from those (migration 112). These tests
 * pin that computation, because it is the thing an undo depends on: clear a
 * winner and everything above it must re-derive with nothing left behind.
 */

/** Record a winner for (round, slot) of the main draw. */
function win(winners: WinnerBySeed, round: number, slot: number, seed: number): WinnerBySeed {
  return { ...winners, [matchKey({ bracket: "main", round, slot })]: seed };
}
const at = (resolved: ReturnType<typeof resolveDraw>, round: number, slot: number, bracket: "main" | "consolation" = "main") =>
  resolved.find((m) => m.bracket === bracket && m.round === round && m.slot === slot)!;

describe("resolveDraw — round 1 is what was stored", () => {
  it("carries the seeded pairings through untouched", () => {
    const r = resolveDraw(buildDraw(4));
    expect([at(r, 1, 1).aSeed, at(r, 1, 1).bSeed]).toEqual([1, 4]);
    expect([at(r, 1, 2).aSeed, at(r, 1, 2).bSeed]).toEqual([2, 3]);
  });

  it("an empty draw resolves to nothing", () => {
    // Below two entrants `buildDraw` returns []; there is no tree to stand in.
    expect(resolveDraw(buildDraw(1))).toEqual([]);
    expect(resolveDraw([])).toEqual([]);
  });

  it("later rounds start empty — an unknown occupant is shown as unknown", () => {
    const r = resolveDraw(buildDraw(4));
    expect([at(r, 2, 1).aSeed, at(r, 2, 1).bSeed]).toEqual([null, null]);
    expect(at(r, 2, 1).playable).toBe(false);
  });
});

describe("resolveDraw — winners feed upward", () => {
  it("slot 1 lands in seat A, slot 2 in seat B", () => {
    // The inverse of buildDraw's halving, and the case that silently transposes
    // the whole tree if it is ever written backwards.
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 4);
    w = win(w, 1, 2, 2);
    const r = resolveDraw(buildDraw(4), w);
    expect([at(r, 2, 1).aSeed, at(r, 2, 1).bSeed]).toEqual([4, 2]);
    expect(at(r, 2, 1).playable).toBe(true);
  });

  it("half a pairing is still not a fixture", () => {
    const r = resolveDraw(buildDraw(4), win({}, 1, 1, 1));
    expect([at(r, 2, 1).aSeed, at(r, 2, 1).bSeed]).toEqual([1, null]);
    expect(at(r, 2, 1).playable).toBe(false);
  });

  it("advances across THREE rounds of an 8-draw", () => {
    let w: WinnerBySeed = {};
    // Quarters: the better seed wins each.
    for (const [slot, seed] of [[1, 1], [2, 4], [3, 2], [4, 3]] as const) w = win(w, 1, slot, seed);
    let r = resolveDraw(buildDraw(8), w);
    expect([at(r, 2, 1).aSeed, at(r, 2, 1).bSeed]).toEqual([1, 4]);
    expect([at(r, 2, 2).aSeed, at(r, 2, 2).bSeed]).toEqual([2, 3]);

    // Semis.
    w = win(w, 2, 1, 1);
    w = win(w, 2, 2, 2);
    r = resolveDraw(buildDraw(8), w);
    expect([at(r, 3, 1).aSeed, at(r, 3, 1).bSeed]).toEqual([1, 2]);
    expect(championSeed(r)).toBeNull();

    w = win(w, 3, 1, 2);
    expect(championSeed(resolveDraw(buildDraw(8), w))).toBe(2);
  });

  it("clearing a winner re-derives everything above it — the one-column undo", () => {
    // The property migration 112's derived model exists to buy. Removing the key
    // must leave NOTHING of the old advancement behind.
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1);
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    const before = resolveDraw(buildDraw(4), w);
    expect(championSeed(before)).toBe(1);

    const { [matchKey({ bracket: "main", round: 1, slot: 1 })]: _dropped, ...rest } = w;
    const after = resolveDraw(buildDraw(4), rest);
    expect([at(after, 2, 1).aSeed, at(after, 2, 1).bSeed]).toEqual([null, 2]);
    // The final's own recorded winner is no longer an occupant, so it goes too.
    expect(championSeed(after)).toBeNull();
  });
});

describe("resolveDraw — byes", () => {
  it("a bye advances with no pick recorded", () => {
    // 3 entrants in a 4-seat draw: seed 1 has no opponent. Nobody played, so the
    // row stores no winner — the advance is computed instead.
    const r = resolveDraw(buildDraw(3));
    expect(at(r, 1, 1).bye).toBe(true);
    expect(at(r, 1, 1).winnerSeed).toBe(1);
    expect(at(r, 2, 1).aSeed).toBe(1);
  });

  it("a bye is never offered as something to decide", () => {
    const r = resolveDraw(buildDraw(3));
    expect(at(r, 1, 1).playable).toBe(false);
    expect(at(r, 1, 2).playable).toBe(true);
  });

  it("a full field has no byes at all", () => {
    expect(resolveDraw(buildDraw(8)).every((m) => !m.bye)).toBe(true);
  });
});

describe("resolveDraw — a stale winner is dropped, not trusted", () => {
  it("ignores a winner who isn't in the match", () => {
    // Reachable rather than theoretical: HAS_PICKS refuses a REBUILD once a
    // winner exists, but nothing guarantees a leftover pick still names someone
    // in the match it is attached to. Advancing a seed that isn't playing is
    // worse than showing the match undecided.
    const r = resolveDraw(buildDraw(4), win({}, 1, 1, 3)); // seed 3 is in slot 2
    expect(at(r, 1, 1).winnerSeed).toBeNull();
    expect(at(r, 1, 1).playable).toBe(true);
    expect(at(r, 2, 1).aSeed).toBeNull();
  });

  it("accepts either occupant, not just the better seed", () => {
    const r = resolveDraw(buildDraw(4), win({}, 1, 1, 4));
    expect(at(r, 1, 1).winnerSeed).toBe(4);
  });
});

describe("resolveDraw — the consolation match", () => {
  const draw4 = buildDraw(4, { consolation: true });

  it("is contested by the two losing semi-finalists", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1); // 1 beats 4
    w = win(w, 1, 2, 2); // 2 beats 3
    const r = resolveDraw(draw4, w);
    expect([at(r, 2, 1, "consolation").aSeed, at(r, 2, 1, "consolation").bSeed]).toEqual([4, 3]);
    expect(at(r, 2, 1, "consolation").playable).toBe(true);
  });

  it("waits for BOTH semis — a match in progress has no loser", () => {
    const r = resolveDraw(draw4, win({}, 1, 1, 1));
    expect([at(r, 2, 1, "consolation").aSeed, at(r, 2, 1, "consolation").bSeed]).toEqual([4, null]);
    expect(at(r, 2, 1, "consolation").playable).toBe(false);
  });

  it("takes the loser whichever side won", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 4); // the weaker seed advances
    w = win(w, 1, 2, 3);
    const r = resolveDraw(draw4, w);
    expect([at(r, 2, 1, "consolation").aSeed, at(r, 2, 1, "consolation").bSeed]).toEqual([1, 2]);
  });

  it("a 2-entrant draw has no consolation match to resolve", () => {
    // One round means the "losers of the semis" are one person. buildDraw
    // declines to emit the row; nothing here should invent it.
    const r = resolveDraw(buildDraw(2, { consolation: true }));
    expect(r.filter((m) => m.bracket === "consolation")).toEqual([]);
  });
});

describe("drawComplete / championSeed", () => {
  it("an unplayed draw is not complete", () => {
    expect(drawComplete(resolveDraw(buildDraw(4)))).toBe(false);
  });

  it("complete means nothing is left playable — including the consolation", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1);
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    // The final is decided, but 3rd place is not — so the bracket is not done.
    const withConsolation = resolveDraw(buildDraw(4, { consolation: true }), w);
    expect(championSeed(withConsolation)).toBe(1);
    expect(drawComplete(withConsolation)).toBe(false);

    w = { ...w, [matchKey({ bracket: "consolation", round: 2, slot: 1 })]: 4 };
    expect(drawComplete(resolveDraw(buildDraw(4, { consolation: true }), w))).toBe(true);
  });

  it("a byes-only round doesn't block completion", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    expect(drawComplete(resolveDraw(buildDraw(3), w))).toBe(true);
  });

  it("an empty draw is not 'complete' — there was nothing to finish", () => {
    expect(drawComplete([])).toBe(false);
  });
});
