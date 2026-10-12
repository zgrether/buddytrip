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

  it("no points to award → the reason, with no 'Underway' (the LIVE heading says it), and NO pills", () => {
    const html = render({ cannotProject: "no_points" });
    expect(html).toContain("No points to award");
    expect(html).not.toContain("Underway");
    expect(count(html, PILL)).toBe(0);
  });

  it("matches not drawn yet → progress, not a fault, and NO pills", () => {
    // Was pinned to the plain line while its words were withheld (3c); the
    // results-first PR gave them. This assertion was always the one that had
    // to change on purpose.
    const html = render({ cannotProject: "matches_not_drawn" });
    expect(html).toContain("Matches not drawn yet");
    expect(count(html, PILL)).toBe(0);
  });

  it("seats vacated → says the state and what fixes it", () => {
    const html = render({ cannotProject: "seats_vacated" });
    expect(html).toContain("Matches need re-pairing");
    expect(count(html, PILL)).toBe(0);
  });

  it("picks hidden → its own sentence, not the no-points one", () => {
    const html = render({ cannotProject: "picks_hidden" });
    expect(html).toContain("Picks hidden until reveal");
    expect(html).not.toContain("No points to award");
  });

  /**
   * #1607's look (Zach): a row under the LIVE heading no longer repeats it, so
   * "Underway · scoring" is gone; and "counts when finished" is gone everywhere.
   * Asserted on the subtitle's own element, so the row's other text can't stand
   * in for it.
   */
  const SUBTITLE = /<span class="text-\[12px\]"[^>]*>([^<]*)<\/span>/;

  it("a format with NO projection says nothing under the name — the LIVE heading already does", () => {
    const html = render({});
    expect(html).not.toContain("Underway");
    expect(html.match(SUBTITLE)).toBeNull();
  });

  it("a points tournament says nothing for any other reason either", () => {
    const html = render({ cannotProject: "no_points", scoringModel: "points" });
    expect(html).not.toContain("No points to award");
    expect(html.match(SUBTITLE)).toBeNull();
  });

  it("a live stroke or scramble round says nothing — 'counts when finished' is gone", () => {
    const html = render({ cannotProject: "round_incomplete", scoringModel: "points" });
    expect(html).not.toContain("counts when finished");
    expect(html.match(SUBTITLE)).toBeNull();
  });

  it("the control: a reason that IS said shows in the subtitle element itself", () => {
    // Without this, a SUBTITLE pattern that never matches would pass the three above.
    expect(render({ cannotProject: "no_points" }).match(SUBTITLE)?.[1]).toBe("No points to award");
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
  it("every reason has its own copy — none shares the plain line", () => {
    const reasons: CannotProjectReason[] = [
      "no_points", "matches_not_drawn", "seats_vacated", "picks_hidden", "no_course", "no_teams",
    ];
    const copies = reasons.map(cannotProjectCopy);
    expect(new Set(copies).size).toBe(reasons.length);
    for (const c of copies) expect(c).toMatch(/^[A-Z]/);
    for (const c of copies) expect(c).not.toMatch(/Underway/);
    // A round that only counts once complete has no line at all.
    expect(cannotProjectCopy("round_incomplete")).toBeNull();
  });
});
