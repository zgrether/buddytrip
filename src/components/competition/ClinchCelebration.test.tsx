import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitionHero, StickyCollapseHero } from "./CompetitionHero";
import type { TrophySlotProps } from "./CupTrophy";
import type { LBTeam } from "./CompetitionLeaderboard";

/**
 * The clinch celebration's two states, its once-only burst, and the swappable
 * trophy slot. Rendered via react-dom/server (the suite is `environment: node`),
 * so this pins WHAT IS EMITTED — which is exactly where the state distinction
 * lives. The burst's motion is CSS and is verified on a device.
 */

const team = (id: string, name: string, color: string): LBTeam => ({
  id,
  name,
  short_name: name.slice(0, 3).toUpperCase(),
  color,
});
const teams = [team("a", "Manhattans", "#4ade80"), team("b", "Centurions", "#fb923c")];

function hero(props: Partial<React.ComponentProps<typeof CompetitionHero>>) {
  return renderToStaticMarkup(
    <CompetitionHero
      cupName="BBMI Test Cup"
      tagline={null}
      teams={teams}
      teamTotals={{ a: 39.5, b: 28 }}
      pointsAvailable={100}
      winNumber={50.5}
      clincher={null}
      scoringModel="match_play"
      canEdit={false}
      {...props}
    />,
  );
}

const SPARKS = /data-testid="clinch-sparks"/;
const GLOW = /data-testid="clinch-glow"/;

describe("the two states", () => {
  it("clinched with games remaining → no glow, no burst, and honest wording", () => {
    const html = hero({ clincher: teams[1], cupComplete: false, celebrateFirstView: true });
    expect(html).not.toMatch(GLOW);
    expect(html).not.toMatch(SPARKS);
    // The copy bug this feature exposed: "Final" used to appear the moment
    // anyone clinched, while play continued.
    expect(html).not.toContain("Final ·");
    expect(html).toContain("has clinched");
    expect(html).toContain("games remain");
  });

  it("clinched AND complete, first view → glow, burst, and Final", () => {
    const html = hero({ clincher: teams[1], cupComplete: true, celebrateFirstView: true });
    expect(html).toMatch(GLOW);
    expect(html).toMatch(SPARKS);
    expect(html).toContain("Final ·");
    expect(html).toContain("Centurions wins");
  });

  it("complete, NOT first view → the still state: glow stays, burst does not", () => {
    const html = hero({ clincher: teams[1], cupComplete: true, celebrateFirstView: false });
    expect(html).toMatch(GLOW);
    expect(html).not.toMatch(SPARKS);
    expect(html).toContain("Final ·");
  });

  it("no clincher → resting watermark, no glow", () => {
    const html = hero({ clincher: null, cupComplete: false });
    expect(html).not.toMatch(GLOW);
    expect(html).not.toMatch(SPARKS);
    expect(html).toContain("First to");
  });
});

describe("the burst belongs to the winners; the result belongs to everyone", () => {
  it("a non-winner still gets the full still treatment — glow, lit trophy, Final", () => {
    // `celebrateFirstView` false is how a loser (or an unassigned organiser)
    // arrives here: the caller gates it on being on the winning team. They must
    // still see the RESULT, and see it properly.
    const html = hero({ clincher: teams[1], cupComplete: true, celebrateFirstView: false });
    expect(html).toMatch(GLOW);
    expect(html).toContain("Final ·");
    expect(html).toMatch(/<g opacity="0\.42"/); // trophy lit, not the watermark
    expect(html).not.toMatch(SPARKS); // …but no confetti fired at them
  });

  it("the re-fire button is absent unless the viewer won", () => {
    const html = hero({ clincher: teams[1], cupComplete: true, canReplayCelebration: false });
    expect(html).not.toContain('data-testid="clinch-replay-btn"');
  });

  it("the re-fire button appears for a winner on a finished cup", () => {
    const html = hero({ clincher: teams[1], cupComplete: true, canReplayCelebration: true });
    expect(html).toContain('data-testid="clinch-replay-btn"');
    expect(html).toContain("Set off the fireworks");
  });

  it("no re-fire button while the cup is merely clinched", () => {
    // Nothing to celebrate yet — the games are still being played.
    const html = hero({ clincher: teams[1], cupComplete: false, canReplayCelebration: true });
    expect(html).not.toContain('data-testid="clinch-replay-btn"');
  });
});

