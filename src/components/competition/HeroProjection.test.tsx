import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitionHero } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";

/**
 * Hero "if today holds" projected tier (Path A). The expanded 2-team hero shows a
 * PROJECTED tier below the banked score: per-team projected total + a ▲ delta pill.
 * Two gates: the tier only when ≥1 game live; a team's pill only when its delta > 0.
 * A cup icon marks a team whose projected total crosses the win threshold (flair).
 * Rendered via react-dom/server (node env). The pill's ▲ (U+25B2) is the tell we
 * count to assert which teams show a pill.
 */

const team = (id: string, name: string, color: string): LBTeam => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), color });
const teams = [team("a", "Manhattans", "#4ade80"), team("b", "Centurions", "#fb923c")];
const TRI = /▲/g; // ▲ — the ProjectionPill triangle

function hero(props: Partial<React.ComponentProps<typeof CompetitionHero>>) {
  return renderToStaticMarkup(
    <CompetitionHero
      cupName="BBMI Test Cup"
      tagline={null}
      teams={teams}
      teamTotals={{ a: 8, b: 8 }}
      pointsAvailable={100}
      winNumber={40}
      clincher={null}
      scoringModel="match_play"
      canEdit={false}
      {...props}
    />
  );
}

describe("hero projected tier — visibility gate", () => {
  it("HIDES the whole tier when nothing is live (hasLiveProjection false)", () => {
    const html = hero({ hasLiveProjection: false, projectedTeamTotals: { a: 8, b: 8 } });
    expect(html).not.toContain("Projected if today holds");
    expect(html).not.toContain("hero-projected-tier");
    expect((html.match(TRI) ?? []).length).toBe(0);
  });

  it("SHOWS the tier when at least one game is live", () => {
    const html = hero({ hasLiveProjection: true, projectedTeamTotals: { a: 10, b: 14 } });
    expect(html).toContain("Projected if today holds");
    expect(html).toContain("hero-projected-tier");
  });
});

describe("hero projected tier — both teams project", () => {
  const html = hero({ hasLiveProjection: true, projectedTeamTotals: { a: 10, b: 14 } });

  it("shows each team's projected TOTAL (banked + Σ projections)", () => {
    expect(html).toContain(">10<"); // Manhattans 8 + 2
    expect(html).toContain(">14<"); // Centurions 8 + 6
  });

  it("shows a ▲ pill for BOTH teams (both deltas > 0)", () => {
    expect((html.match(TRI) ?? []).length).toBe(2);
  });

  it("no cup icon — neither projected total crosses the win threshold (40)", () => {
    expect(html).not.toContain("hero-proj-cup");
  });
});

describe("hero projected tier — only one team projects (per-team pill gate)", () => {
  // Manhattans +2 → 10; Centurions +0 → bare 8 (== its banked), no pill.
  const html = hero({ hasLiveProjection: true, projectedTeamTotals: { a: 10, b: 8 } });

  it("shows exactly ONE pill (the gaining team); the delta-0 team is a bare number", () => {
    expect((html.match(TRI) ?? []).length).toBe(1);
    expect(html).toContain(">10<"); // Manhattans projected (with pill)
    expect(html).toContain(">8<"); // Centurions bare projected == banked, no pill
  });
});

describe("hero projected tier — projected-win cup icon (flair)", () => {
  it("shows the cup for a team whose projected total ≥ win threshold, not for one below", () => {
    // Manhattans 8 + 34 = 42 ≥ 40 → cup; Centurions 10 < 40 → no cup.
    const html = hero({ hasLiveProjection: true, projectedTeamTotals: { a: 42, b: 10 }, winNumber: 40 });
    expect(html).toContain("hero-proj-cup-a");
    expect(html).not.toContain("hero-proj-cup-b");
  });

  it("no cup when both are below threshold", () => {
    const html = hero({ hasLiveProjection: true, projectedTeamTotals: { a: 10, b: 14 }, winNumber: 40 });
    expect(html).not.toContain("hero-proj-cup");
  });
});
