import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchEntryView, type MatchGroupData } from "./MatchEntryView";
import type { ScoreUnit } from "./types";

/**
 * PARITY ITEM 5 — score entry marks who won the hole.
 *
 * Outcome entry tells you: you tap a side and it lights up in the team colour.
 * Score entry derives the SAME fact from the strokes you just typed — `decided`
 * already holds it and the card's strip above already draws it — and said
 * nothing.
 *
 * The treatment is `OutcomeChoiceRow`'s, reused: `color-mix(in srgb, <tint> 14%,
 * transparent)`. Its `1.5px solid <tint>` ring is deliberately NOT reused — see
 * the note at the call site — so the tint goes in the row's existing 3px left
 * rule instead.
 */

const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
}));

const A_TINT = "#22c55e";
const B_TINT = "#f97316";

const match = (): MatchGroupData => ({
  matchId: "m1",
  label: "Match 1",
  a: { id: "pA", name: "Bud Banks", color: A_TINT },
  b: { id: "pB", name: "Rob Drupp", color: B_TINT },
  strokesA: 0,
  strokesB: 0,
  leftColor: A_TINT,
  rightColor: B_TINT,
});

const render = (values: Record<string, Record<string, number>>) =>
  renderToStaticMarkup(
    <MatchEntryView
      gameName="Stress"
      units={units}
      matches={[match()]}
      values={values}
      onChange={() => {}}
      currentHole={1}
    />
  );

const tinted = (html: string, tint: string) =>
  [...html.matchAll(new RegExp(`color-mix\\(in srgb, ${tint} 14%, transparent\\)`, "g"))].length;

describe("score entry marks the hole's winner", () => {
  it("tints the side that won the hole, and only that side", () => {
    // A takes hole 1 with a 4 to B's 5.
    const html = render({ pA: { "1": 4 }, pB: { "1": 5 } });
    expect(tinted(html, A_TINT)).toBe(1);
    expect(tinted(html, B_TINT)).toBe(0);
  });

  it("tints the other side when the other side wins", () => {
    const html = render({ pA: { "1": 6 }, pB: { "1": 4 } });
    expect(tinted(html, B_TINT)).toBe(1);
    expect(tinted(html, A_TINT)).toBe(0);
  });

  /**
   * THE STATE A NATURAL IMPLEMENTATION COLLAPSES. Score entry has no "Halved"
   * row to select, so the tempting build tints whoever is not losing, or tints
   * both. A halved hole is a REAL third state — it is what `H` means in
   * `decided` — and colouring it would invent agreement the format does not have.
   *
   * `empty is not unknown`, one surface further on: halved and not-yet-played
   * must both render untinted, and for different reasons.
   */
  it("tints NEITHER side on a halved hole", () => {
    const html = render({ pA: { "1": 4 }, pB: { "1": 4 } });
    expect(tinted(html, A_TINT)).toBe(0);
    expect(tinted(html, B_TINT)).toBe(0);
  });

  it("tints neither side before the hole is decided — one score is not a result", () => {
    const html = render({ pA: { "1": 4 } }); // B has not entered
    expect(tinted(html, A_TINT)).toBe(0);
    expect(tinted(html, B_TINT)).toBe(0);
  });

  /**
   * PER HOLE, not per match. The reference highlights the hole you are standing
   * on, so this must too: A wins hole 1, B wins hole 2, and on hole 2 it is B
   * who is tinted even though the match is level.
   */
  it("follows the hole on screen, not the overall leader", () => {
    const values = { pA: { "1": 4, "2": 6 }, pB: { "1": 5, "2": 4 } };
    const onHole2 = renderToStaticMarkup(
      <MatchEntryView
        gameName="Stress"
        units={units}
        matches={[match()]}
        values={values}
        onChange={() => {}}
        currentHole={2}
      />
    );
    expect(tinted(onHole2, B_TINT)).toBe(1);
    expect(tinted(onHole2, A_TINT)).toBe(0);
  });
});
