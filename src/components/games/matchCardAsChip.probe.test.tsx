import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard } from "./MatchCard";

/**
 * THE `AS` CHIP USES ONE SOURCE ON BOTH PATHS.
 *
 * Written first as an instrument, then kept as a guard.
 *
 * The survey found the all-square `AS` chip renders at 2.95 : 1 on a light
 * card. That was measured — but on the NEUTRAL path (Quick Match Play, no team
 * colours). The claim that the TEAM path renders identically was READ, from
 * `Margin`'s expression having no `teams` term:
 *
 *     color: active ? teamTextColor(color) : NEU_HALF
 *
 * That distinction mattered: C's priority rested on `AS` being below the bar on
 * the main BBMI path, not just in Quick Play. So it was measured before
 * building rather than after. It held — both paths resolve the same source.
 *
 * The file stays because the invariant is worth holding: if someone gives the
 * team path its own halved treatment they must do it deliberately, and this
 * fails when they do.
 *
 * Both cards below are ALL SQUARE (`results: []`), so neither side leads and
 * `Margin` renders its inactive arm on both sides of both cards.
 */

const A = { id: "a", name: "Amber Squad", color: "#f59e0b" };
const B = { id: "b", name: "Cyan Crew", color: "#06b6d4" };

/** The token both paths must resolve `AS` through. Asserted as the string that
 *  reaches the DOM, not imported — the point is what renders. */
const HALVED = "var(--color-bt-match-halved)";

const render = (withTeams: boolean) =>
  renderToStaticMarkup(
    <MatchCard
      a={A}
      b={B}
      results={[]}
      {...(withTeams ? { leftColor: "#f59e0b", rightColor: "#06b6d4" } : {})}
    />,
  );

describe("the AS chip resolves the same source on both paths", () => {
  it("neutral path paints AS through --color-bt-match-halved", () => {
    const html = render(false);
    expect(html).toContain("AS");
    expect(html).toContain(HALVED);
  });

  it("TEAM path does too — the measured claim", () => {
    const html = render(true);
    expect(html).toContain("AS");
    expect(html).toContain(HALVED);
  });

  it("the team colours ARE reaching the card — the team path is genuinely taken", () => {
    // Guards the assertion above from passing for the wrong reason. If
    // `leftColor` were ignored, the "team path" case would be the neutral path
    // wearing a different prop, and the test would be vacuous.
    const neutral = render(false);
    const teams = render(true);
    expect(teams).toContain("#f59e0b");
    expect(teams).toContain("#06b6d4");
    expect(teams).not.toBe(neutral);
  });

  it("the neutral win colours appear ONLY on the neutral path", () => {
    // The other half of the same fact: the ramp PR C retuned must not be
    // reachable once teams are set.
    expect(render(false)).toContain("var(--color-bt-match-a)");
    expect(render(true)).not.toContain("var(--color-bt-match-a)");
  });
});
