import { describe, it, expect } from "vitest";
import { computeStrokePlayStandings } from "./strokePlay";

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
