import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectionRow } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";

// #533 (tweaked) — the game-page header's projected tier: each team's PROJECTED
// TOTAL (team-colored) + a delta chip for THIS game's contribution. Live →
// "PROJECTED / if today holds"; complete → "FINAL / this game", total is the
// realized standing (the game's points already counted) + the delta chip.

const team = (id: string, name: string, short: string, color: string): LBTeam => ({
  id,
  name,
  short_name: short,
  color,
});

describe("ProjectionRow — two-team (match-play) row", () => {
  const teams = [team("a", "Hammer", "HAM", "#f87171"), team("b", "Whack", "WHK", "#c084fc")];

  // The projected TOTAL is GONE. It was realized + delta, which on a finished game
  // is the number the hero already shows directly above this row — the same figure
  // twice, the larger one being the duplicate. What survives is the only thing this
  // row uniquely knows: what THIS game contributes.
  it("shows the DELTA only, never a total, while live", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 4, b: 0 }} final={false} />
    );
    expect(html).toContain("PROJECTED");
    expect(html).toContain("if today holds");
    // delta chip = team color on a 16%-alpha team fill
    expect(html).toContain("color-mix(in srgb, #f87171 16%, transparent)");
    expect(html).toContain(">4<"); // a's delta
    expect(html).not.toContain(">16<"); // no realized+delta total
  });

  it("goes to FINAL once the game is complete, still delta-only", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 4, b: 2 }} final />
    );
    expect(html).toContain("FINAL");
    expect(html).toContain("this game");
    expect(html).not.toContain("PROJECTED");
    expect(html).toContain(">4<"); // a's contribution
    expect(html).toContain(">2<"); // b's contribution
    expect(html).not.toContain(">12<"); // the realized total is the hero's job
  });

  it("colors the delta with the team color (data, not chrome)", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 4, b: 0 }} final={false} />
    );
    expect(html).toContain("#f87171");
    expect(html).toContain("#c084fc");
  });
});

describe("ProjectionRow — N-team (points cup) row, not 2-hardcoded", () => {
  const teams = [
    team("a", "Alphas", "ALP", "#f87171"),
    team("b", "Bravos", "BRV", "#c084fc"),
    team("c", "Charlies", "CHR", "#34d399"),
  ];

  it("renders a delta for every team", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 3, b: 1.5, c: 0 }} final={false} />
    );
    expect(html).toContain(">3<"); // a's contribution
    expect(html).toContain("1½"); // b's, with fmtPts rendering a half as ½
    expect(html).not.toContain(">13<"); // no realized+delta total
    for (const c of ["#f87171", "#c084fc", "#34d399"]) expect(html).toContain(c);
  });
});
