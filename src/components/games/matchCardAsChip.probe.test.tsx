import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard } from "./MatchCard";
import type { DecidedHole } from "@/lib/matchPlay";

/**
 * `AS` USES ONE SOURCE ON BOTH PATHS.
 *
 * Written first as an instrument, then kept as a guard.
 *
 * The survey found the all-square `AS` CHIP rendered at 2.95 : 1 on a light
 * card. That was measured on the NEUTRAL path (Quick Match Play, no team
 * colours), and the claim that the TEAM path rendered identically was READ, so
 * it was measured before building rather than after. It held.
 *
 * PR 9a then took `AS` out of the chips altogether (Zach's looks: a tie belongs
 * to neither side, so it is said once, in the header's centre label — "AS ·
 * THRU" — and both chips stay empty). The invariant moved with it and is still
 * worth holding: the word reaches the screen through the HEADER's colour, with
 * no `teams` term, so giving the team path its own treatment has to be done
 * deliberately and fails here when it is.
 */

const A = { id: "a", name: "Amber Squad", color: "#f59e0b" };
const B = { id: "b", name: "Cyan Crew", color: "#06b6d4" };

/** One hole each: level, with sixteen to play. */
const LEVEL: DecidedHole[] = [
  { hole: 1, result: "W" },
  { hole: 2, result: "L" },
];

const render = (withTeams: boolean) =>
  renderToStaticMarkup(
    <MatchCard
      a={A}
      b={B}
      results={LEVEL}
      {...(withTeams ? { leftColor: "#f59e0b", rightColor: "#06b6d4" } : {})}
    />,
  );

/** The header word's opening tag plus its text — ONE node, by testid. */
function statusWord(html: string): { tag: string; text: string } {
  const at = html.indexOf('data-testid="match-status-word"');
  const start = html.lastIndexOf("<", at);
  const open = html.indexOf(">", at) + 1;
  return { tag: html.slice(start, open), text: html.slice(open, html.indexOf("</span>", open)) };
}

/** The header's in-play colour — asserted as the string that reaches the DOM. */
const DIM = "color:var(--color-bt-text-dim)";

describe("AS resolves the same source on both paths", () => {
  it("neutral path: AS is in the header, in the header's dim", () => {
    const w = statusWord(render(false));
    expect(w.text).toBe("AS · THRU");
    expect(w.tag).toContain(DIM);
  });

  it("TEAM path does too — the measured claim", () => {
    const w = statusWord(render(true));
    expect(w.text).toBe("AS · THRU");
    expect(w.tag).toContain(DIM);
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
