import { describe, it, expect } from "vitest";
import { computeStrokePlayStandings, computeStrokeLeaderboard, netStrokeEntries } from "./strokePlay";
import { strokeHoles } from "./matchPlay";

describe("computeStrokePlayStandings", () => {
  it("sums each participant's values and ranks ascending (low wins)", () => {
    const s = computeStrokePlayStandings(
      ["a", "b"],
      [
        { participant_id: "a", value: 4 },
        { participant_id: "a", value: 5 }, // a = 9
        { participant_id: "b", value: 3 },
        { participant_id: "b", value: 4 }, // b = 7
      ]
    );
    expect(s.find((x) => x.entityId === "b")).toMatchObject({ rawScore: 7, position: 1 });
    expect(s.find((x) => x.entityId === "a")).toMatchObject({ rawScore: 9, position: 2 });
  });

  it("ties share a position; the next position skips (1, 2, 2, 4)", () => {
    const s = computeStrokePlayStandings(
      ["a", "b", "c", "d"],
      [
        { participant_id: "a", value: 5 },
        { participant_id: "b", value: 6 },
        { participant_id: "c", value: 6 },
        { participant_id: "d", value: 9 },
      ]
    );
    const pos = Object.fromEntries(s.map((x) => [x.entityId, x.position]));
    expect(pos).toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });

  it("ignores null cells; a participant with no entries totals 0", () => {
    const s = computeStrokePlayStandings(
      ["a", "b"],
      [
        { participant_id: "a", value: null },
        { participant_id: "a", value: 4 },
      ]
    );
    expect(s.find((x) => x.entityId === "a")?.rawScore).toBe(4);
    expect(s.find((x) => x.entityId === "b")?.rawScore).toBe(0);
  });

  it("produces exactly one row per participant", () => {
    expect(computeStrokePlayStandings(["a", "b", "c"], [])).toHaveLength(3);
  });
});

describe("computeStrokeLeaderboard (surface — to-par, holes-played-relative)", () => {
  const par = { "1": 4, "2": 4, "3": 3 };

  it("ranks by to-par (best first), computing to-par over SCORED holes only", () => {
    const lb = computeStrokeLeaderboard(
      ["a", "b"],
      [
        { participant_id: "a", unit_label: "1", value: 5 }, // +1
        { participant_id: "a", unit_label: "2", value: 4 }, // E  → a: +1 thru 2
        { participant_id: "b", unit_label: "1", value: 3 }, // −1 → b: −1 thru 1
      ],
      par
    );
    expect(lb.map((r) => r.entityId)).toEqual(["b", "a"]); // b (−1) leads a (+1)
    expect(lb.find((r) => r.entityId === "a")).toMatchObject({ totalStrokes: 9, holesPlayed: 2, toPar: 1, position: 2 });
    expect(lb.find((r) => r.entityId === "b")).toMatchObject({ totalStrokes: 3, holesPlayed: 1, toPar: -1, position: 1 });
  });

  it("GATE D — a thru-0 late arrival sorts to the BOTTOM (not falsely 'E'-leading) across mixed hole counts", () => {
    const lb = computeStrokeLeaderboard(
      ["ontime1", "ontime2", "late"],
      [
        // two players ~thru 2, one at +1, one at E; the late arrival has entered nothing.
        { participant_id: "ontime1", unit_label: "1", value: 5 }, // +1
        { participant_id: "ontime1", unit_label: "2", value: 4 }, // E → +1 thru 2
        { participant_id: "ontime2", unit_label: "1", value: 4 }, // E
        { participant_id: "ontime2", unit_label: "2", value: 4 }, // E → E thru 2
      ],
      par
    );
    // The started E player leads; the started +1 player next; the thru-0 late arrival LAST,
    // even though its nominal to-par (0) ties the E player — not-started never outranks started.
    expect(lb.map((r) => r.entityId)).toEqual(["ontime2", "ontime1", "late"]);
    const late = lb.find((r) => r.entityId === "late")!;
    expect(late).toMatchObject({ holesPlayed: 0, toPar: 0, started: false });
    expect(late.position).toBe(3); // trailing position (after the 2 started players)
  });

  it("ties share a position; more holes played breaks the display order", () => {
    const lb = computeStrokeLeaderboard(
      ["deep", "shallow"],
      [
        { participant_id: "deep", unit_label: "1", value: 4 },
        { participant_id: "deep", unit_label: "2", value: 4 }, // E thru 2
        { participant_id: "shallow", unit_label: "1", value: 4 }, // E thru 1
      ],
      par
    );
    // Both at E → share position 1; the deeper round (thru 2) lists first.
    expect(lb.map((r) => r.entityId)).toEqual(["deep", "shallow"]);
    expect(lb.every((r) => r.position === 1)).toBe(true);
  });
});

