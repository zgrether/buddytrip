import { describe, it, expect, vi } from "vitest";

vi.mock("@/components/TeamBadge", () => ({ TeamBadge: ({ name }: { name: string }) => <span data-badge={name} /> }));

import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NeedsAttentionCard } from "./NeedsAttentionCard";
import { NOTHING_NEEDS_ATTENTION, type NeedsAttention } from "@/lib/needsAttention";

/**
 * The Needs attention card (Zach's rulings, 2026-10-21): gone when empty, its
 * items MUTED (advisory, so never the warning colour, which is for what
 * blocks), each one row that opens Rosters. And who sees it, and where a game
 * row's tap goes, held at the source because no node test renders the board.
 */

const full: NeedsAttention = {
  offTeam: { names: ["Mo", "Oz"], games: ["Day 2 Stroke"] },
  emptyTeams: [],
  uneven: { teams: [{ id: "a", name: "Alpha", color: "#3b82f6", size: 6 }, { id: "b", name: "Bravo", color: "#ef4444", size: 5 }], scorings: ["traditional"] },
};
const render = (a: NeedsAttention) => renderToStaticMarkup(<NeedsAttentionCard attention={a} onOpenRosters={() => {}} />);

describe("the card", () => {
  it("is gone when there is nothing to do", () => {
    expect(render(NOTHING_NEEDS_ATTENTION)).toBe("");
  });

  it("titles itself with its count and lists each item as a button", () => {
    const html = render(full);
    expect(html).toContain("Needs attention · 2");
    expect(html).toMatch(/<button type="button"[^>]*data-testid="needs-attention-off-team">/);
    expect(html).toContain("Mo and Oz aren&#x27;t on a team");
    expect(html).toContain("Playing Day 2 Stroke — won&#x27;t count");
    expect(html).toMatch(/<button type="button"[^>]*data-testid="needs-attention-uneven">/);
    expect(html).toContain("Teams are uneven: 6 v 5");
  });

  it("is muted: nothing on it takes the warning colour", () => {
    expect(render(full)).not.toContain("--color-bt-warning");
  });

  it("an empty team is its own item", () => {
    const html = render({ ...NOTHING_NEEDS_ATTENTION, emptyTeams: [{ id: "b", name: "Bravo", color: "#ef4444" }] });
    expect(html).toContain('data-testid="needs-attention-empty-team-b"');
    expect(html).toContain("Bravo has no players");
  });
});

describe("who sees it, and where a game row goes (source)", () => {
  const board = readFileSync(join(__dirname, "CompetitionLeaderboard.tsx"), "utf8");
  const row = readFileSync(join(__dirname, "GameRow.tsx"), "utf8");

  it("the board shows the card to Owners and Organizers only", () => {
    expect(board).toMatch(/\{canEdit && onOpenRosters && data\.needsAttention && \(\s*<NeedsAttentionCard/);
  });

  it("a row's reasons are for whoever can edit the game, while it is being set up", () => {
    expect(row).toMatch(/const reasons = canEditThisGame && setupMode \? \(game\.setupReasons \?\? \[\]\) : \[\];/);
  });

  it("the row's tap opens the settings at the first reason's row", () => {
    expect(row).toMatch(/openGamePanel\(pathname, game\.id, canEditThisGame && setupMode, fixRow\)/);
    expect(row).toMatch(/row: fixRow,/);
  });
});
