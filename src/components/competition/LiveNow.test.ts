import { describe, it, expect } from "vitest";
import { liveNowGames, liveNowHref } from "./LiveNow";
import { liveSubtitle } from "./GameRow";
import type { LBGame } from "./CompetitionLeaderboard";

/**
 * PR 9d — Home's Live now: what it lists, in what order, where a row goes, and
 * that its subtitle is the board's own rule.
 */

const g = (id: string, over: Partial<LBGame> = {}): LBGame =>
  ({ id, name: id, distribution: null, status: "active", started: true, gameTypeId: "gtt_match_play", ...over }) as LBGame;

describe("liveNowGames — every live game, the viewer's first", () => {
  it("lists only LIVE games (the board's own sectionOf): not ready, not finished", () => {
    const games = [
      g("live"),
      g("ready", { started: false }),
      g("done", { status: "complete" }),
      g("pending", { status: "pending", started: false }),
    ];
    expect(liveNowGames(games).map((x) => x.id)).toEqual(["live"]);
  });

  it("the viewer's games come first; otherwise the board's order is kept", () => {
    const games = [g("a"), g("b", { yours: true }), g("c"), g("d", { yours: true })];
    expect(liveNowGames(games).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("nothing live is an empty list — the section hides", () => {
    expect(liveNowGames([g("ready", { started: false })])).toEqual([]);
  });
});

describe("liveNowHref — straight into the game", () => {
  it("a panel format opens as the board's panel, over the Games page", () => {
    expect(liveNowHref("t1", g("m1"))).toBe("/trips/t1?view=cup&game=m1");
  });
});

describe("liveSubtitle — ONE rule for the board's row and Home", () => {
  it("a stroke or scramble round in a points tournament counts when finished", () => {
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "points", cannotProject: "round_incomplete" })).toBe(
      "Underway · counts when finished"
    );
  });

  it("a match-play cup says why it can't project", () => {
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "match_play", cannotProject: "no_points" })).toBe(
      "Underway · no points to award"
    );
  });

  it("otherwise the plain line — and never 'Projected results' without pills to label", () => {
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "points", cannotProject: "no_points" })).toBe("Underway · scoring");
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "match_play" })).toBe("Underway · scoring");
    expect(liveSubtitle({ showProjectionPills: true, scoringModel: "match_play" })).toBe("Projected results");
  });
});
