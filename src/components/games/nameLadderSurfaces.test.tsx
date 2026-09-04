import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard } from "./MatchCard";
import { MatchEntryView, type MatchGroupData } from "./MatchEntryView";
import { OutcomeScorecard } from "./OutcomeScorecard";
import { NAME_W_MAX } from "./StandardGrid";
import { STEP_2_SIZE } from "@/lib/nameLadder";
import type { ScoreUnit } from "./types";

/**
 * ONE LADDER, THREE SURFACES — asserted where it can actually go wrong.
 *
 * The bug this guards was one defect at three depths, and the likely HALF-FIX
 * is obvious: the match card is the surface that got reported, so a build that
 * fixes the card and leaves score entry and the scorecard alone would look
 * complete to whoever filed it. Each test below therefore renders a surface the
 * report did NOT name.
 *
 * WHAT IS NOT ASSERTABLE: `renderToStaticMarkup` has no layout engine, so
 * nothing here can claim a name "fits in 130px". These assert the RENDERED
 * STRINGS and the chosen rung (`data-name-step`), both of which are
 * deterministic. Calibration is a question for a person on a 375px phone.
 */

const LONG_A = "Julie Ann Hackett"; // 17 — full name, one step down
const LONG_B = "Jason Schumacher"; // 16 — full name, one step down
const SHORT_A = "Brad Giesler"; // 12 — untouched
const SHORT_B = "Bud Banks"; // 9 — untouched

const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
}));

