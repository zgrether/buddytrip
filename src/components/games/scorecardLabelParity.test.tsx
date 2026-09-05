import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardGrid } from "./StandardGrid";
import { OutcomeScorecard } from "./OutcomeScorecard";
import type { ScoreUnit, Participant } from "./types";

/**
 * PARITY ITEM 3 — one row label, both scorecards.
 *
 * `OutcomeScorecard` rendered its own name cell (15px, weight 700, no dots, its
 * own stacked/single branch) while `StandardGrid` had the dot treatment. Same
 * names, two surfaces, two answers — the shape of every finding in this pass.
 */

const units: ScoreUnit[] = Array.from({ length: 3 }, (_, i) => ({ label: String(i + 1), par: 4 }));
const a: Participant = { id: "pgA", name: "JD Shumpert", color: "#3b82f6" };
const b: Participant = { id: "pgB", name: "Tyler Larson", color: "#ef4444" };
const aPlayers = [
  { id: "p1", name: "JD Shumpert", teamColor: "#3b82f6" },
  { id: "p2", name: "Matt Facchine", teamColor: "#3b82f6" },
];

/** Every laddered label in a document, with its dot colour — the label cell's
 *  whole observable output. */
function labels(html: string) {
  return [...html.matchAll(/background:(#[0-9a-f]{6})[^>]*><\/span><span class="truncate" data-name-step="(\d)" style="font-size:11px;font-weight:600;[^>]*>([^<]*)</g)]
    .map((m) => ({ dot: m[1], step: m[2], text: m[3] }));
}

describe("both scorecards render the SAME row label", () => {
  it("the outcome card's labels are byte-identical to the stroke card's", () => {
    const strokeHtml = renderToStaticMarkup(
      <StandardGrid units={units} values={{}} participants={[{ ...a, players: aPlayers }]} />
    );
    const outcomeHtml = renderToStaticMarkup(
      <OutcomeScorecard units={units} a={a} b={b} aPlayers={aPlayers} outcomes={[]} leftColor="#3b82f6" />
    );

    const stroke = labels(strokeHtml);
    const outcome = labels(outcomeHtml);

    // The anchor has to be able to match at all — a regex that finds nothing
    // would make the comparison below vacuously true.
    expect(stroke.length).toBe(2);

    // Side A's two players, same dots, same rungs, same text, on both cards.
    expect(outcome.slice(0, 2)).toEqual(stroke);
  });

  /**
   * THE OUTCOME CARD SPECIFICALLY — asserted apart from the comparison above,
   * because a build that broke BOTH cards the same way would satisfy an
   * equality test while rendering nothing recognisable.
   */
  it("the outcome card carries a dot per player at 11px, not its old 15px/700 name", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard units={units} a={a} b={b} aPlayers={aPlayers} outcomes={[]} leftColor="#3b82f6" />
    );
    expect(html).toMatch(/data-name-step="[12]" style="font-size:11px;font-weight:600/);
    expect(html).not.toContain("font-weight:700;color:var(--color-bt-text);line-height:1.35");
    expect([...html.matchAll(/border-radius:50%;background:#3b82f6/g)]).toHaveLength(2);
  });

  /** A 1v1 side has no `players` and renders through the identical path. */
  it("a 1v1 side is a list of one, same treatment", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard units={units} a={a} b={b} outcomes={[]} leftColor="#3b82f6" rightColor="#ef4444" />
    );
    // Both abbreviate: this column.s capacity (5.35em) is far tighter than score
    // entry.s, and "JD Shumpert" is 5.85em. The ladder firing here is correct.
    expect(html).toContain(">J. Shumpert<");
    expect(html).toContain(">T. Larson<");
    expect([...html.matchAll(/border-radius:50%;background:#3b82f6/g)]).toHaveLength(1);
    expect([...html.matchAll(/border-radius:50%;background:#ef4444/g)]).toHaveLength(1);
  });
});
