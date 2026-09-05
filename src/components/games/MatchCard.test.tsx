import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard } from "./MatchCard";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { DecidedHole } from "@/lib/matchPlay";

/**
 * Glorious Finishing Holes on the match card's segment history (#1296-ish —
 * the card was reading `glorious` for THRU/DORMIE/margin math already but
 * never marking the segments themselves). See MatchCard.tsx's history loop.
 *
 * `renderToStaticMarkup` has no layout engine — these assert the rendered
 * STRING (which segments carry the marker's testid/tokens), not that
 * anything "looks amber". Quote-terminated matches throughout: hole 1's
 * testid (`match-history-glorious-1"`) is a literal PREFIX of holes
 * 10–18's, so an unterminated `toContain` would false-positive exactly the
 * way StandardGrid's own glorious tests guard against.
 */

const a = { id: "pgA", name: "A side", color: "#22c55e" };
const b = { id: "pgB", name: "B side", color: "#f97316" };
const g = (n: number): GloriousConfig => ({ enabled: true, n });

// No holes decided — every segment renders as "no result yet". Used to
// isolate the marker from the win/loss/half outcome colour entirely.
const noResults: DecidedHole[] = [];

describe("MatchCard — Glorious Finishing Holes segment marker (gate a: marks the right holes)", () => {
  it("off: no segment carries the marker", () => {
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={NO_GLORIOUS} holeCount={18} />
    );
    expect(html).not.toContain("match-history-glorious-");
    expect(html).not.toContain("var(--color-bt-glorious");
  });

  it("defaults to NO_GLORIOUS when the prop is omitted entirely", () => {
    const html = renderToStaticMarkup(<MatchCard a={a} b={b} results={noResults} holeCount={18} />);
    expect(html).not.toContain("match-history-glorious-");
  });

  it("N=4: marks exactly the last four segments (15–18), not a hardcoded four", () => {
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={g(4)} holeCount={18} />
    );
    for (const h of [15, 16, 17, 18]) expect(html).toContain(`match-history-glorious-${h}"`);
    // Quote-terminated: "…-1" is a prefix of "…-15/16/17/18", so this would
    // false-negative into a false pass without the trailing quote.
    for (const h of [1, 5, 10, 14]) expect(html).not.toContain(`match-history-glorious-${h}"`);
  });

  it("N=3: the marked span shifts to 16–18 — proves it isn't fixed at 4, the common value", () => {
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={g(3)} holeCount={18} />
    );
    for (const h of [16, 17, 18]) expect(html).toContain(`match-history-glorious-${h}"`);
    expect(html).not.toContain('match-history-glorious-15"');
    expect(html).not.toContain('match-history-glorious-14"');
  });
});

describe("MatchCard — Glorious Finishing Holes segment marker (gate b: unplayed holes still marked)", () => {
  it("a doubled segment with no result is visibly distinct from an undoubled segment with no result", () => {
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={g(4)} holeCount={18} />
    );
    // Hole 18 (glorious, unplayed) carries the marker + the scorecard's own
    // tokens for the wash and border.
    expect(html).toContain('match-history-glorious-18"');
    // Hole 1 (ordinary, unplayed) must not — a build that only marks PLAYED
    // holes (folding the marker into the outcome colour rather than
    // layering it under/around it) would pass gate a but fail here, since
    // gate a's fixture also renders every hole unplayed.
    expect(html).not.toContain('match-history-glorious-1"');
  });

  it("uses the scorecard's own tokens — no second amber invented", () => {
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={g(1)} holeCount={18} />
    );
    expect(html).toContain("var(--color-bt-glorious-faint)"); // per-cell wash, reused
    expect(html).toContain("var(--color-bt-glorious-border)"); // border, reused
    // The header diamond's 22% color-mix fill is a DIFFERENT marker for a
    // DIFFERENT surface (the scorecard header has no analogue on the card) —
    // must not leak onto the segment bar.
    expect(html).not.toContain("color-mix(in srgb, var(--color-bt-glorious) 22%");
  });
});

describe("MatchCard — Glorious Finishing Holes segment marker (gate c: sub-18 inertness)", () => {
  it("a 9-hole card marks nothing, matching gloriousHoles.ts's literal ROUND_HOLES=18", () => {
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={g(4)} holeCount={9} />
    );
    expect(html).not.toContain("match-history-glorious-");
  });
});