describe("netStrokeEntries (handicap → net)", () => {
  it("deducts one stroke per stroked hole; players absent from the map net to gross", () => {
    const net = netStrokeEntries(
      [
        { participant_id: "a", unit_label: "1", value: 5 },
        { participant_id: "a", unit_label: "2", value: 4 },
        { participant_id: "b", unit_label: "1", value: 4 },
      ],
      { a: new Set(["1"]) } // a strokes hole 1; b has no handicap entry
    );
    expect(net).toEqual([
      { participant_id: "a", value: 4 }, // 5 gross − 1 stroke on hole 1
      { participant_id: "a", value: 4 }, // hole 2 not stroked → gross
      { participant_id: "b", value: 4 }, // absent from map → gross unchanged
    ]);
  });

  it("drops null cells (an unscored hole)", () => {
    expect(
      netStrokeEntries([{ participant_id: "a", unit_label: "1", value: null }], { a: new Set(["1"]) })
    ).toEqual([]);
  });

  it("a handicap flips the standings: the gross leader loses on net", () => {
    // Course index [1,2,3] — hole 1 is hardest. A is +1 gross but gets 2 strokes
    // (on the two lowest-index holes, "1" and "2") and wins net.
    const index = [1, 2, 3];
    const strokedA = new Set([...strokeHoles(2, index)].map(String));
    expect(strokedA).toEqual(new Set(["1", "2"]));

    const raw = [
      { participant_id: "a", unit_label: "1", value: 5 },
      { participant_id: "a", unit_label: "2", value: 5 },
      { participant_id: "a", unit_label: "3", value: 5 }, // gross 15
      { participant_id: "b", unit_label: "1", value: 4 },
      { participant_id: "b", unit_label: "2", value: 5 },
      { participant_id: "b", unit_label: "3", value: 5 }, // gross 14
    ];

    const gross = computeStrokePlayStandings(
      ["a", "b"],
      raw.map(({ participant_id, value }) => ({ participant_id, value }))
    );
    expect(gross.find((s) => s.entityId === "b")).toMatchObject({ rawScore: 14, position: 1 });
    expect(gross.find((s) => s.entityId === "a")).toMatchObject({ rawScore: 15, position: 2 });

    const net = computeStrokePlayStandings(["a", "b"], netStrokeEntries(raw, { a: strokedA }));
    expect(net.find((s) => s.entityId === "a")).toMatchObject({ rawScore: 13, position: 1 }); // 15 − 2
    expect(net.find((s) => s.entityId === "b")).toMatchObject({ rawScore: 14, position: 2 });
  });

  it("no handicaps → net is byte-identical to gross", () => {
    const raw = [
      { participant_id: "a", unit_label: "1", value: 5 },
      { participant_id: "b", unit_label: "1", value: 4 },
    ];
    expect(netStrokeEntries(raw, {})).toEqual([
      { participant_id: "a", value: 5 },
      { participant_id: "b", value: 4 },
    ]);
  });
});
