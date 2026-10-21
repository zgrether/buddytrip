import { describe, it, expect } from "vitest";
import {
  STARTING_POINT_IDS,
  STARTING_POINTS,
  createInTurn,
  remainingSuggestions,
  startingPointFits,
  suggestedGames,
  suggestionKey,
  type StartingPointId,
} from "./startingPoints";
import { gameTypesForScoringModel, gameTypesForTeamlessRace, getGameTypeDefinition } from "./gameTypes";
import { headToHeadResultRefusal } from "./headToHeadResult";
import { awardsPerMatch, isPlacement } from "./pointsDistribution";
import { MAX_SEED_TEAMS } from "./teamColors";

/**
 * Starting points (roadmap Next item 1). The catalog is checked against the
 * SAME format declarations the server refuses with, so a change to a format's
 * rules that breaks a starting point fails here rather than on an organizer's
 * tap. The end-to-end half (every suggestion really created through
 * games.create) is in src/server/routers/startingPoints.test.ts.
 */

/** Every team count a starting point can be created with (0 = individuals). */
function teamCounts(id: StartingPointId): number[] {
  const all = [0, ...Array.from({ length: MAX_SEED_TEAMS - 1 }, (_, i) => i + 2)];
  return all.filter((n) => startingPointFits(id, STARTING_POINTS[id].scoringModel, n));
}

describe("every suggestion is a game its starting point can hold", () => {
  for (const id of STARTING_POINT_IDS) {
    for (const teams of teamCounts(id)) {
      it(`${id}, ${teams === 0 ? "individuals" : `${teams} teams`}`, () => {
        const sp = STARTING_POINTS[id];
        const offered = new Set(
          (teams === 0 ? gameTypesForTeamlessRace() : gameTypesForScoringModel(sp.scoringModel)).map((t) => t.id)
        );
        for (const s of suggestedGames(id, teams)) {
          expect(offered.has(s.gameTypeId), `${s.gameTypeId} offered`).toBe(true);
          if (s.competitionFormat) {
            // A format belongs to a manual game, and a head-to-head cup refuses a bracket.
            expect(getGameTypeDefinition(s.gameTypeId)?.resultStrategy).toBeNull();
            if (sp.scoringModel === "match_play") expect(headToHeadResultRefusal(s.gameTypeId, s.competitionFormat)).toBeNull();
          }
          // A placement split adds up to its total, and never has more places than teams.
          if (isPlacement(s.pointsDistribution)) {
            expect(s.pointsDistribution.values.reduce((a, b) => a + b, 0)).toBe(s.pointsTotal);
            if (teams >= 2) expect(s.pointsDistribution.values.length).toBeLessThanOrEqual(teams);
            expect(awardsPerMatch(s.gameTypeId, s.competitionFormat)).toBe(false);
          } else {
            // Awarded match by match: a total, divided across the matches.
            expect(awardsPerMatch(s.gameTypeId, s.competitionFormat) || s.gameTypeId === "gtt_rack_n_stack").toBe(true);
          }
          expect(s.pointsTotal).toBeGreaterThan(0);
        }
        const keys = suggestedGames(id, teams).map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });
    }
  }
});

describe("what each starting point suggests (Zach's rulings)", () => {
  it("Team cup weekend: Match Play and Rack-n-Stack, 8 points each", () => {
    expect(suggestedGames("team_cup_weekend", 2).map((s) => [s.gameTypeId, s.pointsTotal])).toEqual([
      ["gtt_match_play", 8],
      ["gtt_rack_n_stack", 8],
    ]);
  });

  it("Golf week: Stroke Play and Skins as individuals, split 5 · 3 · 2", () => {
    const games = suggestedGames("golf_week", 0);
    expect(games.map((s) => s.gameTypeId)).toEqual(["gtt_stroke_play", "gtt_skins"]);
    for (const s of games) expect(s.pointsDistribution).toEqual({ type: "placement", values: [5, 3, 2] });
  });

  it("Golf week with teams adds Scramble; two teams split 7 · 3, three or more 5 · 3 · 2", () => {
    expect(suggestedGames("golf_week", 2).map((s) => s.gameTypeId)).toEqual(["gtt_stroke_play", "gtt_skins", "gtt_scramble"]);
    expect(suggestedGames("golf_week", 2)[0].pointsDistribution).toEqual({ type: "placement", values: [7, 3] });
    expect(suggestedGames("golf_week", 3)[0].pointsDistribution).toEqual({ type: "placement", values: [5, 3, 2] });
  });

  it("Bar-night bracket: a bar game played as a bracket, split 7 · 3", () => {
    expect(suggestedGames("bar_night_bracket", 2)).toEqual([
      expect.objectContaining({ key: "gtt_generic_bar:bracket", competitionFormat: "bracket", pointsDistribution: { type: "placement", values: [7, 3] } }),
    ]);
  });
});

describe("startingPointFits — what the create procedure accepts", () => {
  it.each([
    ["team_cup_weekend", "match_play", 2, true],
    ["team_cup_weekend", "points", 2, false],
    ["golf_week", "points", 0, true],
    ["golf_week", "points", 3, true],
    ["golf_week", "match_play", 2, false],
    ["bar_night_bracket", "points", 2, true],
    ["bar_night_bracket", "points", 0, false],
  ] as const)("%s, %s, %i teams → %s", (id, model, teams, fits) => {
    expect(startingPointFits(id, model, teams)).toBe(fits);
  });
});

describe("remainingSuggestions — added once a game of the format exists, or skipped", () => {
  const none: { game_type_id: string | null; competition_format: string | null }[] = [];

  it("all of them, on a new competition", () => {
    expect(remainingSuggestions("team_cup_weekend", 2, none, []).map((s) => s.key)).toEqual(["gtt_match_play", "gtt_rack_n_stack"]);
  });

  it("a game of that format, however it was added, clears its suggestion", () => {
    const left = remainingSuggestions("team_cup_weekend", 2, [{ game_type_id: "gtt_match_play", competition_format: null }], []);
    expect(left.map((s) => s.key)).toEqual(["gtt_rack_n_stack"]);
  });

  it("a skipped suggestion stays gone", () => {
    expect(remainingSuggestions("team_cup_weekend", 2, none, ["gtt_rack_n_stack"]).map((s) => s.key)).toEqual(["gtt_match_play"]);
  });

  it("a bar game that is NOT a bracket does not count as the bracket", () => {
    const left = remainingSuggestions("bar_night_bracket", 2, [{ game_type_id: "gtt_generic_bar", competition_format: null }], []);
    expect(left.map((s) => s.key)).toEqual([suggestionKey("gtt_generic_bar", "bracket")]);
    expect(remainingSuggestions("bar_night_bracket", 2, [{ game_type_id: "gtt_generic_bar", competition_format: "bracket" }], [])).toEqual([]);
  });
});

describe("createInTurn — Add all (Zach's ruling)", () => {
  const games = suggestedGames("golf_week", 2);

  it("creates each in turn and keeps going past a failure, which stays a suggestion", async () => {
    const order: string[] = [];
    const result = await createInTurn(games, async (s) => {
      order.push(s.key);
      if (s.key === "gtt_skins") throw new Error("boom");
    });
    expect(order).toEqual(["gtt_stroke_play", "gtt_skins", "gtt_scramble"]);
    expect(result).toEqual({ added: ["gtt_stroke_play", "gtt_scramble"], failed: ["gtt_skins"] });
  });

  it("one at a time: a create starts only after the previous one finished", async () => {
    let inFlight = 0;
    let most = 0;
    await createInTurn(games, async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(most).toBe(1);
  });
});
