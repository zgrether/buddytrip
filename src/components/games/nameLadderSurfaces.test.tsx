import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard } from "./MatchCard";
import { MatchEntryView, type MatchGroupData } from "./MatchEntryView";
import { OutcomeScorecard } from "./OutcomeScorecard";
import { NAME_W_MAX } from "./StandardGrid";
import type { ScoreUnit } from "./types";

/**
 * ONE LADDER, THREE SURFACES — asserted where it can actually go wrong.
 *
 * The likely HALF-FIX is obvious: the match card is the surface that gets
 * reported, so a build that fixes the card and leaves score entry and the
 * scorecard alone looks complete to whoever filed it. Each test below renders a
 * surface the report did NOT name.
 *
 * WHAT IS NOT ASSERTABLE: `renderToStaticMarkup` has no layout engine, so
 * nothing here can claim a name "fits". These assert the rendered STRING and
 * the chosen RUNG, both deterministic. Whether the capacity constants are
 * calibrated is a question for a phone.
 */

const LONG = "Julie Ann Hackett"; // 7.9em — abbreviates on the narrow surfaces
const SHORT_A = "Bud Banks"; // 4.7em — fits everywhere
const SHORT_B = "Rob Drupp"; // 5.0em — fits everywhere
const VERY_LONG = "Bartholomew Fotheringay"; // 11.8em — over even score entry's capacity

const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
}));

describe("a name too wide for its slot is ABBREVIATED, not truncated", () => {
  it("match card — short names untouched, long one shortened", () => {
    const html = renderToStaticMarkup(
      <MatchCard
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: SHORT_A },
          { id: "p2", name: LONG },
        ]}
        bPlayers={[{ id: "p3", name: SHORT_B }]}
        results={[]}
      />
    );
    expect(html).toContain(SHORT_A); // fits — left alone
    expect(html).toContain("J. Hackett"); // does not — abbreviated
    expect(html).not.toContain(LONG);
    expect(html).not.toContain("…"); // the ellipsis backstop must not be reached

    /**
     * PER NAME. A build that shrank or abbreviated the whole card would put
     * every name on one rung; the short name beside the long one stays at 1.
     */
    expect(html).toContain('data-name-step="1"');
    expect(html).toContain('data-name-step="2"');
  });

  /**
   * THE HALF-FIX DETECTOR, and it has been wrong TWICE — recorded so nobody
   * re-weakens it.
   *
   * `toContain("data-name-step")` passed against a hardcoded step. Then
   * `toContain('data-name-step="2"')` ALSO passed, because `MatchEntryView`
   * renders a `MatchCard` INSIDE itself and the card supplied the attribute
   * while the rows below were untouched — CLAUDE.md's substring corollary,
   * fifth instance: a substring assertion is scoped to the DOCUMENT, not to the
   * thing you are looking at.
   *
   * The anchor has to be something only the ROW emits. Its span carries
   * `class="block truncate"` AND score entry's own font clamp, whose floor
   * (15px) differs from the card's (13px) and the scorecard's (12px).
   */
  it("score entry — the surface a card-only fix would miss", () => {
    const matches: MatchGroupData[] = [
      // OVER entry's own capacity (11.8em vs 11), so the ROW must abbreviate.
      // A name that merely fits would render IDENTICALLY with the ladder ripped
      // out — which is how this detector passed a card-only mutant twice.
      { matchId: "m1", label: "Match 1", a: { id: "p2", name: VERY_LONG, color: "#22c55e" }, b: { id: "p3", name: SHORT_B, color: "#f97316" }, strokesA: 0, strokesB: 0 },
    ];
    const html = renderToStaticMarkup(
      <MatchEntryView
        gameName="Stress"
        units={units}
        matches={matches}
        values={{}}
        onChange={() => {}}
        currentHole={1}
      />
    );

    /**
     * ROW-SPECIFIC, TEXT AND ALL. The class, the rung, entry's own clamp floor
     * (15px, distinct from the card's 13px), and the abbreviated string — a
     * card-only build renders the full name here and fails on every one of
     * those at once.
     */
    expect(html).toMatch(
      /<span class="block truncate" data-name-step="2" style="font-size:clamp\(15px[^>]*>B\. Fotheringay/
    );

    /**
     * And capacity is per SURFACE: the short name beside it has room, so the
     * two rows come out on different rungs in one document.
     */
    expect(html).toContain(SHORT_B);
  });

  it("scorecard", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard
        units={units}
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: SHORT_A },
          { id: "p2", name: LONG },
        ]}
        bPlayers={[{ id: "p3", name: SHORT_B }]}
        outcomes={[]}
      />
    );
    expect(html).toContain(SHORT_A);
    expect(html).toContain("J. Hackett");
    expect(html).not.toContain(LONG);
  });
});

