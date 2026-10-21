import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StartingPointReview } from "./StartingPointReview";
import type { StartingPointId } from "@/lib/startingPoints";

/**
 * A starting point's review (Zach's rulings, 2026-10-21): art, name, setup.
 * Golf week asks Play as and, with Teams, how many; Scramble joins only with
 * teams. A Head-to-Head Cup has nothing to choose. Anchored on test ids.
 */

const noop = () => {};
function render(id: StartingPointId, over: { playAs?: "individuals" | "teams"; teamCount?: number; name?: string } = {}) {
  return renderToStaticMarkup(
    <StartingPointReview
      startingPoint={id}
      name={over.name ?? "The Yert Open"}
      onNameChange={noop}
      playAs={over.playAs ?? "individuals"}
      onPlayAsChange={noop}
      teamCount={over.teamCount ?? 2}
      onTeamCountChange={noop}
      onBack={noop}
      onCreate={noop}
      submitting={false}
      error={null}
    />
  );
}
const between = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  return at < 0 ? null : html.slice(html.indexOf(">", at) + 1, html.indexOf("</", at));
};
const suggestionKeys = (html: string) => [...html.matchAll(/data-testid="review-suggestion-([^"]+)"/g)].map((m) => m[1]);

describe("Golf week's review", () => {
  it("as individuals: the chip says so, no team stepper, Stroke Play and Skins", () => {
    const html = render("golf_week");
    expect(between(html, "starting-point-review-chip")).toBe("Tournament · Individuals");
    expect(html).toContain('aria-pressed="true" data-testid="play-as-individuals"');
    expect(html).toContain('aria-pressed="false" data-testid="play-as-teams"');
    expect(html).not.toContain('data-testid="starting-point-teams"');
    expect(suggestionKeys(html)).toEqual(["gtt_stroke_play", "gtt_skins"]);
  });

  it("as 3 teams: the chip and three badges, and Scramble joins the suggestions", () => {
    const html = render("golf_week", { playAs: "teams", teamCount: 3 });
    expect(between(html, "starting-point-review-chip")).toBe("Tournament · 3 teams");
    const teams = html.slice(html.indexOf('data-testid="starting-point-teams"'));
    expect((teams.match(/data-testid="team-badge"/g) ?? []).length).toBe(3);
    expect(suggestionKeys(html)).toEqual(["gtt_stroke_play", "gtt_skins", "gtt_scramble"]);
  });

  it("says what it creates, and needs a name of at least 2 characters", () => {
    expect(render("golf_week")).toContain(">Create tournament</button>");
    expect(render("golf_week", { name: "x" })).toMatch(/<button[^>]*disabled=""[^>]*data-testid="competition-setup-submit"/);
  });
});

describe("a Head-to-Head Cup's review has nothing to choose", () => {
  it("no Play as, no team stepper, two teams, and it creates a cup", () => {
    const html = render("team_cup_weekend");
    expect(html).not.toContain('data-testid="play-as"');
    expect(html).not.toContain('data-testid="starting-point-teams"');
    expect(between(html, "starting-point-review-chip")).toBe("Cup · 2 teams");
    expect(html).toContain(">Create cup</button>");
  });
});
