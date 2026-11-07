import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitionHero } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";
import { teamInk, teamInkOverArt, TEXT_OVER_ART_SHADOW, TEXT_OVER_ART_SHADOW_STRONG } from "@/lib/teamTextColor";

/**
 * The head-to-head Final's text over the lit trophy (#1700): both team names and
 * both big scores take #1696's over-art ink and halo once the cup is complete, and
 * the loser's score steps down in size and weight instead of fading, so every
 * glyph keeps full ink. Measured at 390px in the PR; these pin what is emitted.
 */

const team = (id: string, name: string, color: string): LBTeam => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), color });
const teams = [team("a", "Manhattans", "#4ade80"), team("b", "Centurions", "#3b82f6")];

function hero(props: Partial<React.ComponentProps<typeof CompetitionHero>>) {
  return renderToStaticMarkup(
    <CompetitionHero
      cupName="Test Cup"
      tagline={null}
      teams={teams}
      teamTotals={{ a: 28, b: 39.5 }}
      pointsAvailable={100}
      winNumber={50.5}
      clincher={null}
      gamesRemaining={0}
      scoringModel="match_play"
      canEdit={false}
      {...props}
    />,
  );
}

/** One element's opening tag, by testid. */
function tag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  if (at < 0) return "";
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

const overArt = (color: string) => `color:${teamInkOverArt(color)};text-shadow:${TEXT_OVER_ART_SHADOW}`;

describe("at Final, over the lit trophy", () => {
  const final = () => hero({ clincher: teams[1], cupComplete: true });

  it("both team names take the over-art ink; the winner's name the denser halo, the loser's the ordinary one", () => {
    const html = final();
    // The trophy is lit and tinted in the winner's own colour, so its name needs more backdrop (#1703).
    expect(tag(html, "hero-team-name-b")).toContain(`color:${teamInkOverArt("#3b82f6")};text-shadow:${TEXT_OVER_ART_SHADOW_STRONG}`);
    expect(tag(html, "hero-team-name-a")).toContain(overArt("#4ade80"));
    expect(tag(html, "hero-team-name-a")).not.toContain(TEXT_OVER_ART_SHADOW_STRONG);
  });
  it("the denser halo is for names only: the winning score keeps the ordinary one", () => {
    const score = tag(final(), "hero-score-b");
    expect(score).toContain(`text-shadow:${TEXT_OVER_ART_SHADOW}`);
    expect(score).not.toContain(TEXT_OVER_ART_SHADOW_STRONG);
  });
  it("CONTROL: clinched before Final, nobody's name takes the denser halo", () => {
    const html = hero({ clincher: teams[1], cupComplete: false, gamesRemaining: 2 });
    expect(html).not.toContain(TEXT_OVER_ART_SHADOW_STRONG);
  });

  it("both big scores take the over-art ink and halo, the loser's included", () => {
    const html = final();
    expect(tag(html, "hero-score-a")).toContain(overArt("#4ade80"));
    expect(tag(html, "hero-score-b")).toContain(overArt("#3b82f6"));
  });

  it("the loser's score steps down in size and weight, at full ink: no opacity", () => {
    const html = final();
    // "39.5" is four characters, so the pair is sized 58; the loser takes 72% of it.
    const winner = tag(html, "hero-score-b");
    const loser = tag(html, "hero-score-a");
    expect(winner).toContain("font-size:58px;font-weight:700");
    expect(loser).toContain("font-size:42px;font-weight:600");
    expect(loser).toContain('data-lost="true"');
    expect(winner).not.toContain("data-lost");
    expect(html).not.toMatch(/data-testid="hero-score-[ab]"[^>]*opacity/);
    expect(html).not.toMatch(/<span style="[^"]*opacity:0\.62/);
  });
});

describe("the team names sit across the trophy at every stage (#1703)", () => {
  it("before Final too, both names take the over-art ink and halo", () => {
    const html = hero({ clincher: null, cupComplete: false, gamesRemaining: 3 });
    expect(tag(html, "hero-team-name-a")).toContain(overArt("#4ade80"));
    expect(tag(html, "hero-team-name-b")).toContain(overArt("#3b82f6"));
  });
  it("on a shared Final, the names too", () => {
    const html = hero({ clincher: null, cupComplete: false, cupShared: true, teamTotals: { a: 30, b: 30 } });
    expect(tag(html, "hero-team-name-a")).toContain(overArt("#4ade80"));
    expect(tag(html, "hero-team-name-b")).toContain(overArt("#3b82f6"));
  });
});

describe("CONTROL: before Final the numerals are large text, so no halo", () => {
  it("clinched with games left: the scores keep the card ink, unhaloed, and a matched pair", () => {
    const html = hero({ clincher: teams[1], cupComplete: false, gamesRemaining: 2 });
    for (const [id, color] of [["a", "#4ade80"], ["b", "#3b82f6"]] as const) {
      expect(tag(html, `hero-score-${id}`)).toContain(`color:${teamInk(color)}`);
      expect(tag(html, `hero-score-${id}`)).not.toContain("text-shadow");
      expect(tag(html, `hero-score-${id}`)).toContain("font-size:58px;font-weight:700");
    }
    expect(html).not.toContain("data-lost");
  });

  it("a shared Final has no loser: no step, and the scores unhaloed", () => {
    const html = hero({ clincher: null, cupComplete: false, cupShared: true, teamTotals: { a: 30, b: 30 } });
    expect(tag(html, "hero-score-a")).toContain("font-weight:700");
    expect(tag(html, "hero-score-b")).toContain("font-weight:700");
    expect(tag(html, "hero-score-a")).not.toContain("text-shadow");
    expect(tag(html, "hero-score-b")).not.toContain("text-shadow");
    expect(html).not.toContain("data-lost");
  });
});
