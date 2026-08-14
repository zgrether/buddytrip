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
