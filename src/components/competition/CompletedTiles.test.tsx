import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletedRow } from "./GameRow";
import type { LBGame, LBTeam, LBCell } from "./CompetitionLeaderboard";

/**
 * PR 9c-2 — a points tournament's finished game as a row of TILES.
 *
 * The properties are the ones Zach's design names: one tile per team in the
 * board's FIXED team order (never re-sorted by result, so each team is a column
 * down the list), the winner's tile the stronger tint, "No points" for a game
 * that paid nothing, and a game name that wraps rather than pushing the tiles.
 */

const team = (id: string, short: string, color: string): LBTeam => ({ id, name: short, short_name: short, color });
const TEAMS = [team("a", "BLU", "#3b82f6"), team("b", "RED", "#ef4444"), team("c", "GRN", "#22c55e"), team("d", "GLD", "#f59e0b")];
const cell = (points: number) => ({ points, place: 0 }) as LBCell;
const game = (over: Partial<LBGame> = {}): LBGame => ({
  id: "g1", name: "Cornhole", distribution: null, status: "complete", gameTypeId: "gtt_generic_yard", ...over,
});
const render = (cells: Map<string, LBCell> | undefined, scoringModel: "points" | "match_play" = "points", teams = TEAMS) =>
  renderToStaticMarkup(
    <CompletedRow game={game()} teams={teams} cells={cells} scoringModel={scoringModel} tripId="t1" onPrefetch={() => {}} />
  );

/** The team ids in the order their tiles appear. */
const tileOrder = (html: string) => [...html.matchAll(/data-testid="result-tile-([a-z])"/g)].map((m) => m[1]);
/** One tile's opening tag. */
const tileTag = (html: string, id: string) => {
  const at = html.indexOf(`data-testid="result-tile-${id}"`);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("completed tiles — fixed order, winner tinted", () => {
  it("keeps the board's team order whatever the result — RED won and still sits second", () => {
    const html = render(new Map([["a", cell(1)], ["b", cell(6)], ["c", cell(3)], ["d", cell(0)]]));
    expect(tileOrder(html)).toEqual(["a", "b", "c", "d"]);
    expect(tileTag(html, "b")).toContain('data-winner="true"');
    for (const id of ["a", "c", "d"]) expect(tileTag(html, id)).toContain('data-winner="false"');
  });

  /** The winner is told by the PAINT, not only an attribute: mutate the tint and this fails. */
  it("the winner's tile carries the stronger tint and the ring; the others are muted", () => {
    const html = render(new Map([["a", cell(1)], ["b", cell(6)]]));
    expect(tileTag(html, "b")).toContain("#ef4444 32%");
    expect(tileTag(html, "b")).toContain("inset 0 0 0 1px");
    expect(tileTag(html, "a")).toContain("#3b82f6 12%");
    expect(tileTag(html, "a")).not.toContain("inset");
  });

  it("points on top in the theme's primary text, never a literal white", () => {
    const html = render(new Map([["a", cell(6)]]));
    const tile = html.slice(html.indexOf('data-testid="result-tile-a"'), html.indexOf('data-testid="result-tile-b"'));
    expect(tile).toContain("color:var(--color-bt-text)");
    expect(tile).toContain(">6<");
    expect(tile).toContain(">BLU<");
    expect(tile.toLowerCase()).not.toMatch(/color:(#fff|white)/);
  });
});

describe("completed tiles — No points, and the name that wraps", () => {
  it("a game that paid nobody anything says No points — never a blank result", () => {
    const html = render(new Map([["a", cell(0)], ["b", cell(0)]]));
    expect(html).toContain('data-testid="game-no-points"');
    expect(html).toContain(">No points<");
    expect(html).not.toContain('data-testid="game-result-tiles"');
  });

  it("no cells at all (placings with no payout) is No points too", () => {
    expect(render(undefined)).toContain('data-testid="game-no-points"');
  });

  it("the game name WRAPS beside tiles, and still truncates on a match-play row", () => {
    const points = render(new Map([["a", cell(2)]]));
    const name = (html: string) => html.slice(html.indexOf('class="block text-[13px]'), html.indexOf(">Cornhole<"));
    expect(name(points)).toContain("[overflow-wrap:break-word]");
    expect(name(points)).not.toContain("truncate");
    const match = render(new Map([["a", cell(2)]]), "match_play", TEAMS.slice(0, 2));
    expect(name(match)).toContain("truncate");
  });
});
