import { describe, it, expect } from "vitest";
import {
  computeStrokeLeaderboard,
  computeStrokePlayStandings,
  computeStrokeTeamStandings,
  netStrokeEntries,
  netStrokeEntriesByHole,
  rankingDirection,
  stablefordEntries,
  type RawStrokeEntry,
} from "./strokePlay";
import { STABLEFORD_PRESETS } from "./stableford";

/**
 * RANKING DIRECTION — Traditional ranks LOW-wins, Stableford ranks HIGH-wins.
 *
 * Stableford is the first format in this app whose direction depends on a
 * CONFIG FLAG rather than on its type. #1245 is the precedent for what a missed
 * consumer costs: a team that won 35 read as "position 35" and the cup went to
 * the side that lost every match.
 *
 * ── The two builds this file exists to fail ────────────────────────────────
 *
 *   · A DIRECTION-BLIND BUILD — Stableford computed correctly per hole and then
 *     ranked lowest-first, so the worst card wins. Every points assertion in
 *     `stableford.test.ts` passes against it; only the ranking cases here fail.
 *   · A BUILD THAT CHANGED THE TRADITIONAL PATH to accommodate the new one.
 *     That is the constraint the whole timing of this feature rests on, so it
 *     is asserted directly rather than left to the absence of a red test
 *     elsewhere.
 */

const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;
const PAR4 = { "1": 4, "2": 4, "3": 4 };

/** Three holes of gross, one player. */
function gross(pid: string, ...values: number[]): RawStrokeEntry[] {
  return values.map((v, i) => ({ participant_id: pid, unit_label: String(i + 1), value: v }));
}

describe("rankingDirection is the one mapping", () => {
  it("traditional is low_wins and stableford is high_wins", () => {
    expect(rankingDirection("traditional")).toBe("low_wins");
    expect(rankingDirection("stableford")).toBe("high_wins");
  });
});

describe("TRADITIONAL is unchanged — the constraint the timing rests on", () => {
  const entries = [
    { participant_id: "a", value: 90 },
    { participant_id: "b", value: 80 },
    { participant_id: "c", value: 80 },
    { participant_id: "d", value: 95 },
  ];

  it("ranks lowest first with ties sharing, exactly as before", () => {
    const s = computeStrokePlayStandings(["a", "b", "c", "d"], entries);
    // Standard competition ranking: 1, 1, 3, 4 — the literal shape, not a property.
    expect(s.map((r) => [r.entityId, r.rawScore, r.position])).toEqual([
      ["b", 80, 1],
      ["c", 80, 1],
      ["a", 90, 3],
      ["d", 95, 4],
    ]);
  });

  it("the new default is INDISTINGUISHABLE from passing traditional explicitly", () => {
    // The default is what every existing caller now takes. If the two ever
    // differed, every Traditional game in the app would be scored by a path
    // nothing tests.
    expect(computeStrokePlayStandings(["a", "b", "c", "d"], entries)).toEqual(
      computeStrokePlayStandings(["a", "b", "c", "d"], entries, { scoring: "traditional" })
    );
  });

  it("team standings still rank lowest total first by default", () => {
    const s = computeStrokePlayStandings(["a", "b"], entries.slice(0, 2));
    const t = computeStrokeTeamStandings(s, { a: "T1", b: "T2" });
    expect(t.map((r) => [r.teamId, r.total, r.position])).toEqual([
      ["T2", 80, 1],
      ["T1", 90, 2],
    ]);
  });

  it("the leaderboard still ranks by to-par, best first, with no rubric", () => {
    const rows = computeStrokeLeaderboard(
      ["a", "b"],
      [...gross("a", 5, 5, 5), ...gross("b", 3, 3, 3)].map((e) => ({ ...e, value: e.value as number })),
      PAR4,
      null
    );
    expect(rows.map((r) => [r.entityId, r.toPar, r.position])).toEqual([
      ["b", -3, 1],
      ["a", 3, 2],
    ]);
    // The new field is inert on the Traditional path — not merely unread.
    expect(rows.every((r) => r.points === 0)).toBe(true);
  });
});

