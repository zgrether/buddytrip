import { describe, it, expect } from "vitest";
import { seedTeamName, suggestShortName } from "./teamColors";

/**
 * The team sheet's short-name suggestion (migration 219 made short names unique
 * within a competition). The case it exists for: names in the app's own
 * "Team A" style used to all suggest "TEA", so the second such team was refused.
 */
describe("suggestShortName", () => {
  it("a \"Team X\" name suggests X, matching the seeded teams' own short names", () => {
    expect(suggestShortName("Team C")).toBe("C");
    expect(suggestShortName(seedTeamName(3).name)).toBe(seedTeamName(3).shortName);
  });

  it("CONTROL: two \"Team\" names no longer suggest the same short name", () => {
    expect(suggestShortName("Team C")).not.toBe(suggestShortName("Team D"));
  });

  it("otherwise the first three letters, spaces dropped, upper-cased", () => {
    expect(suggestShortName("Red Devils")).toBe("RED");
    expect(suggestShortName("blue")).toBe("BLU");
  });

  it("a team literally named \"Team\" keeps its letters", () => {
    expect(suggestShortName("Team")).toBe("TEA");
  });
});
