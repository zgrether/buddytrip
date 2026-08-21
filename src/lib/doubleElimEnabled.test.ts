import { describe, it, expect } from "vitest";
import { nonGolfDraftToPayload } from "./configDraft";
import { buildDoubleDraw } from "./bracketDouble";
import { buildDraw } from "./bracket";

/**
 * Choosing Double in settings must PERSIST a double draw.
 *
 * The toggle was disabled for a reason that outlived itself, and the reason was here
 * rather than in the control: `bracketDraw` was built with the single-elim builder
 * unconditionally, so a game saved as "double" would have carried the setting with no
 * lower bracket and no grand final underneath it. Enabling the control without this
 * would have produced games labelled double that were single in the database — the
 * quietest possible failure, since the board would simply render an absent tier.
 */
const draftWith = (elimination: "single" | "double", entrants: number) => ({
  name: "Pool",
  rulesForToday: null,
  scoringEnabled: false,
  pointsTotal: 12,
  pointsDistribution: null,
  delegates: [],
  competitionFormat: "bracket" as const,
  bracketEntrants: Array.from({ length: entrants }, (_, i) => [`u${i + 1}`]),
  bracketConfig: { elimination, entrants: "singles" as const, seeding: "manual" as const, consolation: false },
});

describe("the Double toggle persists a double draw", () => {
  it.each([4, 8, 16])("saves the double structure at %i entrants", (n) => {
    const payload = nonGolfDraftToPayload(draftWith("double", n) as never, draftWith("double", n) as never);
    const draw = payload.bracketDraw ?? [];
    expect(draw).toEqual(buildDoubleDraw(n));
    // The parts that would be silently missing if this regressed.
    expect(draw.some((m) => m.bracket === "lower"), "no lower bracket persisted").toBe(true);
    expect(draw.filter((m) => m.bracket === "final")).toHaveLength(2);
  });

  it.each([4, 8, 16])("still saves the single structure at %i when single is chosen", (n) => {
    const payload = nonGolfDraftToPayload(draftWith("single", n) as never, draftWith("single", n) as never);
    const draw = payload.bracketDraw ?? [];
    expect(draw).toEqual(buildDraw(n, { consolation: false }));
    expect(draw.some((m) => m.bracket === "lower"), "single elim must have no lower bracket").toBe(false);
  });

  it("never persists a consolation match under double elimination", () => {
    // Double produces 3rd structurally; a play-off would be a second answer. The setup
    // row hides for this reason, and the builder cannot emit one either.
    const d = { ...draftWith("double", 8), bracketConfig: { ...draftWith("double", 8).bracketConfig, consolation: true } };
    const payload = nonGolfDraftToPayload(d as never, d as never);
    expect((payload.bracketDraw ?? []).some((m) => m.bracket === "consolation")).toBe(false);
  });
});
