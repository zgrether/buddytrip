import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectionRow } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";

// #533 — the game-page header's ROW 2: each team's projected/final contribution
// to the cup for THIS game. Presentation only (the per-team map is computed by the
// page). Live → desaturated "projected"; complete → solid, no "projected".

const team = (id: string, name: string, short: string, color: string): LBTeam => ({
  id,
  name,
  short_name: short,
  color,
});

describe("ProjectionRow — two-team (match-play) row", () => {
  const teams = [team("a", "Hammer", "HAM", "#f87171"), team("b", "Whack", "WHK", "#c084fc")];

  it("shows each team's signed contribution and, while live, the 'projected' label", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 4, b: 0 }} gameName="Front Nine" final={false} />
    );
    expect(html).toContain("+4"); // a's positive contribution gets a leading +
    expect(html).toContain(">0<"); // b contributes nothing (no +)
    expect(html).toContain("Front Nine");
    expect(html).toContain("projected");
    // desaturated while live — team color at reduced opacity, not full
    expect(html).toContain("opacity:0.5");
  });

  it("drops the 'projected' label and goes solid once the game is complete", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 4, b: 2 }} gameName="Front Nine" final />
    );
    expect(html).not.toContain("projected");
    expect(html).toContain("opacity:1");
    expect(html).toContain("+4");
    expect(html).toContain("+2");
  });

  it("colors the numbers with the team color (data, not chrome)", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 4, b: 0 }} gameName="Front Nine" final={false} />
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

  it("renders a contribution for every team", () => {
    const html = renderToStaticMarkup(
      <ProjectionRow teams={teams} perTeam={{ a: 3, b: 1.5, c: 0 }} gameName="Skins" final={false} />
    );
    expect(html).toContain("+3");
    expect(html).toContain("+1½"); // fmtPts renders a half as ½
    for (const c of ["#f87171", "#c084fc", "#34d399"]) expect(html).toContain(c);
  });
});
