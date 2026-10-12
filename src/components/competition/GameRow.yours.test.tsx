import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/t1" }));

import { renderToStaticMarkup } from "react-dom/server";
import { GameRow, liveSubtitle } from "./GameRow";
import type { LBGame, LBTeam } from "./CompetitionLeaderboard";

/**
 * 9d salvage — FILLED MEANS YOURS on the Games tab.
 *
 * Every live card used to take the accent-faint fill. Now only a live game that
 * is the viewer's (`yours`, the server's per-viewer flag) does — the same fill as
 * the viewer's own standings row — and someone else's live game is a solid card.
 * A style-only distinction, so it is asserted on the PAINT of the panel itself.
 */

const teams: LBTeam[] = [
  { id: "blue", name: "Blue", short_name: "BLU", color: "#3b82f6" } as LBTeam,
  { id: "red", name: "Red", short_name: "RED", color: "#ef4444" } as LBTeam,
];
const live = (over: Partial<LBGame> = {}): LBGame =>
  ({ id: "g1", name: "Day 2", distribution: null, status: "active", gameTypeId: "gtt_match_play", started: true, scoringEnabled: true, ...over }) as LBGame;

const render = (game: LBGame) =>
  renderToStaticMarkup(
    <GameRow game={game} teams={teams} cells={undefined} scoringModel="points" tripId="t1" mine={false} onPrefetch={() => {}} />
  );

/** The outermost element's opening tag — the panel the fill lives on. */
const panel = (html: string) => html.slice(0, html.indexOf(">") + 1);

describe("GameRow — a live card is filled only when it is yours", () => {
  it("your live game takes the accent fill and border", () => {
    const tag = panel(render(live({ yours: true })));
    expect(tag).toContain("background:var(--color-bt-accent-faint)");
    expect(tag).toContain("var(--color-bt-accent-border)");
  });

  it("someone else's live game is a solid card", () => {
    const tag = panel(render(live({ yours: false })));
    expect(tag).toContain("background:var(--color-bt-card)");
    expect(tag).not.toContain("accent-faint");
  });

  /** Yours, but not live: the fill is for a live game only. */
  it("a game that is yours but not live keeps its section's own surface", () => {
    const ready = panel(render(live({ yours: true, started: false })));
    expect(ready).toContain("background:var(--color-bt-card)");
    expect(ready).not.toContain("accent-faint");
  });
});

/**
 * #1607's look (Zach): your standing shows its STATE by styling, not words.
 * Live is primary text, semibold; settled is the FINAL green, regular weight.
 * The two differ ONLY in paint, so this asserts the paint, on the standing's own
 * element (its testid), and checks BOTH properties: never colour alone.
 */
const STANDING = /<span[^>]*style="([^"]*)"[^>]*data-testid="game-row-standing"[^>]*>([^<]*)<\/span>/;
const standingOf = (game: LBGame) => {
  const m = render(game).match(STANDING);
  return m ? { style: m[1], text: m[2].replace(/&amp;/g, "&") } : null;
};

describe("your standing — live or settled, by weight AND colour", () => {
  it("in play: primary text, semibold", () => {
    const s = standingOf(live({ yours: true, standing: { kind: "match", lead: 2, thru: 7, over: false, margin: null } }));
    expect(s?.text).toBe("2 UP thru 7");
    expect(s?.style).toContain("color:var(--color-bt-text)");
    expect(s?.style).toContain("font-weight:600");
  });

  it("settled: the FINAL green, regular weight", () => {
    const s = standingOf(live({ yours: true, standing: { kind: "match", lead: 3, thru: 16, over: true, margin: "3&2" } }));
    expect(s?.text).toBe("Won 3&2");
    expect(s?.style).toContain("color:var(--color-bt-place-1-text)");
    expect(s?.style).toContain("font-weight:400");
  });

  it("a finished round reads '+3' — the settled style says it's done, so no F", () => {
    const s = standingOf(live({ yours: true, standing: { kind: "to_par", toPar: 3, thru: "F" } }));
    expect(s?.text).toBe("+3");
    expect(s?.style).toContain("font-weight:400");
  });

  it("someone else's live game has no standing line at all", () => {
    expect(standingOf(live({ yours: false }))).toBeNull();
  });
});

describe("liveSubtitle — the shared live-row rule", () => {
  it("a stroke or scramble round still in play says nothing ('counts when finished' is gone)", () => {
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "points", cannotProject: "round_incomplete" })).toBeNull();
  });

  it("a match-play cup says why it can't project", () => {
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "match_play", cannotProject: "no_points" })).toBe(
      "No points to award"
    );
  });

  it("otherwise NOTHING (the LIVE heading says it), and 'Projected results' only with pills to label", () => {
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "points", cannotProject: "no_points" })).toBeNull();
    expect(liveSubtitle({ showProjectionPills: false, scoringModel: "match_play" })).toBeNull();
    expect(liveSubtitle({ showProjectionPills: true, scoringModel: "match_play" })).toBe("Projected results");
  });
});
