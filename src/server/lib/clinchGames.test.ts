import { describe, it, expect } from "vitest";
import { clinchGames } from "./clinchGames";

/**
 * The board's reads turned into `pointsClinch`'s input. The math has its own
 * tests; this holds which games count and which award each one is read as,
 * including the two that must not trust a pairing yet.
 */

const none = {
  startedByGame: new Set<string>(),
  pairedMatchesByGame: new Map<string, { memberIds: string[]; pointValue: number | null }[]>(),
  entrantTeamsByGame: new Map<string, (string | null)[]>(),
  playerIdsByGame: new Map<string, string[]>(),
};
const teamOf: Record<string, string> = { u1: "A", u2: "B", u3: "C" };
const unitOf = (id: string) => teamOf[id] ?? null;
const build = (g: Record<string, unknown>, inputs: Partial<typeof none> = {}) =>
  clinchGames([{ id: "g", name: "G", status: "pending", ...g }], { ...none, ...inputs }, unitOf);
const placed = { type: "placement", values: [5, 3, 1] };

describe("which games count", () => {
  it("a finished game is banked, a reopened one included; a live and a pending one are not", () => {
    const games = [
      { id: "done", status: "complete" },
      { id: "live", status: "active" },
      { id: "todo", status: "pending" },
      { id: "gone", status: "dropped" },
    ];
    expect(clinchGames(games, none, unitOf).map((g) => g.id)).toEqual(["live", "todo"]);
  });
});

describe("placement", () => {
  it("stroke reads its split, and the units with someone in it", () => {
    const [g] = build(
      { game_type_id: "gtt_stroke_play", points_total: 9, points_distribution: placed },
      { playerIdsByGame: new Map([["g", ["u1", "u2", "stranger"]]]) }
    );
    expect(g.award).toEqual({ kind: "placement", values: [5, 3, 1], fieldUnitIds: ["A", "B"] });
  });
  it("nobody in the game yet means nobody is out of it", () => {
    const [g] = build({ game_type_id: "gtt_stroke_play", points_total: 9, points_distribution: placed });
    expect(g.award).toEqual({ kind: "placement", values: [5, 3, 1], fieldUnitIds: null });
  });
  it("a manual game has no field: its places are entered by hand", () => {
    const [g] = build(
      { game_type_id: "gtt_generic_yard", points_total: 9, points_distribution: placed },
      { playerIdsByGame: new Map([["g", ["u1"]]]) }
    );
    expect(g.award).toEqual({ kind: "placement", values: [5, 3, 1], fieldUnitIds: null });
  });
  it("no split, pick'em included: the winner takes the total", () => {
    const [g] = build({ game_type_id: "gtt_pickem", points_total: 6, points_distribution: null });
    expect(g.award).toEqual({ kind: "placement", values: [6], fieldUnitIds: null });
  });
});

describe("match play", () => {
  const rows = new Map([["g", [{ memberIds: ["u1", "u2"], pointValue: null }, { memberIds: ["u1", "u3"], pointValue: 3 }]]]);
  const matchGame = { game_type_id: "gtt_match_play", points_total: 5, points_distribution: { type: "per_match", value: 2 } };

  it("before it starts, the pairings can still change: no matches read", () => {
    const [g] = build(matchGame, { pairedMatchesByGame: rows });
    expect(g.award).toEqual({ kind: "matches", total: 5, matches: null });
  });
  it("started: each match's units and value, a match's own value over the even share", () => {
    const [g] = build(matchGame, { pairedMatchesByGame: rows, startedByGame: new Set(["g"]) });
    expect(g.award).toEqual({
      kind: "matches",
      total: 5,
      matches: [{ unitIds: ["A", "B"], value: 2 }, { unitIds: ["A", "C"], value: 3 }],
    });
  });
  it("a non-golf game played as Matches reads the same way", () => {
    const [g] = build({ ...matchGame, game_type_id: "gtt_generic_card", competition_format: "matches" });
    expect(g.award.kind).toBe("matches");
  });
});

describe("a bracket", () => {
  const entrants = new Map([["g", ["A", "A", "B", null]]]);
  const bracket = {
    game_type_id: "gtt_generic_bar",
    competition_format: "bracket",
    points_total: 10,
    points_distribution: { type: "placement", values: [7, 3] },
  };

  it("before its draw is played, the entrants can still change", () => {
    const [g] = build(bracket, { entrantTeamsByGame: entrants });
    expect(g.award).toEqual({ kind: "bracket", values: [7, 3], total: 10, fieldSize: 4, entrantsByUnit: null });
  });
  it("started: each unit's entrant count, and an entrant on no team still fills a place", () => {
    const [g] = build(bracket, { entrantTeamsByGame: entrants, startedByGame: new Set(["g"]) });
    expect(g.award).toEqual({ kind: "bracket", values: [7, 3], total: 10, fieldSize: 4, entrantsByUnit: { A: 2, B: 1 } });
  });
});
