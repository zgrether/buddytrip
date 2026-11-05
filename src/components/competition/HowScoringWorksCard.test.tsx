import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HowScoringWorksCard } from "./HowScoringWorksCard";
import { HOW_SCORING_WORKS_TITLE } from "@/lib/vocabulary";

/**
 * The How scoring works row (Zach's ruling 4, 2026-10-22): collapsed under the
 * hero, for everyone. Its lines are `howScoringWorks.test.ts`'s; this holds the
 * row itself and its place on the board.
 */

const props = {
  scoringModel: "match_play" as const,
  pointsAvailable: 8,
  awarded: null,
  teams: [{ name: "Alpha" }, { name: "Bravo" }],
  teamless: false,
  games: [{ id: "g1", name: "Day 1", gameTypeId: "gtt_match_play", competitionFormat: null, pointsTotal: 8, distribution: null }],
};

describe("the row", () => {
  it("starts collapsed: its title, a button that says it is closed, and no body", () => {
    const html = renderToStaticMarkup(<HowScoringWorksCard {...props} />);
    expect(html).toContain(`>${HOW_SCORING_WORKS_TITLE}</span>`);
    expect(html).toMatch(/<button type="button" aria-expanded="false"[^>]*data-testid="how-scoring-works-toggle"/);
    expect(html).not.toContain('data-testid="how-scoring-works-body"');
  });
  it("its chevron points down closed and up open: two icons, never a rotated one", () => {
    const src = readFileSync(join(__dirname, "HowScoringWorksCard.tsx"), "utf8");
    expect(src).toMatch(/open \? \(\s*<ChevronUp[\s\S]*?\) : \(\s*<ChevronDown/);
    expect(src).not.toContain("rotate(");
    const closed = renderToStaticMarkup(<HowScoringWorksCard {...props} />);
    expect(closed).toContain("lucide-chevron-down");
    expect(closed).not.toContain("lucide-chevron-up");
  });
});

describe("its place on the board (source)", () => {
  const board = readFileSync(join(__dirname, "CompetitionLeaderboard.tsx"), "utf8");
  it("right under the hero, with no role gate: everyone sees it", () => {
    const hero = board.indexOf("<StickyCollapseHero");
    const card = board.indexOf("<HowScoringWorksCard");
    const between = board.slice(board.indexOf("/>", hero), card);
    expect(card).toBeGreaterThan(hero);
    expect(between).not.toMatch(/canEdit|isOwner|&&\s*$/m);
    expect(between).not.toContain("<");
  });
});
