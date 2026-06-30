import { describe, it, expect } from "vitest";
import { isTeamCaptain } from "./useCanEditTeam";

describe("isTeamCaptain", () => {
  const assignments = [
    { user_id: "u1", team_id: "tA", is_captain: true },
    { user_id: "u2", team_id: "tA", is_captain: false },
    { user_id: "u3", team_id: "tB", is_captain: true },
  ];

  it("is true for the captain of the given team", () => {
    expect(isTeamCaptain(assignments, "u1", "tA")).toBe(true);
    expect(isTeamCaptain(assignments, "u3", "tB")).toBe(true);
  });

  it("is false for a non-captain member of the team", () => {
    expect(isTeamCaptain(assignments, "u2", "tA")).toBe(false);
  });

  it("is false when the captain is on a different team", () => {
    // u1 captains tA, NOT tB — captaincy is scoped to the team.
    expect(isTeamCaptain(assignments, "u1", "tB")).toBe(false);
    expect(isTeamCaptain(assignments, "u3", "tA")).toBe(false);
  });

  it("is false for a user with no assignment", () => {
    expect(isTeamCaptain(assignments, "u9", "tA")).toBe(false);
  });

  it("guards null/undefined inputs", () => {
    expect(isTeamCaptain(undefined, "u1", "tA")).toBe(false);
    expect(isTeamCaptain(assignments, null, "tA")).toBe(false);
    expect(isTeamCaptain(assignments, "u1", null)).toBe(false);
  });
});