/**
 * The card drives a NON-GOLF format — the `weightOf` seam's visual half.
 *
 * `MatchCard` is now the only match card in the app: pick'em's head-to-head
 * renders it rather than a lookalike, so every change to this presentation
 * reaches both formats. These pin the two props that made that possible and
 * the states golf itself can never produce.
 */
describe("MatchCard — a per-unit weight selector, for formats with no trailing window", () => {
  it("marks the units the CALLER names, not a trailing window", () => {
    /**
     * THE MUTATION: keep calling `isGloriousHole` and ignore `isWeightedUnit`.
     *
     * That build marks a trailing window — or, on a 16-unit card, marks nothing
     * at all, because `holeWeight` measures against a hardcoded 18 and no unit
     * clears `18 − n`. Both are silent: the card renders, the maths is right,
     * and the one thing the wash exists to say is missing.
     *
     * Units 3 and 12 of 16 is a shape golf cannot express.
     */
    const html = renderToStaticMarkup(
      <MatchCard
        a={a}
        b={b}
        results={noResults}
        holeCount={16}
        isWeightedUnit={(u) => u === 3 || u === 12}
      />
    );
    expect(html).toContain('match-history-glorious-3"');
    expect(html).toContain('match-history-glorious-12"');
    expect(html).not.toContain('match-history-glorious-16"');
    // ...and it is the SAME amber, not a second one invented for the new caller.
    expect(html).toContain("var(--color-bt-glorious-faint)");
  });

  it("leaves golf's positional window alone when the prop is absent", () => {
    /**
     * The backward-compatibility half. A build that made the predicate
     * mandatory, or defaulted it to "never", would silently un-mark every golf
     * card — and every assertion above would still pass.
     */
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={noResults} glorious={g(3)} holeCount={18} />
    );
    expect(html).toContain('match-history-glorious-16"');
    expect(html).toContain('match-history-glorious-18"');
    expect(html).not.toContain('match-history-glorious-15"');
  });
});

describe("MatchCard — three shapes for a unit that moved nobody", () => {
  const decided: DecidedHole[] = [
    { hole: 1, result: "H" },
    { hole: 2, result: "H" },
    { hole: 3, result: "H" },
  ];

  const render = () =>
    renderToStaticMarkup(
      <MatchCard
        a={a}
        b={b}
        results={decided}
        holeCount={3}
        decidedStake={{ 2: "void", 3: "none" }}
      />
    );

  it("draws a contested halve, a void and a no-stake DIFFERENTLY", () => {
    /**
     * THE MUTATION, and it is the tempting one: render all three as the halve.
     * Every value is identical — all three are `result: "H"` and score zero —
     * so nothing but the paint separates them, and grey for all three claims a
     * contest that did not happen on two of them.
     *
     * Unit 1 is the genuine halve and must stay unmarked; the other two must
     * carry their own testids AND differ from each other.
     */
    const html = render();
    expect(html).not.toContain('match-history-void-1"');
    expect(html).not.toContain('match-history-nostake-1"');
    expect(html).toContain('match-history-void-2"');
    expect(html).toContain('match-history-nostake-3"');
  });

  it("gives the void an EDGE and the no-stake none — they must not match", () => {
    /**
     * The two absences say different things: a void had something here and its
     * stake was struck, so the outline is what is left of it; a no-stake never
     * had one. A build that used one treatment for both passes the test above.
     *
     * Asserted per-element rather than over the document, since both live in
     * the same bar and a document-wide search cannot tell them apart.
     */
    const html = render();
    const tag = (testId: string) => {
      const at = html.indexOf(`data-testid="${testId}"`);
      return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    };
    const voided = tag("match-history-void-2");
    const nostake = tag("match-history-nostake-3");

    expect(voided).toContain("border");
    expect(voided).toContain("background:transparent");
    expect(nostake).not.toContain("border:");
    expect(voided).not.toBe(nostake);
  });

  it("renders none of this for golf, which has no stakeless unit", () => {
    // Omitting the prop must leave the bar exactly as it was — a hole is always
    // played and always contested.
    const html = renderToStaticMarkup(
      <MatchCard a={a} b={b} results={decided} holeCount={3} />
    );
    expect(html).not.toContain("match-history-void-");
    expect(html).not.toContain("match-history-nostake-");
  });
});
