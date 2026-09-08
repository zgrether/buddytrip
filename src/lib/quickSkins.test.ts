import { describe, it, expect } from "vitest";
import {
  buildQuickGameFromDrafts,
  fmtSkins,
  hasAnyScore,
  migrateQuickGameState,
  quickFormatPlayerCountError,
  quickGamePips,
  quickGameSubtitle,
  quickSkinsGloriousAvailable,
  quickSkinsMoney,
  quickSkinsRows,
  quickSkinsStandings,
  quickSkinsTally,
  QUICK_GAME_STATE_VERSION,
  QUICK_SKINS_GROUPING,
  type QuickSkinsState,
} from "./quickGame";
import { EMPTY_SIDE_BETS } from "./sideBets";
import { buildCourseSnapshot, type CourseSnapshotInput } from "./courseSnapshot";

/**
 * Quick Skins — the format backed by local storage.
 *
 * The FOLD is `src/lib/skins.ts`'s and is proven there; what is at stake here
 * is that this round hands it the right rows, that the money over the top is
 * zero-sum and prices a skin the way the side-bet layer does, and that the
 * things a `values`-shaped format takes for granted (started, handicaps, the
 * subtitle) answer correctly for a round that never writes `values` at all.
 */

const P4 = [
  { id: "p1", name: "Zach Grether", color: "#2dd4bf" },
  { id: "p2", name: "Buddy Jones", color: "#60a5fa" },
  { id: "p3", name: "Mike Reid", color: "#f59e0b" },
  { id: "p4", name: "Ryan Cole", color: "#a855f7" },
];

/** A course of `n` holes, in the shape `buildCourseSnapshot` really takes —
 *  the same fixture `quickGameBets.test.ts` uses, so neither file is measuring
 *  a snapshot the app never builds. */
function courseOf(n: number, id = `c${n}`) {
  const input: CourseSnapshotInput = {
    hole_count: n,
    par: Array.from({ length: n }, () => 4),
    handicap_index: Array.from({ length: n }, (_, i) => i + 1),
  };
  const snap = buildCourseSnapshot(input, "gtt_skins", undefined);
  if (!snap.ok) throw new Error("fixture course is not usable");
  return { id, name: `${n} holes`, schema: snap.schema };
}
const course18 = () => courseOf(18, "c1");

function skinsGame(over: Partial<QuickSkinsState> = {}): QuickSkinsState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    format: "skins",
    players: P4,
    values: {},
    finished: false,
    currentHole: 1,
    course: course18(),
    bets: EMPTY_SIDE_BETS,
    outcomes: {},
    stake: 10,
    modifiers: {},
    ...over,
  };
}

/** Hole → who took it, in the stored shape. `null` records a tie. */
const won = (byHole: Record<number, string | null>): QuickSkinsState["outcomes"] => {
  const out: QuickSkinsState["outcomes"] = {};
  for (const [h, id] of Object.entries(byHole)) {
    out[h] = id == null ? { result: "tied" } : { result: "won", winnerId: id };
  }
  return out;
};

describe("the rows handed to the fold", () => {
  it("pairs result and winner, so a tie is not a missing winner", () => {
    const g = skinsGame({ outcomes: won({ 1: "p1", 2: null }) });
    expect(quickSkinsRows(g)).toEqual([
      { hole: 1, result: "won", winnerId: "p1" },
      { hole: 2, result: "tied", winnerId: null },
    ]);
  });

  it("drops a hole the round does not have", () => {
    // A round set up on nine holes must not carry a result for the 14th — the
    // same clamp `quickMatchDecided` applies, and the case a stored payload
    // from a longer course produces after a course change.
    const g = skinsGame({
      course: courseOf(9),
      outcomes: won({ 1: "p1", 14: "p2" }),
    });
    expect(quickSkinsRows(g).map((r) => r.hole)).toEqual([1]);
  });

  it("sorts by hole, whatever order the object was written in", () => {
    // The fold walks holes in order and every pot depends on the ties behind
    // it, so an unsorted list is not merely untidy.
    const g = skinsGame({ outcomes: won({ 5: "p1", 2: null, 9: "p2" }) });
    expect(quickSkinsRows(g).map((r) => r.hole)).toEqual([2, 5, 9]);
  });
});