describe("the loser's score survives the celebration", () => {
  it("both totals are still rendered when the cup is won", () => {
    const html = hero({ clincher: teams[1], cupComplete: true, celebrateFirstView: true });
    // 39½–28: the result is a SCORELINE. A celebration that erases the loser
    // becomes a trophy screen instead.
    expect(html).toContain("39½");
    expect(html).toContain("28");
    expect(html).toContain("Manhattans");
  });
});

describe("the two-instance gate", () => {
  it("StickyCollapseHero renders the burst exactly once, not once per variant", () => {
    // It renders CompetitionHero twice (pinned collapsed bar + expanded card).
    // An ungated burst fires in both and the seen-flag gets burned by whichever
    // mounts first.
    const html = renderToStaticMarkup(
      <StickyCollapseHero
        cupName="BBMI Test Cup"
        tagline={null}
        teams={teams}
        teamTotals={{ a: 39.5, b: 28 }}
        pointsAvailable={100}
        winNumber={50.5}
        clincher={teams[1]}
        cupComplete
        celebrateFirstView
        scoringModel="match_play"
        canEdit={false}
      />,
    );
    expect(html.match(/data-testid="clinch-sparks"/g) ?? []).toHaveLength(1);
  });
});

/**
 * The opening of Bill's engraved path — the golfer the default cup carries in
 * place of the old star. Only the real artwork produces it.
 */
const BILL_ENGRAVING = "M258 12.2C249.8 12.4";

describe("the trophy is a swappable slot", () => {
  it("the default cup is the one engraved with Bill", () => {
    expect(hero({ clincher: teams[1], cupComplete: true })).toContain(BILL_ENGRAVING);
  });

  it("a replacement shape renders in place of the cup, with the animation intact", () => {
    // The demonstration the spec asks for: one prop, no other change.
    const Placeholder = ({ opacity, tint }: TrophySlotProps) => (
      <svg data-testid="placeholder-trophy" width="300" viewBox="0 0 300 380">
        <rect x="0" y="0" width="300" height="380" opacity={opacity} fill={tint ?? "#888"} />
      </svg>
    );
    const html = hero({
      clincher: teams[1],
      cupComplete: true,
      celebrateFirstView: true,
      trophy: Placeholder,
    });
    expect(html).toContain('data-testid="placeholder-trophy"');
    // The default cup's engraved Bill is gone. Paired with the positive
    // assertion above, so this cannot quietly become a check for a string the
    // default trophy stopped containing (which is what the retired star's path
    // literal turned into the moment Bill replaced it).
    expect(html).not.toContain(BILL_ENGRAVING);
    // …and the celebration around the slot is untouched.
    expect(html).toMatch(SPARKS);
    expect(html).toMatch(GLOW);
  });

  // Asserted on the RENDERED trophy rather than by capturing props: the React
  // Compiler lint forbids mutating a captured binding from a component body,
  // and the emitted SVG is the better subject anyway — it is what a viewer
  // actually gets.
  it("a finished cup lights the trophy and mixes the winner's colour into its stops", () => {
    const html = hero({ clincher: teams[1], cupComplete: true });
    // Lifted off the 0.17 watermark…
    expect(html).toMatch(/<g opacity="0\.42"/);
    expect(html).not.toMatch(/<g opacity="0\.17"/);
    // …and the winner's colour reaches the trophy's own gradient STOPS, not just
    // the wash behind it. Asserted on a stop-color specifically: the hero card's
    // `teamGlow` background uses `color-mix` too, so a bare "contains color-mix"
    // would pass even with the trophy left untinted.
    expect(html).toMatch(/stop-color="color-mix\(in srgb, #fb923c/);
  });

  it("an unfinished cup keeps the plain 0.17 gold watermark", () => {
    const html = hero({ clincher: teams[1], cupComplete: false });
    expect(html).toMatch(/<g opacity="0\.17"/);
    // The raw reference golds survive untouched — no tint mixed in.
    expect(html).toMatch(/stop-color="#d9b350"/);
    expect(html).not.toMatch(/stop-color="color-mix/);
  });
});
