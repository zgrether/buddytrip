import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MatchupLine,
  gameWinner,
  sideMarks,
  sideNameStyle,
  spreadPair,
} from "./slateRowVisual";
import { resultTone } from "./PickemRunView";
import type { SlateResult } from "@/lib/pickemScoring";

/**
 * TWO FACTS ON ONE ROW, AND THEY ARE ALLOWED TO DISAGREE.
 *
 * ── What this file used to assert, and why it could not stay ─────────────
 *
 * It guarded "a pushed row differs from a final one ONLY in whether the two
 * names share a weight", with weight derived from `result`. That made weight
 * answer WHO COVERED while reading as WHO WON — and once the covered badges
 * were removed, nothing on a row said which side the runner had marked. A row
 * could show Miami bold at 45-6 with Stanford having covered, and say nothing.
 *
 * Weight now comes from the SCORES and the box comes from `result`, so the two
 * facts have two marks and can differ on screen the way they differ in life.
 * The old file's other subject — that a distinction living in a style property
 * needs a test that mutates the PAINT (CLAUDE.md's tenth instance) — is
 * unchanged and is why every case below states the mutation it fails against.
 *
 * ── The fixture is the point ─────────────────────────────────────────────
 *
 * `SPLIT` is a game where the winner did NOT cover: the home side is laid
 * -24.5 and wins by 20, so it wins the game and loses the bet. It is the only
 * shape that separates a correct build from the natural wrong one, and it is
 * the case a spread exists to create. Production currently holds ZERO of them
 * (checked: 5 scored games, all covered by the winner), so until one happens
 * on a Sunday this fixture is the only thing exercising it.
 */

