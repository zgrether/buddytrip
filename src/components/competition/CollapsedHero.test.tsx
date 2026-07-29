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

describe("CollapsedHero — points model drops the 'first to X' target", () => {
  const teams = [team("a", "Hammer", "HAM", "#f87171"), team("b", "Whack", "WHK", "#c084fc")];

  it("shows the target for match_play (the default game-page usage)", () => {
    const html = renderToStaticMarkup(
      <CollapsedHero teams={teams} teamTotals={{ a: 5, b: 12 }} winNumber={78} pointsAvailable={100} clincher={null} scoringModel="match_play" />
    );
    expect(html).toContain("First to 78 wins");
  });

  it("drops the target + race-bar for points (no clinch ceiling — same gate #655 applied to the board)", () => {
    const html = renderToStaticMarkup(
      <CollapsedHero teams={teams} teamTotals={{ a: 5, b: 12 }} winNumber={78} pointsAvailable={100} clincher={null} scoringModel="points" />
    );
    expect(html).not.toContain("First to");
    // scores still render — this drops only the match-play target chrome
    expect(html).toContain(">5<");
    expect(html).toContain(">12<");
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

// ── The ROSTER affordance label ──────────────────────────────────────────────
// A person icon used to sit beside each team name. An icon isn't a verb: a person
// outline next to a team name reads as decoration, or as "team" — which the name
// already says — not as "tap here to open the roster". The word says what the tap
// does, and the name + label are one target.
describe("team name → ROSTER affordance", () => {
  const teams = [team("a", "Hammer", "HAM", "#f87171"), team("b", "Whack", "WHK", "#c084fc")];
  const base = { teams, teamTotals: { a: 5, b: 12 }, winNumber: 78, pointsAvailable: 100, clincher: null };

  const tappable = renderToStaticMarkup(<CollapsedHero {...base} onEditTeam={() => {}} />);
  const inert = renderToStaticMarkup(<CollapsedHero {...base} />);

  it("labels the tappable name with ROSTER", () => {
    expect(tappable).toContain("ROSTER");
  });

  it("drops the person icon entirely", () => {
    // lucide renders its glyphs as inline <svg class="lucide lucide-users">.
    expect(tappable).not.toMatch(/lucide-users/i);
    expect(inert).not.toMatch(/lucide-users/i);
  });

  /**
   * `GamePageHeader` mounts this same CollapsedHero WITHOUT `onEditTeam`, so its
   * names are inert. Labelling a control that does nothing is the same failure as
   * an unlabelled one, pointing the other way. This is a DISPLAY rule — it changes
   * nothing about who may open the sheet or what they can do inside it, which stays
   * with TeamSheet/useCanEditTeam.
   */
  it("omits the label where the name is not tappable (the game-page header)", () => {
    expect(inert).not.toContain("ROSTER");
    expect(inert).toContain("Hammer"); // the name itself still renders
  });

  it("keeps the label as chrome-dim, not tinted to the team color", () => {
    // The label must not compete with the name it labels; it matches the hero's
    // other secondary text (tagline, "First to X wins"). Assert on the ROSTER
    // element ITSELF — a bare `toContain("--color-bt-text-dim")` would pass on
    // the target line's color and prove nothing about this label.
    const spans = tappable.match(/<span[^>]*>ROSTER<\/span>/g) ?? [];
    expect(spans).toHaveLength(2); // one per team
    for (const s of spans) {
      expect(s).toContain("var(--color-bt-text-dim)");
      expect(s).not.toContain("#f87171");
      expect(s).not.toContain("#c084fc");
    }
  });

  it("the score, target line and race bar all still render beside it", () => {
    // The enlarged target must not swallow the rest of the row.
    expect(tappable).toContain(">5<");
    expect(tappable).toContain(">12<");
    expect(tappable).toContain("First to 78 wins");
    expect(tappable).toContain("#f87171"); // team fills on the race bar
  });
});
