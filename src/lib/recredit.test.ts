import { describe, it, expect } from "vitest";
import { recreditTeamRows, recreditedRoster, TEAM_SCORING } from "./recredit";

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

// Alice 70, Bob 72 on Red; Cara 71 on Blue. Bob is re-credited to Blue.
const PEOPLE = [
  { entity_id: "alice", raw_score: 70, position: 1 },
  { entity_id: "bob", raw_score: 72, position: 3 },
  { entity_id: "cara", raw_score: 71, position: 2 },
];
const ROSTER = { alice: "red", bob: "red", cara: "blue" };

describe("recreditedRoster — only the one person's entry moves", () => {
  it("to a team", () => {
    expect(recreditedRoster(ROSTER, "bob", "blue")).toEqual({ alice: "red", bob: "blue", cara: "blue" });
  });
  it("to no team: the entry is REMOVED, which is what 'on no team then' means (ruling 17)", () => {
    expect(recreditedRoster(ROSTER, "bob", null)).toEqual({ alice: "red", cara: "blue" });
  });
  it("leaves the input alone", () => {
    const before = { ...ROSTER };
    recreditedRoster(ROSTER, "bob", "blue");
    expect(ROSTER).toEqual(before);
  });
});

describe("recreditTeamRows — the team rows a finalize through the new roster would write", () => {
  it("traditional stroke: lowest total first, Bob's 72 now in Blue's total", () => {
    const rows = recreditTeamRows(PEOPLE, recreditedRoster(ROSTER, "bob", "blue"), "traditional", ids());
    expect(rows).toEqual([
      { id: "id-1", entity_id: "red", entity_type: "team", raw_score: 70, position: 1, value_kind: "rank",
        competition_points_earned: null, points: null, credited_team_id: "red" },
      { id: "id-2", entity_id: "blue", entity_type: "team", raw_score: 143, position: 2, value_kind: "rank",
        competition_points_earned: null, points: null, credited_team_id: "blue" },
    ]);
  });

  it("CONTROL: through the unchanged roster the totals are the original ones", () => {
    const rows = recreditTeamRows(PEOPLE, ROSTER, "traditional", ids());
    expect(rows.map((r) => [r.entity_id, r.raw_score, r.position])).toEqual([["blue", 71, 1], ["red", 142, 2]]);
  });

  it("skins ranks MORE first — the direction comes from the format, not a default", () => {
    const skins = [
      { entity_id: "alice", raw_score: 1, position: 2 },
      { entity_id: "bob", raw_score: 4, position: 1 },
      { entity_id: "cara", raw_score: 0, position: 3 },
    ];
    const rows = recreditTeamRows(skins, ROSTER, TEAM_SCORING.gtt_skins(null), ids());
    expect(rows.map((r) => [r.entity_id, r.position])).toEqual([["red", 1], ["blue", 2]]);
  });

  it("a person row with no score is left out, as the writer leaves out a player who did not finish", () => {
    const rows = recreditTeamRows(
      [...PEOPLE, { entity_id: "dan", raw_score: null, position: null }],
      { ...ROSTER, dan: "blue" },
      "traditional",
      ids()
    );
    expect(rows.find((r) => r.entity_id === "blue")?.raw_score).toBe(71);
  });
});
