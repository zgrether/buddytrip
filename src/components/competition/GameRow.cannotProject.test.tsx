import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/t1" }));

import { renderToStaticMarkup } from "react-dom/server";
import { GameRow, cannotProjectCopy } from "./GameRow";
import type { LBGame, LBTeam } from "./CompetitionLeaderboard";
import type { CannotProjectReason } from "@/lib/gameProjection";

/**
 * CANNOT PROJECT IS A STATE, NOT A SILENCE AND NOT A ZERO (3c).
 *
 * A live game used to show one of two things: pills, or "Underway · scoring".
 * The second covered BOTH "this format has no projection" and "this game can't
 * project" — and golf match play with no points to award showed `▲0 | ▲0`,
 * which is the picture of "nobody's up yet". Principle 3: open-ended is a
 * declared outcome, not a missing one.
 *
 * Anchors are the quote-terminated `data-testid`s. A bare "0" or "▲" would be
 * satisfied by the row's own markup (CLAUDE.md, the substring corollary), and
 * the pill and the dash are both rendered by THIS component, not a nested copy.
 */

const teams: LBTeam[] = [
  { id: "blue", name: "Blue", short_name: "BLU", color: "#3b82f6" } as LBTeam,
  { id: "red", name: "Red", short_name: "RED", color: "#ef4444" } as LBTeam,
];

// `status: active` + `started: true` → the On Tap section (`sectionOf`).
const game: LBGame = {
  id: "g1",
  name: "Pick'em",
  distribution: null,
  status: "active",
  gameTypeId: "gtt_pickem",
  started: true,
  scoringEnabled: true,
} as LBGame;

const render = (props: {
  projection?: Record<string, number>;
  cannotProject?: CannotProjectReason;
  scoringModel?: "match_play" | "points";
}) =>
  renderToStaticMarkup(
    <GameRow
      game={game}
      teams={teams}
      cells={undefined}
      scoringModel={props.scoringModel ?? "match_play"}
      projection={props.projection}
      cannotProject={props.cannotProject}
      tripId="t1"
      mine={false}
      onPrefetch={() => {}}
    />
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;
const PILL = 'data-testid="projection-pill"';
const MISSING = 'data-testid="projection-missing"';

describe("GameRow — a live game that can't project says why", () => {
  it("the positive control: a projection renders one pill per team and the projected subtitle", () => {
    const html = render({ projection: { blue: 6, red: 2 } });
    expect(count(html, PILL)).toBe(2);
    expect(html).toContain("Projected results");
  });

  it("no points to award → the reason, in place of 'Underway · scoring', and NO pills", () => {
    const html = render({ cannotProject: "no_points" });
    expect(html).toContain("Underway · no points to award");
    expect(html).not.toContain("Underway · scoring");
    expect(count(html, PILL)).toBe(0);
  });

  it("no matches paired → its own sentence", () => {
    const html = render({ cannotProject: "no_matches" });
    expect(html).toContain("Underway · no matches paired");
    expect(count(html, PILL)).toBe(0);
  });

  it("picks hidden → its own sentence, not the no-points one", () => {
    const html = render({ cannotProject: "picks_hidden" });
    expect(html).toContain("Underway · picks hidden until reveal");
    expect(html).not.toContain("no points to award");
  });

  it("a format with NO projection keeps the plain line — distinct from can't", () => {
    const html = render({});
    expect(html).toContain("Underway · scoring");
  });

  it("a points cup keeps the plain line either way — it shows no projection anywhere yet (PR 9)", () => {
    const html = render({ cannotProject: "no_points", scoringModel: "points" });
    expect(html).toContain("Underway · scoring");
    expect(html).not.toContain("no points to award");
  });
});

describe("GameRow — a team missing from a projection is not invented as 0", () => {
  it("renders the no-value dash for the missing team, and a pill only for the one present", () => {
    // The server now names every cup team, so this is a should-not-happen
    // shape; the row must still not make up a number for it.
    const html = render({ projection: { blue: 6 } });
    expect(count(html, PILL)).toBe(1);
    expect(count(html, MISSING)).toBe(1);
  });

  it("a real zero is still a pill — zero is a value, missing is not", () => {
    const html = render({ projection: { blue: 6, red: 0 } });
    expect(count(html, PILL)).toBe(2);
    expect(count(html, MISSING)).toBe(0);
  });
});

describe("cannotProjectCopy — one sentence per reason, none shared", () => {
  it("every reason has its own copy", () => {
    const reasons: CannotProjectReason[] = ["no_points", "no_matches", "picks_hidden", "no_course", "no_teams"];
    const copies = reasons.map(cannotProjectCopy);
    expect(new Set(copies).size).toBe(reasons.length);
    for (const c of copies) expect(c).toMatch(/^Underway · /);
  });
});
