import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Starting points' suggestion rows on the board (Zach's rulings, 2026-10-21).
 * Two properties the render cannot show without a live board, pinned at the
 * source: a suggestion is judged "added" against THIS competition's games (the
 * board's own `data.games`), never the merged list that includes side games;
 * and the rows are for organizers only.
 */
const board = readFileSync(join(__dirname, "CompetitionLeaderboard.tsx"), "utf8");

describe("the board's suggested games", () => {
  it("are judged against the competition's own games, not side games", () => {
    const block = board.slice(board.indexOf("const suggestions = useMemo("), board.indexOf("const suggestions = useMemo(") + 700);
    expect(block).toMatch(/remainingSuggestions\(\s*startingPoint,[\s\S]*?\(liveGames as LBGame\[\]\)/);
    expect(block).not.toMatch(/sectionGames/);
  });

  it("are for organizers only", () => {
    expect(board).toMatch(/if \(!canEdit \|\| !isStartingPointId\(startingPoint\)\) return \[\];/);
  });
});
