import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchupLine, sideEmphasisStyle } from "./slateRowVisual";
import { resultEmphasis, resultTone } from "./PickemRunView";
import type { SlateResult } from "@/lib/pickemScoring";

/**
 * Three outcomes, three appearances — readable without reading the status word.
 *
 * ── Why this file exists separately from the run view's own tests ─────────
 *
 * Those assert what the SCREEN renders. These assert the two distinctions the
 * whole treatment rests on, and both are the kind that a value-level test
 * cannot see:
 *
 *   - a cancelled matchup differs from a played one ONLY in `textDecoration`
 *   - a pushed row differs from a final one ONLY in whether the two names
 *     share a weight
 *
 * Neither has a value, a key or a string to break. CLAUDE.md's tenth instance
 * is exactly this shape — a distinction carried by a style property, invisible
 * to the configHash column guard, to exhaustive `Record` maps, and to mutation
 * testing that changes values — and it says the guard has to mutate the PAINT.
 * So each test below states the mutation it fails against.
 */

/** One line's own style attribute, found by testid.
 *
 *  Anchored to the LINE, not the document: `MatchupLine` prints the home team
 *  on a second line and the status below that, so a `toContain` over the whole
 *  render would happily match a declaration belonging to a different node. */
function lineStyle(markup: string, side: "away" | "home"): string {
  const at = markup.indexOf(`data-testid="pickem-matchup-${side}"`);
  if (at === -1) return "";
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

const GAME = {
  awayTeam: "Ball State Cardinals",
  homeTeam: "Ohio State Buckeyes",
  spread: "-50.5",
  kickoff: "Sat Sep 5, 12:30p",
  note: null,
  multiplier: 1,
};

const renderResult = (result: SlateResult | null) => {
  const e = resultEmphasis(result);
  return renderToStaticMarkup(
    <MatchupLine
      game={GAME}
      awayEmphasis={e.away}
      homeEmphasis={e.home}
      status={result ? { text: "x", tone: resultTone(result) } : undefined}
    />
  );
};

describe("a cancelled contest is struck through", () => {
  it("puts line-through on BOTH team names", () => {
    /**
     * THE MUTATION: drop `textDecoration` from `sideEmphasisStyle("struck")`.
     *
     * Every other assertion in this file still passes against that build —
     * the colours are right, the weights are right, the status still reads
     * "Cancelled" in red — and a cancelled matchup renders identically to a
     * played one. This is the only test that fails.
     */
    const html = renderResult("cancelled");
    expect(lineStyle(html, "away")).toContain("text-decoration:line-through");
    expect(lineStyle(html, "home")).toContain("text-decoration:line-through");
  });

  it("strikes NOTHING on a contest that was played", () => {
    /**
     * The other half, and the one that catches a build that strikes
     * everything: `line-through` has to be absent where it does not belong,
     * or its presence says nothing.
     */
    for (const result of ["away", "home", "push", null] as const) {
      const html = renderResult(result);
      expect(lineStyle(html, "away"), String(result)).not.toContain("line-through");
      expect(lineStyle(html, "home"), String(result)).not.toContain("line-through");
    }
  });

  it("leaves the connective 'at' unstruck", () => {
    /**
     * "at" is not part of the claim about either team, and striking a
     * preposition reads as damage to the markup rather than as a voided stake.
     * It carries an explicit `text-decoration:none` because it INHERITS
     * otherwise — the property descends, so absence of a rule is not absence
     * of the line.
     */
    expect(renderResult("cancelled")).toContain("text-decoration:none");
  });
});

describe("a push has no contrast; a final always has exactly one bold name", () => {
  it("gives a pushed row's two names the SAME weight", () => {
    /**
     * THE MUTATION, and the spec names it as the tempting one: dim the loser
     * AND dim on push — i.e. make `level` return the same thing as `lost`.
     *
     * That build passes every colour assertion and every status assertion. It
     * destroys the distinction the design rests on: the absence of contrast is
     * what says "nobody covered", and it can only mean that if a decided game
     * never produces it.
     */
    const push = renderResult("push");
    const away = lineStyle(push, "away");
    const home = lineStyle(push, "home");
    expect(away).toContain("font-weight:500");
    expect(home).toContain("font-weight:500");
    // Same COLOUR too — a push is not a pair of losers.
    expect(away).toContain("--color-bt-text)");
    expect(home).toContain("--color-bt-text)");
  });

  it("gives a final row's two names DIFFERENT weights, whichever side won", () => {
    /**
     * Both directions, because a build that hardcoded "away wins" would pass
     * on one of them. The pair `(700, 500)` must appear in the winning side's
     * order, not merely appear.
     */
    const awayWon = renderResult("away");
    expect(lineStyle(awayWon, "away")).toContain("font-weight:700");
    expect(lineStyle(awayWon, "home")).toContain("font-weight:500");

    const homeWon = renderResult("home");
    expect(lineStyle(homeWon, "away")).toContain("font-weight:500");
    expect(lineStyle(homeWon, "home")).toContain("font-weight:700");
  });

  it("never lets a push and a final look the same", () => {
    /**
     * The invariant stated directly rather than inferred from the two tests
     * above: a decided game has exactly ONE bold name and a push has none, so
     * counting them separates the two without knowing anything else.
     */
    const bold = (markup: string) =>
      (["away", "home"] as const).filter((s) => lineStyle(markup, s).includes("font-weight:700"))
        .length;
    expect(bold(renderResult("away"))).toBe(1);
    expect(bold(renderResult("home"))).toBe(1);
    expect(bold(renderResult("push"))).toBe(0);
    expect(bold(renderResult("cancelled"))).toBe(0);
    expect(bold(renderResult(null))).toBe(0);
  });
});

describe("the three status tones are three different colours", () => {
  it("keeps final, push and cancelled distinguishable", () => {
    /**
     * A map that collapsed two of these would satisfy any test asserting each
     * one individually — the `swingCell` zeros test in this feature already
     * uses a Set for exactly that reason.
     */
    const tones = (["away", "home", "push", "cancelled"] as const).map(resultTone);
    expect(new Set(tones).size).toBe(3);
    expect(new Set([...tones.map((t) => t)].map(String))).toContain("final");

    const colours = new Set(["final", "push", "cancelled"].map((t) =>
      JSON.stringify(sideEmphasisStyle(t === "cancelled" ? "struck" : t === "push" ? "level" : "won"))
    ));
    expect(colours.size).toBe(3);
  });

  it("marks a settled row's status and drops the kickoff, keeping the note", () => {
    /**
     * "Status replaces the DATE" — literally. The date is spent once the game
     * is over; the runner's note ("Rob and Matt") is not, and replacing both
     * would lose information the row is the only place to see.
     */
    const withNote = renderToStaticMarkup(
      <MatchupLine
        game={{ ...GAME, note: "Rob and Matt" }}
        status={{ text: "Cancelled", tone: "cancelled" }}
      />
    );
    expect(withNote).toContain("Cancelled");
    expect(withNote).toContain("Rob and Matt");
    expect(withNote).not.toContain("12:30p");

    // ...and with no status the kickoff is still there.
    expect(renderToStaticMarkup(<MatchupLine game={GAME} />)).toContain("12:30p");
  });
});
