import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsedHero } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";

// Spec (standard game header) — the collapsed bar: team name OVER score, "first to
// X" centered, neutral chrome, NO trophy. N-team-aware. Rendered via
// react-dom/server (node env, no RTL).

const team = (id: string, name: string, short: string, color: string): LBTeam => ({
  id,
  name,
  short_name: short,
  color,
});

describe("CollapsedHero — two-team (match-play) bar", () => {
  const teams = [team("a", "Hammer", "HAM", "#f87171"), team("b", "Whack", "WHK", "#c084fc")];
  const html = renderToStaticMarkup(
    <CollapsedHero teams={teams} teamTotals={{ a: 5, b: 12 }} winNumber={78} pointsAvailable={100} clincher={null} />
  );

  it("renders both team names + scores and the 'first to X' target", () => {
    expect(html).toContain("Hammer");
    expect(html).toContain("Whack");
    expect(html).toContain(">5<");
    expect(html).toContain(">12<");
    expect(html).toContain("First to 78 wins"); // matches the expanded hero's target line
  });

  it("uses team colors on the names/scores (data, not chrome)", () => {
    expect(html).toContain("#f87171");
    expect(html).toContain("#c084fc");
  });

  it("drops the trophy (the collapsed bar is chrome-neutral, no trophy art)", () => {
    expect(html).not.toContain("viewBox=\"0 0 300 380\""); // the HeroTrophy svg
  });

  it("shows the clincher when the cup is decided", () => {
    const decided = renderToStaticMarkup(
      <CollapsedHero teams={teams} teamTotals={{ a: 5, b: 40 }} winNumber={78} pointsAvailable={100} clincher={teams[1]} />
    );
    expect(decided).toContain("WHK wins"); // short_name + " wins"
    expect(decided).not.toContain("First to");
  });
});

describe("CollapsedHero — N-team (points cup) bar, not 2-hardcoded", () => {
  const teams = [
    team("a", "Alphas", "ALP", "#f87171"),
    team("b", "Bravos", "BRV", "#c084fc"),
    team("c", "Charlies", "CHR", "#34d399"),
  ];
  const html = renderToStaticMarkup(
    <CollapsedHero teams={teams} teamTotals={{ a: 9, b: 6, c: 4 }} winNumber={30} pointsAvailable={60} clincher={null} />
  );

  it("renders all N teams (short names) + their scores", () => {
    for (const s of ["ALP", "BRV", "CHR"]) expect(html).toContain(s);
    expect(html).toContain(">9<");
    expect(html).toContain(">6<");
    expect(html).toContain(">4<");
  });
});
