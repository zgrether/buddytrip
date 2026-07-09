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

  it("shows the projected TOTAL (realized + delta) + a delta chip, while live", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} teamTotals={{ a: 12, b: 4 }} perTeam={{ a: 4, b: 0 }} final={false} />
    );
    expect(html).toContain(">16<"); // a: 12 realized + 4 projected → 16
    expect(html).toContain("PROJECTED");
    expect(html).toContain("if today holds");
    // delta chip = team color on a 16%-alpha team fill
    expect(html).toContain("color-mix(in srgb, #f87171 16%, transparent)");
    // the old "16 (+4)" parens format is gone
    expect(html).not.toContain("16 (+4)");
  });

  it("goes to FINAL (realized total) once the game is complete", () => {
    // Final: the game's points are already in teamTotals, so the total is the
    // realized standing and the chip shows what this game added.
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} teamTotals={{ a: 12, b: 4 }} perTeam={{ a: 4, b: 2 }} final />
    );
    expect(html).toContain("FINAL");
    expect(html).toContain("this game");
    expect(html).not.toContain("PROJECTED");
    expect(html).toContain(">12<"); // a realized total (not 16 — no double-count)
    expect(html).toContain(">4<"); // b realized total
  });

  it("colors the totals with the team color (data, not chrome)", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} teamTotals={{ a: 0, b: 0 }} perTeam={{ a: 4, b: 0 }} final={false} />
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

  it("renders a projected total + chip for every team", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} teamTotals={{ a: 10, b: 5, c: 0 }} perTeam={{ a: 3, b: 1.5, c: 0 }} final={false} />
    );
    expect(html).toContain(">13<"); // a: 10 + 3
    expect(html).toContain("6½"); // b: 5 + 1.5 → 6½ (fmtPts renders a half as ½)
    for (const c of ["#f87171", "#c084fc", "#34d399"]) expect(html).toContain(c);
  });
});
