import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid } from "./StandardGrid";
import { matchDefeatText } from "./MatchResultBanner";
import type { ScoreUnit, Participant } from "./types";

/**
 * PARITY ITEM 2 — the stroke scorecard says who won.
 *
 * `OutcomeScorecard` has carried a result caption since it was built. The stroke
 * card — which shows the very strokes the result is computed FROM — said
 * nothing. This pins the parity and, more importantly, pins that the six callers
 * WITHOUT a match cannot acquire one.
 */

const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
}));
const participants: Participant[] = [
  { id: "pgA", name: "Bud Banks", color: "#22c55e" },
  { id: "pgB", name: "Rob Drupp", color: "#f97316" },
];

describe("the stroke scorecard's result line", () => {
  it("renders the sentence when the caller supplies one", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={units} participants={participants} values={{}} resultLine="Bud Banks def. Rob Drupp — 3&2" />
    );
    expect(html).toContain("scorecard-result-line");
    expect(html).toContain("Bud Banks def. Rob Drupp — 3&amp;2");
  });

  /**
   * OPT-IN BY CONSTRUCTION, and this is the assertion that matters. `StandardGrid`
   * has SEVEN callers — stroke, rack, quick game, two preview sheets — and none of
   * them has a match. A build that derived match state inside the grid, or
   * defaulted the caption on, would put a match result on a rack card.
   *
   * Omitting the prop IS the mechanism, so omitting it is what is asserted.
   */
  it("renders NOTHING for a caller that has no match", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={units} participants={participants} values={{}} />
    );
    expect(html).not.toContain("scorecard-result-line");
    expect(html).not.toContain("def.");
  });

  it("stays silent while the match is still live (null, not empty string)", () => {
    const html = renderToStaticMarkup(
      <StandardGrid units={units} participants={participants} values={{}} resultLine={null} />
    );
    expect(html).not.toContain("scorecard-result-line");
  });
});

describe("matchDefeatText — one sentence, four surfaces, two separators", () => {
  const w = { name: "Bud Banks" };
  const l = { name: "Rob Drupp" };

  it("names the winner, the loser and the margin", () => {
    expect(matchDefeatText(w, l, "3&2")).toBe("Bud Banks def. Rob Drupp · 3&2");
  });

  /**
   * A halved match names NEITHER side. A build that reached for a default would
   * print "X def. Y" on a drawn match — a wrong statement rather than a missing
   * one, which is the worse failure.
   */
  it("says 'Match halved' when there is no winner", () => {
    expect(matchDefeatText(null, null, "AS")).toBe("Match halved · AS");
    expect(matchDefeatText(w, null, "AS")).toBe("Match halved · AS");
  });

  /**
   * THE SEPARATOR IS PER SURFACE, not per copy. The two entry views render this
   * inside the green band with a middle dot; the two scorecards render it as a
   * caption with an EM DASH, which predates the extraction and is deliberate.
   *
   * Pinning BOTH directions is what stops a later tidy-up collapsing them — the
   * default must stay the dot, and the argument must actually be honoured.
   */
  it("defaults to the band's middle dot and honours the caption's em dash", () => {
    expect(matchDefeatText(w, l, "3&2")).toContain(" · ");
    expect(matchDefeatText(w, l, "3&2", "—")).toContain(" — ");
    expect(matchDefeatText(w, l, "3&2", "—")).not.toContain(" · ");
    expect(matchDefeatText(null, null, "AS", "—")).toBe("Match halved — AS");
  });
});