describe("the tally", () => {
  it("carries a tied pot WHOLE into the next hole", () => {
    const g = skinsGame({ outcomes: won({ 1: null, 2: null, 3: "p1" }) });
    const t = quickSkinsTally(g);
    expect(t.lines[2].pot).toBe(3); // 1 + 1 carried + 1 carried
    expect(t.skinsBy.p1).toBe(3);
    expect(t.awarded).toBe(3);
  });

  it("doubles the last three holes under Glorious, and carries the doubled pot", () => {
    // The worked example in `skins.ts`'s header: 16 tied → 17 holds 4, 17 tied
    // → 18 holds 6. It runs through THIS format's own config reader
    // (`skinsGloriousConfig`), which is the part that could be wrong here.
    const g = skinsGame({
      modifiers: { glorious_holes: { holes: 3 } },
      outcomes: won({ 15: null, 16: null, 17: null, 18: "p2" }),
    });
    const t = quickSkinsTally(g);
    expect(t.lines[15].pot).toBe(3); // 16th: own 2 + 1 carried from the 15th
    expect(t.lines[16].pot).toBe(5); // 17th: own 2 + 3
    expect(t.lines[17].pot).toBe(7); // 18th: own 2 + 5
    expect(t.skinsBy.p2).toBe(7);
  });

  it("kills the pot on a tied final hole, and says so as its own fact", () => {
    const g = skinsGame({ outcomes: won({ 17: null, 18: null }) });
    const t = quickSkinsTally(g);
    expect(t.potIsDead).toBe(true);
    // The 17th was worth 1 and rolled; the 18th was then worth 2 and died.
    expect(t.carried).toBe(2);
    expect(t.awarded).toBe(0);
    // Mid-round the same number means the opposite — what the next hole is
    // worth — which is why the flag exists rather than being inferred.
    expect(quickSkinsTally(skinsGame({ outcomes: won({ 17: null }) })).potIsDead).toBe(false);
  });
});

describe("the money", () => {
  it("splits the skin, so a $10 skin among four is $2.50 each", () => {
    // The same reading `sideStake` gives a skins SIDE BET: `stake` is what the
    // hole is worth, not what one person puts in. Agreeing "$10 skins" on the
    // first tee has to mean one amount whichever route recorded it.
    const g = skinsGame({ outcomes: won({ 1: "p1" }) });
    const { netByPlayer } = quickSkinsMoney(g);
    expect(netByPlayer.p1).toBe(7.5);
    expect(netByPlayer.p2).toBe(-2.5);
    expect(netByPlayer.p3).toBe(-2.5);
    expect(netByPlayer.p4).toBe(-2.5);
  });

  it("scales with the FIELD, not with a four that matched the fixture", () => {
    // Written because a mutant dividing by a hardcoded 4 passed every other
    // case in this block: they all happen to use a foursome. Exactly the shape
    // CLAUDE.md names — a constant that agrees with the fixture is invisible
    // until the fixture stops agreeing with it.
    const three = quickSkinsMoney(
      skinsGame({ players: P4.slice(0, 3), outcomes: won({ 1: "p1" }) })
    ).netByPlayer;
    expect(three.p1).toBe(6.67); // $10 skin, $3.33 from each of two
    expect(three.p2).toBe(-3.33);
    expect(three.p3).toBe(-3.33);

    const two = quickSkinsMoney(
      skinsGame({ players: P4.slice(0, 2), outcomes: won({ 1: "p1" }) })
    ).netByPlayer;
    expect(two.p1).toBe(5);
    expect(two.p2).toBe(-5);
  });

  it("is zero-sum over any distribution of skins", () => {
    // The property the per-player arithmetic can break. Asserted over several
    // shapes rather than one, because a formula that happens to balance for a
    // single winner can be wrong the moment two people win.
    for (const players of [P4, P4.slice(0, 3), P4.slice(0, 2)]) {
      for (const outcomes of [
        won({ 1: "p1" }),
        won({ 1: "p1", 2: "p2" }),
        won({ 1: null, 2: "p2", 5: "p1", 9: "p1" }),
        won({ 1: null, 2: null }),
      ]) {
        const { netByPlayer } = quickSkinsMoney(skinsGame({ players, outcomes }));
        const sum = Object.values(netByPlayer).reduce((a, b) => a + b, 0);
        // Cents, not exact: a $10 skin between three does not divide, so the
        // per-player figures are rounded to something payable and the residue
        // is a cent. Zero-sum to the cent is the honest property.
        expect(sum).toBeCloseTo(0, 1);
      }
    }
  });

  it("charges nobody for a pot destroyed on the last hole", () => {
    // It was never awarded, so it is not in `skinsBy` — the reason the money
    // reads the tally rather than counting holes played.
    const { netByPlayer, settlement } = quickSkinsMoney(skinsGame({ outcomes: won({ 17: null, 18: null }) }));
    expect(Object.values(netByPlayer).every((v) => v === 0)).toBe(true);
    expect(settlement).toEqual([]);
  });

  it("carries the carry into the money, not just into the card", () => {
    // Two ties then a win is a 3-skin hole: $30 on the table, $7.50 from each
    // of the three losers.
    const { netByPlayer } = quickSkinsMoney(skinsGame({ outcomes: won({ 1: null, 2: null, 3: "p1" }) }));
    expect(netByPlayer.p1).toBe(22.5);
    expect(netByPlayer.p2).toBe(-7.5);
  });

  it("says nothing about money at a zero stake, and still counts the skins", () => {
    const g = skinsGame({ stake: 0, outcomes: won({ 1: "p1", 2: "p2" }) });
    const { netByPlayer, settlement } = quickSkinsMoney(g);
    // Zeros, not an empty map: "everyone is square" and "there is no money in
    // this round" are different facts, and the caller is the one that knows
    // which it is looking at.
    expect(netByPlayer).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 });
    expect(settlement).toEqual([]);
    expect(quickSkinsTally(g).skinsBy).toEqual({ p1: 1, p2: 1 });
  });

  it("names who pays whom, once", () => {
    const { settlement } = quickSkinsMoney(skinsGame({ outcomes: won({ 1: "p1", 2: "p1" }) }));
    expect(settlement).toHaveLength(3);
    expect(settlement.every((s) => s.toPlayerId === "p1" && s.amount === 5)).toBe(true);
  });
});

