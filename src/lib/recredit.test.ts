import { describe, it, expect } from "vitest";
import { finishersByTeam, recreditTeamRows, recreditedRoster, TEAM_SCORING, unequalTeamsNote } from "./recredit";

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

describe("unequalTeamsNote — the direction is the point (#1561's ruling)", () => {
  const TEAMS = [{ teamId: "red", teamName: "Centurions" }, { teamId: "blue", teamName: "Spartans" }];
  const counts = (red: number, blue: number) => new Map([["red", red], ["blue", blue]]);

  it("traditional stroke: the bigger team is at a DISADVANTAGE", () => {
    expect(unequalTeamsNote({ gameName: "Day 1 Stroke", scoring: "traditional", counts: counts(2, 3), teams: TEAMS, mood: "would" })).toBe(
      "Spartans would have three players counting in Day 1 Stroke, Centurions two — in stroke play a team's total is its players' strokes added up, so the bigger team is at a disadvantage."
    );
  });

  it("Stableford: the bigger team is at an ADVANTAGE", () => {
    expect(unequalTeamsNote({ gameName: "Stableford", scoring: "stableford", counts: counts(2, 3), teams: TEAMS, mood: "has" })).toBe(
      "Spartans has three players counting in Stableford, Centurions two — in Stableford a team's total is its players' points added up, so the bigger team is at an advantage."
    );
  });

  it("skins: an advantage, counted in skins", () => {
    expect(unequalTeamsNote({ gameName: "Skins", scoring: "skins", counts: counts(3, 1), teams: TEAMS, mood: "would" })).toBe(
      "Centurions would have three players counting in Skins, Spartans one — in skins a team's total is its players' skins added up, so the bigger team is at an advantage."
    );
  });

  it("equal teams: nothing to say", () => {
    expect(unequalTeamsNote({ gameName: "G", scoring: "traditional", counts: counts(2, 2), teams: TEAMS, mood: "would" })).toBeNull();
  });

  it("a team with nobody counting is named with none — the most unequal case", () => {
    expect(unequalTeamsNote({ gameName: "G", scoring: "traditional", counts: new Map([["red", 2]]), teams: TEAMS, mood: "would" }))
      .toMatch(/^Centurions would have two players counting in G, Spartans none — /);
  });

  it("finishersByTeam counts only people with a result, through the given roster", () => {
    const rows = [...PEOPLE, { entity_id: "dan", raw_score: null, position: null }, { entity_id: "eve", raw_score: 80, position: 4 }];
    expect(finishersByTeam(rows, { ...ROSTER, dan: "blue" })).toEqual(new Map([["red", 2], ["blue", 1]]));
  });
});