describe("the long 2v2 pairing renders both names IN FULL", () => {
  /**
   * The card is the surface that was reported, so this is the easy half.
   */
  it("match card", () => {
    const html = renderToStaticMarkup(
      <MatchCard
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: SHORT_A },
          { id: "p2", name: LONG_A },
        ]}
        bPlayers={[
          { id: "p3", name: SHORT_B },
          { id: "p4", name: LONG_B },
        ]}
        results={[]}
      />
    );
    for (const n of [SHORT_A, LONG_A, SHORT_B, LONG_B]) expect(html).toContain(n);
    // No ellipsis character should be needed — the ladder is the fit mechanism.
    expect(html).not.toContain("…");
    // PER NAME: the short ones stay at step 1, the long ones step down. A build
    // that shrank the whole card would put every name on the same rung.
    expect(html).toContain('data-name-step="1"');
    expect(html).toContain('data-name-step="2"');
  });

  /**
   * THE HALF-FIX DETECTOR. Score entry is the surface a card-only build would
   * leave behind, and it is where a wrapped name pushes the score subtitle into
   * the bottom edge. If this passes while the card test fails, the ladder was
   * applied per surface instead of shared.
   */
  it("score entry — the surface a card-only fix would miss", () => {
    const matches: MatchGroupData[] = [
      {
        matchId: "m1",
        label: "Match 1",
        a: { id: "p2", name: LONG_A, color: "#22c55e" },
        b: { id: "p4", name: LONG_B, color: "#f97316" },
        strokesA: 0,
        strokesB: 0,
      },
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
    expect(html).toContain(LONG_A);
    expect(html).toContain(LONG_B);

    /**
     * THE ASSERTION THAT ACTUALLY DETECTS THE HALF-FIX, and the first version
     * of it did not.
     *
     * `toContain('data-name-step')` passes against a build that renders the
     * attribute with a hardcoded step 1 — verified by mutation: replacing
     * `fitName(...)` here with `{ text: player.name, fontSize: 17, step: 1 }`
     * left all five cases green. Both names are 16–17 characters, and step 2
     * keeps the FULL text, so "renders in full" is true in the broken build too.
     *
     * The rung is the discriminator. A 17-character name must resolve to step 2
     * at this surface's base size of 17, which a card-only build cannot produce.
     */
    // ROW-SPECIFIC, and that distinction is load-bearing: MatchEntryView
    // renders a MatchCard INSIDE itself, so a bare `data-name-step="2"` is
    // satisfied by the card even when the rows below it were never touched.
    // Verified by mutation — the first two versions of this assertion both
    // passed against a build with the ladder stripped out of the row. The row's
    // span is the one carrying `class="block truncate"`.
    expect(html).toContain(
      `<span class="block truncate" data-name-step="2" style="font-size:${STEP_2_SIZE}px`
    );
  });

  it("scorecard", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard
        units={units}
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: SHORT_A },
          { id: "p2", name: LONG_A },
        ]}
        bPlayers={[
          { id: "p3", name: SHORT_B },
          { id: "p4", name: LONG_B },
        ]}
        outcomes={[]}
      />
    );
    for (const n of [SHORT_A, LONG_A, SHORT_B, LONG_B]) expect(html).toContain(n);
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
          { id: "p2", name: "Wilhelmina Featherstonehaugh" },
        ]}
        bPlayers={[{ id: "p3", name: SHORT_B }]}
        outcomes={[]}
      />
    );

    // The column is responsive: a clamp, capped at NAME_W_MAX.
    expect(html).toContain(`${NAME_W_MAX}px`);
    expect(html).toMatch(/clamp\(\s*\d+px\s*,\s*25vw\s*,\s*124px\s*\)/);

    // And it is NOT the old flat width. `width:124px` with no clamp around it
    // is the pre-fix rendering, and is what a font-only build would still emit.
    expect(html).not.toMatch(/width:\s*124px/);
  });

  /**
   * A long pairing must be abbreviated by the ladder inside that narrower
   * column, rather than left to truncate.
   *
   * NOTE THE FIXTURE: `aPlayers` needs TWO entries. A single-entry list is not
   * "stacked" — the row falls through to the side's own `name` and the player
   * names are never rendered at all, so a one-player fixture asserts nothing
   * about the ladder. The first version of this test did exactly that and
   * failed for a reason that had nothing to do with the code under test.
   */
  it("abbreviates a name too long for the column", () => {
    const html = renderToStaticMarkup(
      <OutcomeScorecard
        units={units}
        a={{ id: "pgA", name: "A side", color: "#22c55e" }}
        b={{ id: "pgB", name: "B side", color: "#f97316" }}
        aPlayers={[
          { id: "p1", name: "Bartholomew Fotheringay" },
          { id: "p2", name: SHORT_A },
        ]}
        bPlayers={[
          { id: "p3", name: SHORT_B },
          { id: "p4", name: LONG_B },
        ]}
        outcomes={[]}
      />
    );
    expect(html).toContain("B. Fotheringay");
    expect(html).not.toContain("Bartholomew Fotheringay");
    // ...while the short name beside it is untouched, which is what makes this
    // per-NAME rather than per-card.
    expect(html).toContain(SHORT_A);
    expect(html).toContain(SHORT_B);
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
          { id: "p2", name: LONG_A },
        ]}
        bPlayers={[
          { id: "p3", name: SHORT_B },
          { id: "p4", name: LONG_B },
        ]}
        results={[]}
      />
    );

  /**
   * COUNTED, not `toContain`. The margin chips are the one thing that must be
   * identical on both edges — a 56px chip beside a 48px one looks broken in a
   * way nobody can name — and `toContain` would pass with one chip responsive
   * and the other left fixed, which is exactly the asymmetry being guarded.
   *
   * Two chips, therefore exactly two occurrences of one shared value.
   */
  it("renders the SAME chip width on both edges", () => {
    const html = card();
    const chips = html.match(/clamp\(46px, 13vw, 56px\)/g) ?? [];
    expect(chips).toHaveLength(2);
  });

  /**
   * The fixed values this replaced. 198px of furniture on a 375px phone left
   * 88px per name, at which "Matt Facchine" (89px at 14px) truncated — the
   * names were never the problem.
   */
  it("has no fixed pixel widths left in the row", () => {
    const html = card();
    expect(html).not.toMatch(/width:\s*56px/);
    expect(html).not.toMatch(/width:\s*40px/);
    expect(html).not.toMatch(/padding:\s*8px 10px/);
    expect(html).not.toMatch(/padding:\s*0 10px/);
  });

  /** The ceilings keep today's geometry on wider phones — this change is aimed
   *  at narrow ones and must not move the device it was reported on. */
  it("keeps the old values as the ceiling", () => {
    const html = card();
    expect(html).toContain("clamp(46px, 13vw, 56px)"); // was a flat 56
    expect(html).toContain("clamp(30px, 9vw, 40px)"); // was a flat 40
    expect(html).toContain("clamp(6px, 2.4vw, 10px)"); // was a flat 10
  });
});