describe("the board", () => {
  it("ranks by skins won, ties sharing a position, and keeps a player on zero", () => {
    const g = skinsGame({ outcomes: won({ 1: "p1", 2: "p1", 3: "p2", 4: "p3" }) });
    const rows = quickSkinsStandings(g);
    expect(rows.map((r) => [r.entityId, r.skins, r.position])).toEqual([
      ["p1", 2, 1],
      ["p2", 1, 2],
      ["p3", 1, 2],
      // Nobody having a bad day drops off the board — the larger half of a
      // skins card is the people on zero.
      ["p4", 0, 4],
    ]);
  });

  it("puts every player in the one grouping a quick round has", () => {
    expect(quickSkinsStandings(skinsGame()).every((r) => r.groupingId === QUICK_SKINS_GROUPING)).toBe(true);
  });
});

describe("what a values-shaped format takes for granted", () => {
  it("counts a recorded hole as STARTED, though `values` is empty forever", () => {
    // CLAUDE.md #27 at local-storage scale: a `values`-only predicate reports
    // "not started" for a skins round played all the way round.
    const g = skinsGame({ outcomes: won({ 1: "p1" }) });
    expect(g.values).toEqual({});
    expect(hasAnyScore(g)).toBe(true);
    expect(hasAnyScore(skinsGame())).toBe(false);
  });

  it("has no handicap pips at all", () => {
    // "No scores, no handicaps" is the format. A pip would promise a shot in a
    // game that nets nothing.
    expect(quickGamePips(skinsGame())).toEqual({});
  });

  it("needs someone to win a skin from", () => {
    expect(quickFormatPlayerCountError("skins", 1)).toBe("Skins needs someone to win them from.");
    expect(quickFormatPlayerCountError("skins", 2)).toBeNull();
  });

  it("offers Glorious over 18 holes and not over 9 — with no entry-mode condition", () => {
    expect(quickSkinsGloriousAvailable({ course: course18() })).toBe(true);
    // `holeWeight` thresholds on `18 − n`, so on a nine-hole card every hole is
    // already past it and the modifier would double the whole round.
    expect(quickSkinsGloriousAvailable({ course: courseOf(9) })).toBe(false);
    // No course is the DEFAULT 18-hole layout, not "no holes" — the same
    // answer `quickMatchGloriousAvailable` gives, and the reason both read
    // `unitsFromSchema` rather than testing `course` for null.
    expect(quickSkinsGloriousAvailable({ course: null })).toBe(true);
  });
});