describe("STABLEFORD ranks the HIGHEST total first", () => {
  // Two cards on three par-4s under BBMI 2024 (par 4, bogey 2, double 1, triple 0):
  //   good:  4,4,4  → par,par,par     → 4+4+4 = 12
  //   bad:   6,6,6  → double ×3       → 1+1+1 = 3
  const good = gross("good", 4, 4, 4);
  const bad = gross("bad", 6, 6, 6);
  const points = stablefordEntries(netStrokeEntriesByHole([...good, ...bad], {}), PAR4, BBMI);

  it("scores each card off the rubric", () => {
    const total = (pid: string) =>
      points.filter((p) => p.participant_id === pid).reduce((a, p) => a + (p.value ?? 0), 0);
    expect(total("good")).toBe(12);
    expect(total("bad")).toBe(3);
  });

  it("gives position 1 to the HIGHER total", () => {
    // THE DIRECTION-BLIND BUILD FAILS HERE AND ONLY HERE. Ranked low-wins, the
    // 3-point card would read position 1 — 35-points-is-35th-place, in a
    // different format.
    const s = computeStrokePlayStandings(["good", "bad"], points, { scoring: "stableford" });
    expect(s.find((r) => r.entityId === "good")!.position).toBe(1);
    expect(s.find((r) => r.entityId === "bad")!.position).toBe(2);
    // And the sorted ORDER, not only the position field — the leaderboard reads
    // the array order in places, so both have to be right.
    expect(s.map((r) => r.entityId)).toEqual(["good", "bad"]);
  });

  it("gives the cup to the team with MORE points", () => {
    // The roll-up ranks `position`, so this is where a Stableford competition
    // is won or lost — the team position must already be direction-correct
    // before `game_results` is written.
    const s = computeStrokePlayStandings(["good", "bad"], points, { scoring: "stableford" });
    const t = computeStrokeTeamStandings(s, { good: "T1", bad: "T2" }, "stableford");
    expect(t.map((r) => [r.teamId, r.total, r.position])).toEqual([
      ["T1", 12, 1],
      ["T2", 3, 2],
    ]);
  });

  it("ties share a position under high_wins too", () => {
    const tied = [
      { participant_id: "x", value: 30 },
      { participant_id: "y", value: 30 },
      { participant_id: "z", value: 20 },
    ];
    const s = computeStrokePlayStandings(["x", "y", "z"], tied, { scoring: "stableford" });
    expect(s.map((r) => [r.entityId, r.position])).toEqual([
      ["x", 1],
      ["y", 1],
      ["z", 3],
    ]);
  });

  it("the surface leaderboard ranks by POINTS, highest first — where TO-PAR would disagree", () => {
    /**
     * THE FIXTURE IS THE POINT, and the first version of this test did not have
     * it. With two cards where the better score and the better points agree,
     * ranking by to-par and ranking by points give the same order — so a board
     * that ignored the rubric entirely passed. (Found by mutation, not by
     * reading: the mutant survived and the assertion looked specific.)
     *
     * These two disagree, which is the whole reason Stableford exists:
     *   steady — three bogeys      → to-par +3, points 2+2+2 = 6
     *   spiky  — two pars, one 12  → to-par +8, points 4+4+0 = 8
     *
     * The blow-up hole stops costing past the floor, so `spiky` has the WORSE
     * card and the BETTER points. A board ranking on to-par puts `steady` on
     * top; the correct one puts `spiky` there.
     */
    const steady = gross("steady", 5, 5, 5);
    const spiky = gross("spiky", 4, 4, 12);
    const netted = netStrokeEntriesByHole([...steady, ...spiky], {});

    const rows = computeStrokeLeaderboard(["steady", "spiky"], netted, PAR4, BBMI);
    expect(rows.map((r) => [r.entityId, r.points, r.toPar, r.position])).toEqual([
      ["spiky", 8, 8, 1],
      ["steady", 6, 3, 2],
    ]);

    // The same two cards WITHOUT a rubric rank the other way round — which is
    // what makes the case above evidence rather than a coincidence.
    const traditional = computeStrokeLeaderboard(["steady", "spiky"], netted, PAR4, null);
    expect(traditional.map((r) => r.entityId)).toEqual(["steady", "spiky"]);
  });

  it("reports each player's points on the board row", () => {
    const rows = computeStrokeLeaderboard(
      ["good", "bad"],
      netStrokeEntriesByHole([...good, ...bad], {}),
      PAR4,
      BBMI
    );
    expect(rows.map((r) => [r.entityId, r.points, r.position])).toEqual([
      ["good", 12, 1],
      ["bad", 3, 2],
    ]);
    // A not-started player still sorts to the bottom rather than leading on 0
    // points — "resolved to nothing" and "nothing yet" are not the same state.
    const withLate = computeStrokeLeaderboard(
      ["good", "bad", "late"],
      netStrokeEntriesByHole([...good, ...bad], {}),
      PAR4,
      BBMI
    );
    expect(withLate[withLate.length - 1].entityId).toBe("late");
    expect(withLate.find((r) => r.entityId === "late")!.started).toBe(false);
  });
});

describe("the label-preserving net variant", () => {
  it("agrees value-for-value with netStrokeEntries", () => {
    // The two must not drift: `netStrokeEntries` is now expressed through this
    // one, and that is only safe while the values are identical.
    const raw = gross("p", 5, 4, 6);
    const stroked = { p: new Set(["1", "3"]) };
    expect(netStrokeEntriesByHole(raw, stroked).map((e) => ({ participant_id: e.participant_id, value: e.value })))
      .toEqual(netStrokeEntries(raw, stroked));
  });

  it("keeps the hole label, which is the whole reason it exists", () => {
    expect(netStrokeEntriesByHole(gross("p", 5, 4), {}).map((e) => e.unit_label)).toEqual(["1", "2"]);
  });

  it("nets to gross when nobody has a handicap", () => {
    expect(netStrokeEntriesByHole(gross("p", 5, 4, 6), {}).map((e) => e.value)).toEqual([5, 4, 6]);
  });
});

describe("stablefordEntries — a hole with no par is SKIPPED, not scored", () => {
  it("does not treat a missing par as par 0", () => {
    // Par 0 would make every hole a +5 catch-all and hand out the floor value
    // for a hole the course snapshot simply does not describe. Empty is not
    // "resolved to the worst".
    const netted = netStrokeEntriesByHole(gross("p", 4, 4, 4), {});
    const out = stablefordEntries(netted, { "1": 4, "2": 4 }, BBMI); // no par for hole 3
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.value === 4)).toBe(true);
  });
});
