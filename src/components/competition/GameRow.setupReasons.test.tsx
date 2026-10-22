import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/t1" }));
const pushed: string[] = [];
vi.mock("@/lib/historyMarker", () => ({ pushMarker: (_kind: string, _state: unknown, url: string) => { pushed.push(url); } }));

import { renderToStaticMarkup } from "react-dom/server";
import { GameRow, openGamePanel } from "./GameRow";
import type { LBGame, LBTeam } from "./CompetitionLeaderboard";

/**
 * Needs attention on the game rows (Zach's ruling 1, 2026-10-21): for whoever
 * can fix it, the first thing a game still needs replaces "Tap to keep setting
 * up", in the warning colour, with how many more in grey, and the row opens the
 * settings at the row that fixes it. Members keep the plain subtitle; Ready rows
 * are unchanged. Anchored on the subtitle's own test ids.
 */

const teams: LBTeam[] = [{ id: "blue", name: "Blue", short_name: "BLU", color: "#3b82f6" } as LBTeam];
const configuring = (over: Partial<LBGame> = {}): LBGame =>
  ({
    id: "g1",
    name: "Day 2 Stroke",
    distribution: null,
    status: "pending",
    gameTypeId: "gtt_stroke_play",
    started: false,
    scoringEnabled: false,
    isNewGame: false,
    configured: false,
    pointsTotal: 10,
    setupReasons: [{ code: "groups_none" }, { code: "points_missing" }],
    ...over,
  }) as LBGame;

const render = (game: LBGame, who: { canEdit?: boolean; mine?: boolean } = {}) =>
  renderToStaticMarkup(
    <GameRow
      game={game}
      teams={teams}
      cells={undefined}
      scoringModel="points"
      tripId="t1"
      canEdit={who.canEdit ?? false}
      mine={who.mine ?? false}
      onPrefetch={() => {}}
    />
  );
const reasonSpan = (html: string) => {
  const at = html.indexOf('data-testid="game-row-setup-reason"');
  return at < 0 ? null : html.slice(at, html.indexOf("</span></span>", at));
};

describe("an editor sees what the game still needs", () => {
  it("the first reason, in the warning colour, and how many more in grey", () => {
    const span = reasonSpan(render(configuring(), { canEdit: true }));
    expect(span).toContain('<span style="color:var(--color-bt-warning)">No groups yet</span>');
    expect(span).toContain('<span style="color:var(--color-bt-text-dim)" data-testid="game-row-setup-more"> · +1 more');
  });

  it("one reason: no count", () => {
    const html = render(configuring({ setupReasons: [{ code: "groups_none" }] }), { canEdit: true });
    expect(reasonSpan(html)).toContain("No groups yet");
    expect(html).not.toContain('data-testid="game-row-setup-more"');
  });

  it("the row opens the settings at the row that fixes it", () => {
    // The row is a panel button; its tap pushes the panel URL.
    pushed.length = 0;
    openGamePanel("/trips/t1", "g1", true, "groupings");
    expect(pushed).toEqual(["/trips/t1?game=g1&settings=1&row=groupings"]);
    pushed.length = 0;
    openGamePanel("/trips/t1", "g1", false, "groupings");
    expect(pushed).toEqual(["/trips/t1?game=g1"]);
  });

  it("a game's delegate sees it too", () => {
    expect(reasonSpan(render(configuring(), { mine: true }))).toContain("No groups yet");
  });
});

describe("everyone else, and the other rows, are unchanged", () => {
  it("a member keeps the plain subtitle and no settings link", () => {
    const html = render(configuring());
    expect(html).not.toContain('data-testid="game-row-setup-reason"');
    expect(html).toContain("Tap to keep setting up");
    expect(html).not.toContain("row=");
  });

  it("an editor's game with nothing to fix still says it is ready to enable", () => {
    const html = render(configuring({ setupReasons: [], configured: true }), { canEdit: true });
    expect(html).not.toContain('data-testid="game-row-setup-reason"');
    expect(html).toContain("Ready — enable scoring");
  });

  it("a Ready row (scoring on) shows no reason", () => {
    const html = render(configuring({ status: "active", scoringEnabled: true, configured: true, setupReasons: [{ code: "too_many_places", line: "3 places, but only 2 teams can finish." }] }), { canEdit: true });
    expect(html).not.toContain('data-testid="game-row-setup-reason"');
    expect(html).toContain("Ready to play");
  });
});
