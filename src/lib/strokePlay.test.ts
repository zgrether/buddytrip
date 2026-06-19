import { describe, it, expect } from "vitest";
import { computeStrokePlayStandings, netStrokeEntries } from "./strokePlay";
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
