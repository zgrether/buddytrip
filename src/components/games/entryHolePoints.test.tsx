import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreEntryView } from "./ScoreEntryView";
import { STABLEFORD_PRESETS, stablefordPoints } from "@/lib/stableford";
import type { ScoreUnit, Participant } from "./types";

/**
 * WHAT THIS HOLE WAS WORTH — the per-hole points on the entry row.
 *
 * The row already showed a running total and a bucket name. Neither says what
 * the hole PAID, and under a rubric those come apart: a triple and a quintuple
 * read differently and score the same, because the floor stops the bleeding.
 *
 * ── The failure this file exists to catch ───────────────────────────────────
 *
 * Scoring the hole off the GROSS value instead of the NET one. It is the
 * obvious mistake — the keypad shows gross, the row's first word names gross —
 * and on an unstroked hole the two are identical, so a fixture without a
 * handicap stroke cannot tell the builds apart. Every points assertion below
 * that matters is on a STROKED hole where they disagree.
 *
 * Expected values are computed with `stablefordPoints` against the same rubric
 * the component is given, not typed as literals: the claim is "the row shows
 * what this rubric pays for that net score", and a literal would have to be
 * re-typed whenever a preset moved and would pass against the wrong rubric.
 */

const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;
const PAR = 4;
const UNITS: ScoreUnit[] = [{ label: "1", par: PAR }, { label: "2", par: PAR }];
const PEOPLE: Participant[] = [
  { id: "stroked", name: "Stroked Sam", color: "#e11d48", avatarIcon: null },
  { id: "plain", name: "Plain Pat", color: "#22c55e", avatarIcon: null },
];

function entry(opts: {
  values: Record<string, Record<string, number>>;
  pips?: Record<string, Set<string>>;
  rubric?: typeof BBMI | null;
}) {
  return renderToStaticMarkup(
    <ScoreEntryView
      gameName="Stableford"
      units={UNITS}
      participants={PEOPLE}
      values={opts.values}
      pips={opts.pips}
      rubric={opts.rubric === undefined ? BBMI : opts.rubric}
      currentHole={1}
      onChange={() => {}}
    />
  );
}

describe("the hole's points on the entry row", () => {
  it("scores the hole off NET, not the gross the keypad shows", () => {
    /**
     * THE CASE THAT SEPARATES THE TWO BUILDS. Sam is stroked on hole 1 and
     * shoots 5 on a par 4: gross +1 (a bogey), net level (a par). A build
     * reading gross pays the bogey's points; the correct one pays the par's.
     *
     * Pat takes the SAME 5 unstroked, so the two rows differ in exactly one
     * thing — the stroke — and any difference in their points is attributable
     * to it alone.
     *
     * The rubric decides both figures and they must differ, or this test
     * asserts nothing; that is checked first. Both are deliberately above 1 so
     * the singular/plural rule (its own test below) cannot quietly become the
     * thing that makes this pass or fail.
     */
    const grossPts = stablefordPoints(1, BBMI); // bogey
    const netPts = stablefordPoints(0, BBMI); // par
    expect(netPts, "fixture is useless unless the two disagree").not.toBe(grossPts);
    expect(Math.min(grossPts, netPts), "keep this case off the 1 pt / 1 pts edge").toBeGreaterThan(1);

    const html = entry({
      values: { stroked: { "1": 5 }, plain: { "1": 5 } },
      pips: { stroked: new Set(["1"]) },
    });

    // The stroked row prints both words and the NET points after them.
    expect(html).toContain(`Bogey · net Par · ${netPts} pts`);
    // The unstroked player took the same 5 and is paid the bogey's points —
    // same hole, same gross, different net, different points.
    expect(html).toContain(`Bogey · ${grossPts} pts`);
  });

  it("shows the points beside the word for an ordinary hole", () => {
    const html = entry({ values: { plain: { "1": 5 } } });
    expect(html).toContain(`Bogey · ${stablefordPoints(1, BBMI)} pts`);
  });

  it("says 'pt' for exactly one", () => {
    // A rubric hands out a single point often enough that "1 pts" would be seen
    // constantly. Finding the score that pays 1 from the rubric rather than
    // assuming which one it is.
    const one = [1, 2, 3, 4, 5].find((d) => stablefordPoints(d, BBMI) === 1);
    expect(one, "this rubric never pays exactly 1 — pick another").toBeDefined();
    const html = entry({ values: { plain: { "1": PAR + (one as number) } } });
    expect(html).toContain(" · 1 pt");
    expect(html).not.toContain(" · 1 pts");
  });

  it("A BLOW-UP STILL REPORTS ITS POINTS, where golf has no name for the hole", () => {
    /**
     * `golfWord` returns null past ±3 on purpose ("inventing one is worse than
     * saying nothing"), and the row used to render NOTHING at all there — no
     * word, no value. That is the hole where "what was that worth?" matters
     * most, because a rubric's whole premise is that a blow-up stops costing.
     *
     * The signed differential stands in for the missing name, which is the
     * fallback `bucketLabel` already uses elsewhere.
     */
    const html = entry({ values: { plain: { "1": PAR + 5 } } });
    expect(html).toContain(`+5 · ${stablefordPoints(5, BBMI)} pts`);
  });

  it("a TRADITIONAL game is untouched — no points anywhere on the row", () => {
    const html = entry({ values: { plain: { "1": 5 } }, rubric: null });
    expect(html).toContain("Bogey");
    expect(html).not.toContain("pts ·");
    expect(html).not.toContain("· 1 pt");
    // The running total keeps its own Traditional word rather than "pts".
    expect(html).toContain("total");
  });
});
