import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid } from "./StandardGrid";
import { OutcomeScorecard } from "./OutcomeScorecard";
import type { ScoreUnit, Participant } from "./types";
import { STABLEFORD_PRESETS, type StablefordRubric } from "@/lib/stableford";

const units: ScoreUnit[] = Array.from({ length: 4 }, (_, i) => ({
  label: String(i + 1),
  section: i < 2 ? "front" : "back",
  par: 4,
}));
const a: Participant = { id: "pA", name: "Brad", color: "#4ade80" };
const b: Participant = { id: "pB", name: "Johnny", color: "#fb923c" };

/** Every `position:sticky` cell's inline style — the sticky column is the one
 *  thing on this grid that scrolling content passes underneath. */
const stickyStyles = (html: string) =>
  [...html.matchAll(/style="([^"]*position:sticky[^"]*)"/g)].map((m) => m[1]);

describe("item 5 — the sticky name column is opaque", () => {
  /**
   * THE COLUMN SITS AT `left: 0` WITH THE GRID SCROLLING BENEATH IT. A
   * transparent cell lets the hole numbers pass behind the names and stay
   * readable through them — which is what a phone showed.
   *
   * Asserted per SURFACE and per CELL, not once: the regression reached exactly
   * one of the two cards (the outcome card's lead rows, whose label cell passed
   * no background and so overwrote the shared one with `undefined`). A test that
   * rendered only the stroke card would have passed throughout.
   */
  it("every sticky cell on the STROKE card declares a background", () => {
    const html = renderToStaticMarkup(<StandardGrid units={units} participants={[a, b]} values={{}} />);
    const styles = stickyStyles(html);
    expect(styles.length).toBeGreaterThan(0); // the anchor must match something
    for (const s of styles) expect(s, `bare sticky cell: ${s.slice(0, 90)}`).toMatch(/background:[^;"]+/);
  });

  it("every sticky cell on the OUTCOME card declares a background", () => {
    const html = renderToStaticMarkup(<OutcomeScorecard units={units} a={a} b={b} outcomes={[]} />);
    const styles = stickyStyles(html);
    expect(styles.length).toBeGreaterThan(0);
    for (const s of styles) expect(s, `bare sticky cell: ${s.slice(0, 90)}`).toMatch(/background:[^;"]+/);
  });

  /**
   * AND IT IS A TOKEN, which is what carries it across both themes. A literal
   * colour would be opaque in one theme and wrong in the other; the spec asked
   * for both, and a token is the only form that can answer for both from a
   * server render with no theme attached.
   */
  it("the label cell's background is a theme token, not a literal", () => {
    const html = renderToStaticMarkup(<OutcomeScorecard units={units} a={a} b={b} outcomes={[]} />);
    const labelCells = stickyStyles(html).filter((s) => s.includes("flex-shrink:0"));
    expect(labelCells.length).toBeGreaterThan(0);
    for (const s of labelCells) expect(s).toMatch(/background:var\(--color-bt-[a-z-]+\)/);
  });
});

describe("item 6 — the legend's Eagle reads 2", () => {
  // The APP's own rubric, not a hand-rolled shape — the first version invented
  // `{ eagle, birdie, par… }`, which is not what a `StablefordRubric` is
  // (`ceiling`/`floor`/`points`) and would have exercised a config the app never
  // produces. BBMI's is the one actually in use this weekend.
  const rubric: StablefordRubric = STABLEFORD_PRESETS.bbmi_2024.rubric;

  /**
   * ASSERTED ON BOTH SURFACES SEPARATELY, per the spec — though the finding is
   * that they are the SAME component: `Legend` has one definition and one call
   * site, and "Stableford" is this grid with a `rubric` prop. So one fix serves
   * both, and these two cases prove that rather than assume it.
   */
  it("reads 2 on the stroke scorecard", () => {
    const html = renderToStaticMarkup(<StandardGrid units={units} participants={[a]} values={{}} />);
    expect(html).toMatch(/>2<[\s\S]{0,120}?Eagle/);
    expect(html).not.toMatch(/>3<[\s\S]{0,120}?Eagle/);
  });

  it("reads 2 on the Stableford scorecard", () => {
    const html = renderToStaticMarkup(<StandardGrid units={units} participants={[a]} values={{}} rubric={rubric} />);
    expect(html).toMatch(/>2<[\s\S]{0,120}?Eagle/);
    expect(html).not.toMatch(/>3<[\s\S]{0,120}?Eagle/);
  });

  /** Eagle and Birdie must not both read 3 — the actual defect, which was two
   *  chips carrying the same digit under different labels. */
  it("gives Eagle and Birdie different numbers", () => {
    const html = renderToStaticMarkup(<StandardGrid units={units} participants={[a]} values={{}} />);
    const eagle = html.match(/>(\d)<[\s\S]{0,120}?Eagle/)?.[1];
    const birdie = html.match(/>(\d)<[\s\S]{0,120}?Birdie/)?.[1];
    expect(eagle).toBe("2");
    expect(birdie).toBe("3");
    expect(eagle).not.toBe(birdie);
  });
});