function tagFor(markup: string, testId: string): string {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

const GAME = {
  awayTeam: "Marshall Thundering Herd",
  homeTeam: "Penn State Nittany Lions",
  spread: "-24.5",
  kickoff: "Sat Sep 5, 12:30p",
  note: null,
  multiplier: 1,
};

/** Home wins 30-10 and is laid -24.5, so HOME won the game and AWAY covered. */
const SPLIT = { result: "away" as const, awayScore: 10, homeScore: 30 };

const render = (
  ctx: { result: SlateResult | null; awayScore?: number | null; homeScore?: number | null }
) =>
  renderToStaticMarkup(
    <MatchupLine
      game={GAME}
      awayMarks={sideMarks("away", ctx)}
      homeMarks={sideMarks("home", ctx)}
      awayScore={ctx.awayScore}
      homeScore={ctx.homeScore}
      status={ctx.result ? { text: "x", tone: resultTone(ctx.result) } : undefined}
      /* SENT BECAUSE THE REAL CALLERS SEND IT. The three viewing surfaces opt
         into the mirrored line; only the excluded slate builder does not, and a
         fixture that omitted it would be measuring the builder's row while
         claiming to test theirs. */
      mirrorSpread
    />
  );

describe("the winner and the coverer are marked separately", () => {
  const html = render(SPLIT);

  it("BOLDS the side that won the game", () => {
    /**
     * THE MUTATION: derive weight from `result` again, which is the build this
     * replaces and the one a reader reaches for. It bolds the AWAY side here,
     * and it passes every case where the winner also covered — which is every
     * scored game in production so far.
     */
    expect(tagFor(html, "pickem-matchup-home")).toContain("font-weight:700");
    expect(tagFor(html, "pickem-matchup-away")).not.toContain("font-weight:700");
  });

  it("BOXES the side that covered — the other one", () => {
    /**
     * THE MUTATION, and the spec names it: box the bold side. It is the natural
     * implementation, it agrees with a correct build on every game where the
     * winner covered, and it is wrong on exactly the games a spread exists for.
     *
     * Asserted on the SAME row as the bold above, so a build cannot satisfy one
     * by sacrificing the other.
     */
    expect(tagFor(html, "pickem-matchup-away")).toContain('data-covered="true"');
    expect(tagFor(html, "pickem-matchup-home-line")).toContain('data-covered="false"');
  });

  it("draws the box as a real container, not merely an attribute", () => {
    /**
     * The testid could be set without anything being drawn, so this asserts the
     * BORDER — coloured on one side, transparent on the other.
     *
     * Anchored to that property rather than to the colour's literal value. The
     * weight is a design call that has already moved twice (dim read as chrome,
     * near-black shouted, and it settled a quarter of the way between), and a
     * test that fails on a tuning change is a test that trains people to edit
     * it without reading it. What must not change is that exactly one side is
     * drawn.
     */
    const away = tagFor(html, "pickem-matchup-away");
    const home = tagFor(html, "pickem-matchup-home-line");
    expect(away).toMatch(/border:1px solid (?!transparent)/);
    expect(home).toContain("border:1px solid transparent");
  });

  it("reserves the box's width on BOTH lines, so a result cannot jog the row", () => {
    // A border that appeared only on the covering line would inset that line by
    // its own width and padding, and the two team names would sit at different
    // left edges. Both carry it; only one is coloured.
    expect(tagFor(html, "pickem-matchup-home-line")).toContain("padding-left:5px");
  });
});

describe("the score says exactly what its name says", () => {
  it("gives a score the same weight as the name it sits beside, both sides", () => {
    /**
     * ASSERTED AS EQUALITY, not against two literals — two literals pass a
     * build where both are wrong in the same way, which is the whole failure
     * mode of a pair that must agree.
     *
     * THE MUTATION: give `TeamScore` a fixed weight again. The winner's half of
     * the row keeps saying 700 and the loser's score goes bold beside a normal
     * name, which is the disagreement this rule exists to make impossible.
     */
    const html = render(SPLIT);
    const weight = (tag: string) => /font-weight:(\d+)/.exec(tag)?.[1];
    expect(weight(tagFor(html, "pickem-score-home"))).toBe(
      weight(tagFor(html, "pickem-matchup-home"))
    );
    expect(weight(tagFor(html, "pickem-score-away"))).toBe(
      weight(tagFor(html, "pickem-matchup-away"))
    );
    // ...and the pair is not trivially equal by both being absent.
    expect(weight(tagFor(html, "pickem-score-home"))).toBe("700");
  });
});

describe("a push", () => {
  it("draws no box on either side, because nobody covered", () => {
    const html = render({ result: "push", awayScore: 24, homeScore: 17 });
    expect(html).not.toContain('data-covered="true"');
  });

  it("still bolds whoever won the GAME, which is the one thing it can say", () => {
    // A push is a fact about the bet, not about the scoreboard. Blanking the
    // weight would throw away the only thing such a row still knows.
    const html = render({ result: "push", awayScore: 24, homeScore: 17 });
    expect(tagFor(html, "pickem-matchup-away")).toContain("font-weight:700");
  });
});

describe("no score is not a draw, and not a loss", () => {
  it("bolds NEITHER side when the game has no score", () => {
    /**
     * The state most of a slate is in for most of a weekend: marked, unscored.
     * A build that fell back to `result` for the weight would bold the covering
     * side here and claim a scoreboard nobody entered.
     */
    const html = render({ result: "home", awayScore: null, homeScore: null });
    expect(tagFor(html, "pickem-matchup-away")).not.toContain("font-weight:700");
    expect(tagFor(html, "pickem-matchup-home")).not.toContain("font-weight:700");
    // ...and the box still lands, because who covered is known independently.
    expect(tagFor(html, "pickem-matchup-home-line")).toContain('data-covered="true"');
  });

  it("dims NEITHER side either — unknown is not losing", () => {
    const html = render({ result: "home", awayScore: null, homeScore: null });
    expect(tagFor(html, "pickem-matchup-away")).not.toContain("--color-bt-text-dim");
  });

  it("treats HALF a score as no score", () => {
    // The state manual entry passes through on its way to a pair.
    expect(gameWinner(21, null)).toBeNull();
    expect(gameWinner(null, 21)).toBeNull();
  });

  it("treats a TIE as no winner rather than as two winners", () => {
    expect(gameWinner(17, 17)).toBeNull();
    const html = render({ result: "home", awayScore: 17, homeScore: 17 });
    expect(html).not.toContain("font-weight:700");
  });
});

describe("a cancelled contest is struck through", () => {
  const html = render({ result: "cancelled", awayScore: 10, homeScore: 30 });

  it("puts line-through on BOTH team names", () => {
    /**
     * THE MUTATION: drop `textDecoration` from `sideDecoration`. Every other
     * assertion here still passes against that build — the colours are right,
     * the status still reads in red — and a cancelled matchup renders exactly
     * like a played one.
     */
    expect(tagFor(html, "pickem-matchup-away-name")).toContain("text-decoration:line-through");
    expect(tagFor(html, "pickem-matchup-home-name")).toContain("text-decoration:line-through");
  });

  it("strikes the NAME and not the connective — structurally, not by opting out", () => {
    // `text-decoration` propagates and CANNOT be removed by a descendant, so
    // the only fix is for "at" to sit outside the decorated span. A build that
    // struck the whole line would put the line through "at" as well.
    expect(tagFor(html, "pickem-matchup-home")).not.toContain("text-decoration:line-through");
  });

  it("ranks nothing on a cancelled contest — no winner, no loser, no box", () => {
    // The contest was struck from the scoring, so the scoreboard is not worth
    // ranking and nobody covered. The strike is the whole statement.
    expect(html).not.toContain("font-weight:700");
    expect(html).not.toContain('data-covered="true"');
  });

  it("strikes NOTHING on a contest that was played", () => {
    expect(render(SPLIT)).not.toContain("line-through");
  });
});

describe("the line is shown on both sides, or on neither", () => {
  it("mirrors the home number onto the away row", () => {
    // The box wraps name, score AND line. With the number on one side only, a
    // box around the other row wraps a team with nothing where its line should
    // be and reads as incomplete.
    expect(spreadPair("-24.5")).toEqual({ away: "+24.5", home: "-24.5" });
    expect(spreadPair("3.5")).toEqual({ away: "-3.5", home: "+3.5" });
    expect(spreadPair("-10")).toEqual({ away: "+10", home: "-10" });
  });

  it("shows a spread of 0 on NEITHER side", () => {
    // Two production rows carry "0". A pick'em with no line is a straight
    // winner call, and "0" beside "-0" is two badges saying nothing twice.
    expect(spreadPair("0")).toEqual({ away: null, home: null });
    expect(spreadPair("-0")).toEqual({ away: null, home: null });
    expect(spreadPair("0.0")).toEqual({ away: null, home: null });
  });

  it("shows nothing at all when no line was entered", () => {
    expect(spreadPair(null)).toEqual({ away: null, home: null });
    expect(spreadPair("")).toEqual({ away: null, home: null });
    expect(spreadPair("   ")).toEqual({ away: null, home: null });
  });

  it("does not invent a mirror for something that is not a number", () => {
    /**
     * The column is free TEXT. Production holds zero unparseable values (15 of
     * 15 parse), so this is defensive — but the failure it prevents is the bad
     * kind: a confidently wrong number on the away row of a betting screen.
     */
    expect(spreadPair("PK")).toEqual({ away: null, home: "PK" });
    expect(spreadPair("Toledo -3")).toEqual({ away: null, home: "Toledo -3" });
  });

  it("renders both badges on the row", () => {
    const html = render(SPLIT);
    expect(html).toContain("+24.5");
    expect(html).toContain("-24.5");
  });
});

describe("teal is the Picks page's, and only the Picks page has a pick", () => {
  it("paints the side you took, overriding the winner colour", () => {
    // The home side WON the game here and would otherwise be plain text; the
    // reader took it, so teal wins the colour. The weight still says who won.
    const m = sideMarks("home", { ...SPLIT, pick: "home" });
    expect(sideNameStyle(m).color).toBe("var(--color-bt-accent)");
    expect(sideNameStyle(m).fontWeight).toBe(700);
  });

  it("cannot reach a surface that passes no pick", () => {
    /**
     * The exception is a SURFACE, not a behaviour — which is what stops it
     * drifting back into three private rules. Matches and Results pass no pick,
     * so there is no teal case for them to get wrong.
     */
    expect(sideMarks("home", SPLIT).chosen).toBe(false);
    expect(sideNameStyle(sideMarks("home", SPLIT)).color).toBe("var(--color-bt-text)");
  });

  it("strikes a pick that LOST the bet, and not one that merely lost the game", () => {
    // The home side lost the BET here while winning the game. The strike is
    // about the stake, so it follows the cover and not the scoreboard.
    expect(sideMarks("home", { ...SPLIT, pick: "home" }).struck).toBe(true);
    expect(sideMarks("away", { ...SPLIT, pick: "away" }).struck).toBe(false);
  });

  it("does NOT strike a pick on a push — the stake stood", () => {
    expect(
      sideMarks("away", { result: "push", awayScore: 24, homeScore: 17, pick: "away" }).struck
    ).toBe(false);
  });
});

describe("the three status tones are three different colours", () => {
  it("keeps final, push and cancelled distinguishable", () => {
    const tones = (["away", "push", "cancelled"] as const).map((r) => resultTone(r));
    expect(new Set(tones).size).toBe(3);
  });
});
