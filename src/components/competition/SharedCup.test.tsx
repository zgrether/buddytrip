import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitionHero, CollapsedHero } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";
import { isCupShared, type CupCompletionGame } from "@/lib/cupCompletion";

/**
 * A Cup that ends level is shared (Zach's ruling, 2026-10-22). Finished when
 * every game is final, nobody has clinched, and the two totals are equal; then
 * the hero reads "Final · Shared" and stops saying "First to X wins".
 */

const final = (over: Partial<CupCompletionGame> = {}): CupCompletionGame => ({ status: "complete", ...over });

describe("isCupShared", () => {
  it("every game final, nobody clinched, totals equal: shared", () => {
    expect(isCupShared([final(), final()], false, [4, 4])).toBe(true);
  });
  it("a game not yet final, even one nobody armed: not yet", () => {
    expect(isCupShared([final(), { status: "pending", started: false, scoringEnabled: false }], false, [4, 4])).toBe(false);
  });
  it("a game reopened for a correction is not final", () => {
    expect(isCupShared([final(), final({ correctionsOpen: true })], false, [4, 4])).toBe(false);
  });
  it("totals apart, or someone clinched: not shared", () => {
    expect(isCupShared([final()], false, [5, 3])).toBe(false);
    expect(isCupShared([final()], true, [4, 4])).toBe(false);
  });
  it("an empty Cup is not level at 0", () => {
    expect(isCupShared([], false, [0, 0])).toBe(false);
  });
});

const team = (id: string, name: string, color: string): LBTeam => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), color });
const teams = [team("a", "Manhattans", "#4ade80"), team("b", "Centurions", "#fb923c")];

function hero(props: Partial<React.ComponentProps<typeof CompetitionHero>>) {
  return renderToStaticMarkup(
    <CompetitionHero
      cupName="Level Cup"
      tagline={null}
      teams={teams}
      teamTotals={{ a: 4, b: 4 }}
      pointsAvailable={8}
      winNumber={4.5}
      clincher={null}
      gamesRemaining={0}
      scoringModel="match_play"
      canEdit={false}
      {...props}
    />
  );
}

describe("the hero on a shared Cup", () => {
  it("reads Final · Shared, and no longer First to X wins", () => {
    const html = hero({ cupShared: true });
    expect(html).toContain("Final · Shared");
    expect(html).not.toContain("First to");
  });
  it("CONTROL: the same Cup not yet finished still says First to X wins", () => {
    const html = hero({ cupShared: false, gamesRemaining: 1 });
    expect(html).toContain("First to 4.5 wins");
    expect(html).not.toContain("Shared");
  });
});

describe("the hero counts in halves only on a cup that does (Zach's half-points rule)", () => {
  const teamsHalf = { teamTotals: { a: 3.5, b: 2.5 }, cupShared: false, gamesRemaining: 1 };
  it("with the flag: the totals and the target write ½", () => {
    const html = hero({ ...teamsHalf, halfPoints: true });
    expect(html).toContain("First to 4½ wins");
    expect(html).toContain(">3½<");
    expect(html).toContain(">2½<");
    expect(html).not.toContain(">3.5<");
  });
  it("CONTROL, without it: the same numbers are decimals", () => {
    const html = hero(teamsHalf);
    expect(html).toContain("First to 4.5 wins");
    expect(html).toContain(">3.5<");
    expect(html).not.toContain("½");
  });
  it("the collapsed bar follows the same flag", () => {
    const bar = (halfPoints: boolean) =>
      renderToStaticMarkup(
        <CollapsedHero teams={teams} teamTotals={{ a: 3.5, b: 2.5 }} winNumber={4.5} pointsAvailable={8} clincher={null} halfPoints={halfPoints} />
      );
    expect(bar(true)).toContain("First to 4½ wins");
    expect(bar(true)).toContain(">3½<");
    expect(bar(false)).toContain("First to 4.5 wins");
    expect(bar(false)).not.toContain("½");
  });
  it("the collapsed bar says the same", () => {
    const html = renderToStaticMarkup(
      <CollapsedHero teams={teams} teamTotals={{ a: 4, b: 4 }} winNumber={4.5} pointsAvailable={8} clincher={null} cupShared />
    );
    expect(html).toContain("Final · Shared");
    expect(html).not.toContain("First to");
  });
});
