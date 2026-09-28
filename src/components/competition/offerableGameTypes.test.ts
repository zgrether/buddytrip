import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { offerableGameTypes } from "./CompetitionGamesPanel";
import { GAME_TYPES } from "@/lib/gameTypes";

/**
 * The add-game sheet offers what its container's door admits (PR 7). A TEAMLESS
 * race — a points race with no teams — admits only formats that record a result
 * per person (ruling 1), and `games.create` refuses the rest; offering them would
 * be a menu item that fails on Save.
 */
const ids = (xs: { id: string }[]) => xs.map((t) => t.id).sort();

describe("offerableGameTypes", () => {
  it("a teamless race offers exactly stroke play, match play and skins", () => {
    expect(ids(offerableGameTypes({ isSide: false, teamless: true, scoringModel: "points", types: GAME_TYPES }))).toEqual(
      ["gtt_match_play", "gtt_skins", "gtt_stroke_play"]
    );
  });

  it("CONTROL: a teamed points race offers more than those three (pick'em among them)", () => {
    const teamed = ids(offerableGameTypes({ isSide: false, teamless: false, scoringModel: "points", types: GAME_TYPES }));
    expect(teamed).toContain("gtt_pickem");
    expect(teamed.length).toBeGreaterThan(3);
  });

  it("a side game offers the same per-person three", () => {
    expect(ids(offerableGameTypes({ isSide: true, teamless: false, scoringModel: null, types: GAME_TYPES }))).toEqual(
      ["gtt_match_play", "gtt_skins", "gtt_stroke_play"]
    );
  });
});

describe("the Games page tells the sheet when the race is teamless", () => {
  /**
   * SOURCE GUARD: the function above is only as good as its input, and the one
   * caller must pass it. Asserts the face derives `teamless` from an ANSWERED
   * team list (not a loading `[]`) and hands it to the sheet.
   */
  const face = readFileSync(resolve(__dirname, "CompetitionFace.tsx"), "utf8");
  it("derives teamless from a loaded, empty team list, and passes it", () => {
    expect(face).toMatch(/teamsListQ\.data !== undefined && teamsListQ\.data\.length === 0/);
    expect(face).toContain("teamless={teamless}");
  });
});
