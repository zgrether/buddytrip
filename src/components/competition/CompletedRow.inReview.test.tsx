import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletedRow } from "./GameRow";
import type { LBGame, LBTeam, LBCell } from "./CompetitionLeaderboard";

/**
 * The board's `IN REVIEW` badge — a completed game re-opened for a correction.
 *
 * The property under test is REPLACEMENT, not presence. A badge sitting beside
 * the result, or over a dimmed one, still shows a number that is being looked
 * at; the point of the state is that the row's own figures are provisional while
 * the standings above them stay honest. So every case asserts the scores are
 * ABSENT, not merely that the badge is there.
 *
 * Both result shapes are covered because `CompletedRow` has two arms that a
 * single call site now substitutes — `CompletedGridCells` (match-play cups) and
 * `CompletedPodium` (points cups). One of them silently keeping its numbers is
 * exactly the failure this file exists to catch.
 *
 * NOTE the quote-terminated `data-testid="…"` checks. `renderToStaticMarkup`
 * output is a flat string, so an unterminated substring matches any testid that
 * merely starts the same way — a prefix collision that reads as a pass.
 */

const team = (id: string, name: string, short: string, color: string): LBTeam => ({
  id, name, short_name: short, color,
});
const teams = [team("a", "Blue", "BLU", "#3b82f6"), team("b", "Red", "RED", "#ef4444")];

const cells = new Map<string, LBCell>([
  ["a", { points: 7, place: 1 } as LBCell],
  ["b", { points: 3, place: 2 } as LBCell],
]);

function game(over: Partial<LBGame> = {}): LBGame {
  return {
    id: "g1",
    name: "Alternate Shot",
    distribution: null,
    status: "complete",
    gameTypeId: "gtt_match_play",
    ...over,
  };
}

const render = (g: LBGame, scoringModel: "match_play" | "points" = "match_play") =>
  renderToStaticMarkup(
    <CompletedRow
      game={g}
      teams={teams}
      cells={cells}
      scoringModel={scoringModel}
      tripId="t1"
      onPrefetch={() => {}}
    />
  );

describe("CompletedRow — IN REVIEW replaces the result", () => {
  it("match-play cup: badge shown, grid numbers GONE", () => {
    const html = render(game({ correctionsOpen: true }));
    expect(html).toContain('data-testid="game-in-review"');
    expect(html).toMatch(/In review/i);
    // The grid cells render each team's points as a bare number.
    expect(html).not.toContain(">7<");
    expect(html).not.toContain(">3<");
  });

  it("points cup: badge shown, podium GONE", () => {
    const html = render(game({ correctionsOpen: true }), "points");
    expect(html).toContain('data-testid="game-in-review"');
    expect(html).not.toContain(">7<");
    expect(html).not.toContain(">3<");
  });

  it("locked (complete, corrections closed): scores shown, NO badge", () => {
    const html = render(game({ correctionsOpen: false }));
    expect(html).not.toContain('data-testid="game-in-review"');
    expect(html).toContain(">7<");
    expect(html).toContain(">3<");
  });

  it("field absent (older payload / hand-built fixture) reads as not-in-review", () => {
    // `correctionsOpen` is optional on `LBGame`; absent must be the safe default
    // rather than an accidental badge on every completed game.
    const html = render(game());
    expect(html).not.toContain('data-testid="game-in-review"');
    expect(html).toContain(">7<");
  });

  it("a game that was never finalized gets no badge, even with the flag set", () => {
    // `gameLockState.isCorrecting` requires status === "complete". A stray
    // `corrections_open` on an active game must not flag it — the badge means
    // "a recorded result is being revisited", which an unfinished game has not
    // got. Guards the predicate, not just the markup.
    const html = render(game({ status: "active", correctionsOpen: true }));
    expect(html).not.toContain('data-testid="game-in-review"');
  });

  it("the badge uses WARNING tokens, never a hex literal", () => {
    const html = render(game({ correctionsOpen: true }));
    expect(html).toContain("var(--color-bt-warning-faint)");
    expect(html).toContain("var(--color-bt-warning)");
    expect(html).toContain("var(--color-bt-warning-border)");
  });
});