describe("sizes are keyed to the VIEWPORT, not to the name", () => {
  /**
   * The rule this replaced scaled text by NAME LENGTH, which put the largest
   * font in the narrowest cell: "Zach Grether" (12 chars) rendered 100px into
   * an 85px slot and truncated, while "Bill Giesler" — also 12 characters, also
   * 17px — measured 81px and fit.
   *
   * Every name on a surface must now render at the SAME size; only the screen
   * changes it. Exactly one distinct font-size in the markup is what proves it,
   * and a per-name build cannot satisfy that however its thresholds are tuned.
   */
  it("renders every name on the card at one size", () => {
    const html = renderToStaticMarkup(
      <MatchCard
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: SHORT_A },
          { id: "p2", name: LONG },
        ]}
        bPlayers={[
          { id: "p3", name: SHORT_B },
          { id: "p4", name: "Jason Schumacher" },
        ]}
        results={[]}
      />
    );
    const sizes = new Set(
      [...html.matchAll(/data-name-step="\d" style="font-size:([^;]+);/g)].map((m) => m[1])
    );
    expect(sizes.size).toBe(1);
    expect([...sizes][0]).toBe("clamp(13px, 3.7vw, 17px)");
  });
});

describe("the sticky name column is capped and can shrink", () => {
  /**
   * FAILS AGAINST A FONT-ONLY BUILD. Shrinking the text alone leaves the column
   * at its old fixed width, so the holes stay stolen — which is exactly what
   * "12 of 18 visible" was. This asserts the WIDTH, not the text.
   */
  it("never exceeds the cap, and is not a fixed width", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard
        units={units}
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: "Bartholomew Fotheringay" },
          { id: "p2", name: SHORT_A },
        ]}
        bPlayers={[{ id: "p3", name: SHORT_B }]}
        outcomes={[]}
      />
    );
    expect(html).toContain(`${NAME_W_MAX}px`);
    expect(html).toMatch(/clamp\(\s*\d+px\s*,\s*25vw\s*,\s*124px\s*\)/);
    expect(html).not.toMatch(/width:\s*124px/);
  });
});

describe("the match card's chrome is responsive and symmetric", () => {
  const card = () =>
    renderToStaticMarkup(
      <MatchCard
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: SHORT_A },
          { id: "p2", name: LONG },
        ]}
        bPlayers={[{ id: "p3", name: SHORT_B }]}
        results={[]}
      />
    );

  /**
   * COUNTED, not `toContain`. The chips are the one thing that must be
   * identical on both edges — a 56px chip beside a 48px one looks broken in a
   * way nobody can name — and `toContain` would pass with one responsive and
   * the other left fixed, which is precisely the asymmetry being guarded.
   */
  it("renders the SAME chip width on both edges", () => {
    const chips = card().match(/clamp\(46px, 13vw, 56px\)/g) ?? [];
    expect(chips).toHaveLength(2);
  });

  it("has no fixed pixel widths left in the row", () => {
    const html = card();
    expect(html).not.toMatch(/width:\s*56px/);
    expect(html).not.toMatch(/width:\s*40px/);
    expect(html).not.toMatch(/padding:\s*8px 10px/);
    expect(html).not.toMatch(/padding:\s*0 10px/);
  });

  it("keeps the old values as the ceiling", () => {
    const html = card();
    expect(html).toContain("clamp(46px, 13vw, 56px)"); // was a flat 56
    expect(html).toContain("clamp(30px, 9vw, 40px)"); // was a flat 40
    expect(html).toContain("clamp(6px, 2.4vw, 10px)"); // was a flat 10
  });
});