describe("the subtitle", () => {
  it("names the leader, how far in, and what is riding on the next hole", () => {
    const g = skinsGame({ outcomes: won({ 1: "p1", 2: null }) });
    expect(quickGameSubtitle(g)).toBe("Zach leads with 1 skin thru 2 of 18 · 2 skins on 3");
  });

  it("says nobody has taken one when every hole so far has been tied", () => {
    // Distinct from "not started", which the unscored branch above answers —
    // the round IS under way and the leader question has no answer yet.
    expect(quickGameSubtitle(skinsGame({ outcomes: won({ 1: null }) }))).toBe(
      "Nobody has taken one yet thru 1 of 18 · 2 skins on 2"
    );
  });

  it("reports a dead pot as unpaid, never as riding on a hole that does not exist", () => {
    const g = skinsGame({ outcomes: { ...won({ 18: null }) } });
    expect(quickGameSubtitle(g)).toContain("1 skin unpaid");
  });

  it("falls back to the shared unscored line before anything is recorded", () => {
    expect(quickGameSubtitle(skinsGame())).toBe("Hole 1 of 18 · no scores yet");
  });
});

describe("persistence", () => {
  it("round-trips a played round", () => {
    const g = skinsGame({ outcomes: won({ 1: "p1", 2: null }), stake: 5 });
    const back = migrateQuickGameState(JSON.parse(JSON.stringify(g)));
    expect(back).toEqual(g);
  });

  it("drops a malformed hole rather than repairing it into a tie", () => {
    // "Not played" and "played and tied" are the two states this format turns
    // on. Coercing a half-readable row into either one silently reassigns a
    // hole; absent is the honest answer and the one the entry screen lets
    // somebody fix.
    const back = migrateQuickGameState({
      ...JSON.parse(JSON.stringify(skinsGame())),
      outcomes: { "1": { result: "won" }, "2": { result: "nonsense" }, "3": { result: "tied" }, "4": 7 },
    });
    expect(back && back.format === "skins" && back.outcomes).toEqual({ "3": { result: "tied" } });
  });

  it("treats a missing or negative stake as playing for nothing", () => {
    const raw = JSON.parse(JSON.stringify(skinsGame()));
    delete raw.stake;
    const back = migrateQuickGameState(raw);
    expect(back && back.format === "skins" && back.stake).toBe(0);
    const negative = migrateQuickGameState({ ...JSON.parse(JSON.stringify(skinsGame())), stake: -5 });
    expect(negative && negative.format === "skins" && negative.stake).toBe(0);
  });
});

describe("starting one from the setup drafts", () => {
  const drafts = {
    format: "skins" as const,
    players: [
      { id: "p1", name: "Zach", strokes: 12 },
      { id: "p2", name: "Buddy", strokes: 4 },
    ],
    course: course18(),
    bets: EMPTY_SIDE_BETS,
    entryMode: "score" as const,
    stake: 10,
    relStrokes: 0,
    glorious: true,
    gloriousHoles: 3,
    gloriousAvailable: true,
    teams: {},
  };

  it("carries the stake and the modifier, and starts with nothing recorded", () => {
    const g = buildQuickGameFromDrafts(drafts);
    expect(g && g.format === "skins" && g.stake).toBe(10);
    expect(g && g.format === "skins" && g.modifiers).toEqual({ glorious_holes: { holes: 3 } });
    expect(g && g.format === "skins" && g.outcomes).toEqual({});
  });

  it("refuses to store an INERT modifier", () => {
    // Same guard the match arm applies: a modifier stored but unusable is the
    // "on but does nothing" state that costs a session to diagnose.
    const g = buildQuickGameFromDrafts({ ...drafts, gloriousAvailable: false });
    expect(g && g.format === "skins" && g.modifiers).toEqual({});
  });

  it("ignores the roster's handicaps entirely", () => {
    // The rows carry a `strokes` field because they are the shared
    // `DraftPlayerRow`; skins does not read it, and a round that quietly netted
    // Zach's 12 would be a different game than the one on screen.
    const g = buildQuickGameFromDrafts(drafts);
    expect(g && quickGamePips(g)).toEqual({});
  });
});

describe("fmtSkins", () => {
  it("pluralises, because a bare number reads as a hole number", () => {
    expect(fmtSkins(1)).toBe("1 skin");
    expect(fmtSkins(0)).toBe("0 skins");
    expect(fmtSkins(4)).toBe("4 skins");
  });
});
