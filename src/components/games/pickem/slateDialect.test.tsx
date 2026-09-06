import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard } from "@/components/games/MatchCard";
import { PickemSheetRow } from "./PickemSheetRow";
import type { DecidedHole } from "@/lib/matchPlay";

/**
 * Round 4 — two DELIBERATE divergences from the match card, and a cancellation
 * the picks sheet was not drawing.
 *
 * ── The divergences are not gaps ──────────────────────────────────────────
 *
 * They exist because GOLF'S ROUND LENGTH IS FIXED AND KNOWN AND A SLATE'S IS
 * NOT, and they are asserted here so that a later pass "restoring consistency"
 * has to delete a test that says why rather than quietly re-aligning them.
 */

const a = { id: "a", name: "Ada", color: "#5b8def" };
const b = { id: "b", name: "Bo", color: "#e0873f" };
const W = (hole: number): DecidedHole => ({ hole, result: "W" });

/** One element's opening tag, found by testid. */
function tag(markup: string, testId: string): string {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

describe("progress counts DOWN on a slate and UP on a round", () => {
  /** Five of sixteen decided — 11 to come. */
  const five = [W(1), W(2), W(3), W(4), W(5)];

  it("says LEFT and the games REMAINING", () => {
    /**
     * "THRU 5" is a numerator with no denominator. Against 18 holes a reader
     * supplies the other half from memory; against a slate they would have to
     * count the pills to learn whether 5 is early or nearly done.
     */
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={five} holeCount={16} dialect="slate" />
    );
    expect(html).toContain("LEFT");
    expect(html).not.toContain("THRU");
    expect(html).toContain(">11<");
    expect(html).not.toContain(">5<");
  });

  it("leaves GOLF on THRU and the holes PLAYED", () => {
    /**
     * THE MUTATION: apply the slate dialect unconditionally. Every assertion
     * above still passes and every golf card silently starts counting down.
     */
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={five} holeCount={18} />
    );
    expect(html).toContain("THRU");
    expect(html).not.toContain("LEFT");
    expect(html).toContain(">5<");
  });
});

describe("close-out notation is golf's sentence, and a slate does not speak it", () => {
  /**
   * Five up with four units unplayed — `matchState` closes it out, which is
   * where golf prints "5&4".
   *
   * THE UNIT COUNT IS 9 IN EVERY TEST BELOW, deliberately: the only difference
   * between them is `dialect`. A first version used 16 for the slate case,
   * which is NOT closed at all (five up against eleven of remaining swing) — so
   * it asserted close-out notation on a LIVE match, which prints "5 UP" anyway
   * and passed for a reason that had nothing to do with the claim. Caught by
   * the FINAL assertion below failing, which is the only one that could tell.
   */
  const closed = [W(1), W(2), W(3), W(4), W(5)];

  it("prints the LEAD ALONE on a slate — never X&Y", () => {
    /**
     * "4&3" means four up with three to play, and it encodes WHY the match
     * ended early: holes remained and could not change the result. Every
     * pick'em game resolves, so there is no early close-out to describe and
     * "5&11" reads as a score line while being nothing of the kind.
     */
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={closed} holeCount={9} dialect="slate" />
    );
    expect(html).toContain("5 UP");
    expect(html).not.toContain("&amp;");
    expect(html).not.toMatch(/\d&\d/);
  });

  it("KEEPS it for golf, where it is the format's own sentence", () => {
    /**
     * The half that stops this being read as a bug fix. A build that dropped
     * the notation everywhere passes the test above and silently removes
     * information golf has always shown.
     */
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={closed} holeCount={9} />
    );
    expect(html).toMatch(/5&amp;4|5&4/);
  });

  it("does not change WHETHER a slate match closes — only how it is worded", () => {
    // The close-out logic is untouched: a pick'em match really can be decided
    // with games left, and the card must still say FINAL when it is.
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={closed} holeCount={9} dialect="slate" />
    );
    expect(html).toContain("FINAL");
  });
});

