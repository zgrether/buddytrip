import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BracketBoard } from "./BracketBoard";
import { buildDraw } from "@/lib/bracket";
import { resolveDraw } from "@/lib/bracketAdvance";
import { roundLayout, BRACKET_METRICS } from "@/lib/bracketLayout";

/**
 * The board renders, and the computed geometry actually reaches the DOM.
 *
 * `bracketLayout.test.ts` proves the offsets are RIGHT; this proves they are
 * APPLIED. Both halves are needed — the previous layout's numbers were never
 * wrong, they simply weren't being used, because the round heading sat inside
 * the container doing the spacing.
 */

const entrants = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    seed: i + 1,
    name: `P${i + 1}`,
    partner: null,
    teamColor: "#ef4444",
  }));

const board = (n: number) =>
  renderToStaticMarkup(
    <BracketBoard matches={resolveDraw(buildDraw(n))} entrants={entrants(n)} />
  );

describe("BracketBoard geometry", () => {
  it("offsets round 2 by half a span, and rounds 3+ by their own", () => {
    const html = board(8);
    // Round 1 has no offset; rounds 2 and 3 do, and they differ.
    for (const round of [2, 3]) {
      const { offset, gap } = roundLayout(round, BRACKET_METRICS);
      expect(html).toContain(`padding-top:${offset}px`);
      expect(html).toContain(`gap:${gap}px`);
    }
    expect(roundLayout(2, BRACKET_METRICS).offset).not.toBe(roundLayout(3, BRACKET_METRICS).offset);
  });

  it("every card is the SAME fixed height — the precondition of the offsets", () => {
    // 5 entrants: an 8-seat draw with three byes, so byes, pending slots and
    // competitor rows all appear in one render. Before this, they sized
    // themselves and the rounds below drifted.
    const html = board(5);
    const heights = [...html.matchAll(/height:(\d+)px/g)].map((m) => Number(m[1]));
    expect(heights).toContain(BRACKET_METRICS.cardHeight);
    // No card renders at anything other than the shared height.
    const cardCount = (html.match(new RegExp(`height:${BRACKET_METRICS.cardHeight}px`, "g")) ?? []).length;
    expect(cardCount).toBe(resolveDraw(buildDraw(5)).length);
  });

  it("renders byes and pending slots without collapsing the tree", () => {
    const html = board(5);
    expect(html).toContain("bracket-slot-bye");
    expect(html).toContain("bracket-slot-pending");
  });

  it("renders nothing for a field too small to play", () => {
    expect(board(1)).toBe("");
  });
});

describe("stakes appear only where places are PAID", () => {
  const withStakes = (n: number, dist: number[]) =>
    renderToStaticMarkup(
      <BracketBoard matches={resolveDraw(buildDraw(n))} entrants={entrants(n)} pointsDistribution={dist} />
    );

  it("the final states both places it settles", () => {
    expect(withStakes(4, [10, 6, 3, 1])).toContain("1st: 10 · 2nd: 6");
  });

  it("no earlier round carries a figure — and none says 'at least' any more", () => {
    // The regression: a 16-draw showed "W ≥0 · L 0" on eight round-one matches,
    // and quarters claimed a figure their winner had just escaped.
    const html = withStakes(16, [20, 12, 8, 6, 4, 3, 2, 1]);
    expect(html).not.toContain("≥");
    expect(html).not.toContain("L 0");
    // Exactly ONE match carries stakes: the final.
    expect((html.match(/bracket-match-stakes/g) ?? []).length).toBe(1);
  });

  it("quotes nothing when the game pays no placement split", () => {
    expect(withStakes(4, [])).not.toContain("bracket-match-stakes");
  });
});

describe("a withdrawn entrant (ruling 8)", () => {
  /** The markup from one seat's own anchor to the next seat's: that seat's row
   *  and nothing else (a chip elsewhere on the board cannot satisfy it). */
  const seatRegion = (html: string, seed: number) => {
    const start = html.indexOf(`data-testid="bracket-slot-${seed}"`);
    if (start < 0) throw new Error(`no row for seed ${seed}`);
    const next = html.indexOf(`data-testid="bracket-slot-`, start + 1);
    return html.slice(start, next < 0 ? undefined : next);
  };

  it("marks the forfeiter's row 'Withdrew' — and only that row", () => {
    const html = renderToStaticMarkup(
      <BracketBoard matches={resolveDraw(buildDraw(4), {}, new Set([4]))} entrants={entrants(4)} />
    );
    expect(seatRegion(html, 4)).toContain('data-testid="bracket-withdrew"');
    expect(seatRegion(html, 1)).not.toContain("bracket-withdrew");
    expect(html.match(/data-testid="bracket-withdrew"/g)).toHaveLength(1);
  });

  it("CONTROL: nobody withdrawn, no chip anywhere", () => {
    expect(board(4)).not.toContain("bracket-withdrew");
  });
});