describe("a note under a name never moves the name", () => {
  it("keeps the note OUT of the flow, so both sides centre identically", () => {
    /**
     * THE MUTATION, and it is what shipped: render the note as a second flow
     * child of a `flex-col justify-center` cell. That centres the name-and-note
     * STACK, so the side carrying a note sits its name higher than its
     * opponent's — a wobble on exactly the rows the note exists for.
     *
     * Static markup has no layout, so this asserts the MECHANISM that
     * guarantees the alignment: the note is absolutely positioned. The pixel
     * claim was verified in a browser (deltaY 0 between the two name centres on
     * every card, with and without a note); this is what keeps it true.
     */
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={[]} holeCount={16} aNote={<i>x</i>} />
    );
    expect(tag(html, "match-name-note")).toContain("absolute");
  });

  it("renders no note slot at all when there is nothing to say", () => {
    const html = renderToStaticMarkup(<MatchCard a={a} b={b} results={[]} holeCount={16} />);
    expect(html).not.toContain("match-name-note");
  });
});

describe("the picks sheet draws a CANCELLED game the way the results panel does", () => {
  const game = {
    id: "s1",
    awayTeam: "Milwaukee Brewers",
    homeTeam: "Cincinnati Reds",
    spread: "-3.5",
    multiplier: 1,
    kickoff: "Fri Sep 4, 6:10p",
    note: null,
  };

  const render = (over: Partial<Parameters<typeof PickemSheetRow>[0]> = {}) =>
    renderToStaticMarkup(
      <PickemSheetRow
        game={game}
        pick="home"
        points={14}
        outcome="void"
        editable={false}
        onPick={() => {}}
        {...over}
      />
    );

  it("strikes BOTH team names — asserted on the style, not the text", () => {
    /**
     * The distinction lives entirely in `textDecoration`: a cancelled row and a
     * played one carry the same names, the same chip and the same values. So
     * the assertion has to be on the PAINT, the same class as the results
     * panel's own guard.
     *
     * THE MUTATION: leave the sheet reading only `outcome`. `pickOutcome` folds
     * push and cancelled into one `void`, so the row dims and nothing else —
     * which is what shipped, and which every value assertion tolerates.
     */
    const html = render({ result: "cancelled" });
    expect(tag(html, "pickem-matchup-away-name")).toContain("text-decoration:line-through");
    expect(tag(html, "pickem-matchup-home-name")).toContain("text-decoration:line-through");
  });

  it("names it in the status position, in the cancelled tone", () => {
    const html = render({ result: "cancelled" });
    expect(tag(html, "pickem-matchup-status")).toContain("--color-bt-danger");
    expect(html).toContain("Cancelled");
    // The kickoff is REPLACED, not joined — a settled game's date is spent.
    expect(html).not.toContain("6:10p");
  });

  it("leaves a PUSH alone — struck names would claim the game was removed", () => {
    /**
     * The pair, and the reason only cancellation overrides the pick's accent: a
     * push HAPPENED and nobody covered, so the pick still stood and the chip's
     * dim carries the outcome. A build that struck every `void` outcome passes
     * both tests above.
     */
    const html = render({ result: "push" });
    expect(tag(html, "pickem-matchup-away-name")).not.toContain("line-through");
    expect(tag(html, "pickem-matchup-home-name")).not.toContain("line-through");
    expect(html).not.toContain("pickem-matchup-status");
    // ...and the kickoff survives, because nothing replaced it.
    expect(html).toContain("6:10p");
  });

  it("keeps the picked side's accent on every OTHER settled outcome", () => {
    // Cancellation is the one case where a fact about the GAME outranks a fact
    // about the SHEET. A won row still shows what you took.
    const html = render({ result: "home", outcome: "won" });
    expect(tag(html, "pickem-matchup-home")).toContain("--color-bt-accent)");
  });
});
