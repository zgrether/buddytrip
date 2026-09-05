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

/** A real 2v2 from the trip roster — the pairing that produced "J. Larson". */
const DOUBLES: MatchGroupData[] = [
  {
    matchId: "m1",
    label: "Match 1",
    a: { id: "pgA", name: "JD Shumpert & Tyler Larson", color: "#22c55e" },
    b: { id: "pgB", name: "Matt Facchine & Fake Grether", color: "#f97316" },
    // teamColor is set on EVERY entry because `sidePlayersOf` cannot produce one
    // without it (`teamColorOf(u) ?? colorOf.get(u) ?? PLAYER_COLORS[0]`).
    // Omitting it renders the neutral fallback — a path the app never takes, and
    // a fixture that would miss the colour being dropped.
    aPlayers: [
      { id: "p1", name: "JD Shumpert", teamColor: "#22c55e" },
      { id: "p2", name: "Tyler Larson", teamColor: "#22c55e" },
    ],
    bPlayers: [
      { id: "p3", name: "Matt Facchine", teamColor: "#f97316" },
      { id: "p4", name: "Fake Grether", teamColor: "#f97316" },
    ],
    strokesA: 0,
    strokesB: 0,
  },
];

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

  /**
   * A SIDE IS NOT A PERSON, and abbreviating one invents somebody.
   *
   * Score entry's row is per SIDE (one input per side), and a 2v2 side's `name`
   * is the joined "R & B" label. Laddering THAT ran `initialSurname` over two
   * people: first token's initial + last token, so
   *
   *     "JD Shumpert & Tyler Larson"   -> "J. Larson"
   *     "Matt Facchine & Fake Grether" -> "M. Grether"
   *
   * Neither person exists. This shipped in #1288 and was found on a phone, not
   * by any test here — the surfaces that render per player (the match card, the
   * scorecard) were correct the whole time, which is what made it survive.
   *
   * It is worse than the truncation the ladder exists to prevent: a clipped name
   * is visibly incomplete, a fabricated one reads as correct.
   */
  it("score entry — a 2v2 side abbreviates PER PLAYER, never the joined label", () => {
    const html = renderToStaticMarkup(
      <MatchEntryView
        gameName="Stress"
        units={units}
        matches={DOUBLES}
        values={{}}
        onChange={() => {}}
        currentHole={1}
      />
    );

    /**
     * THE FABRICATIONS, BY NAME. Document-wide absence is the right scope here
     * and is immune to the nested-`MatchCard` problem below: these strings are
     * wrong ANYWHERE they appear, and nothing legitimate can emit them —
     * "Tyler Larson" alone abbreviates to "T. Larson", never "J. Larson".
     */
    expect(html).not.toContain("J. Larson");
    expect(html).not.toContain("M. Grether");

    /**
     * THE MECHANISM, not the outcome: no LADDERED span may contain an
     * ampersand. `data-name-step` marks a string the ladder has been applied to,
     * so this says exactly "the ladder never receives a joined side label" —
     * which is the rule — and it holds whether or not the joined label happened
     * to fit, where an assertion on the fabricated text only fires once it does
     * not.
     *
     * The joined label ITSELF is fine and deliberately still on the screen: the
     * avatar's `aria-label` names the side, and the keypad footer says
     * "JD Shumpert & Tyler Larson — Enter score", which is the correct way to
     * say WHICH SIDE this score is for. A blanket "the joined label must not
     * appear" assertion failed on both of those, and it was the assertion that
     * was wrong, not the markup.
     */
    const laddered = [...html.matchAll(/data-name-step="\d"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(laddered.length).toBeGreaterThan(0); // the anchor must be able to match at all
    expect(laddered.filter((t) => t.includes("&amp;"))).toEqual([]);

    /**
     * AND THE ROWS MUST ACTUALLY SAY IT — anchored to the ROW, because
     * `MatchEntryView` renders a `MatchCard` inside itself and that card renders
     * these same four names correctly from the same arrays. A document-wide
     * `toContain("JD Shumpert")` passes against a row rendering nothing at all;
     * this is the fifth substring-corollary instance recorded in CLAUDE.md, and
     * it is the same component pair that produced it.
     *
     * Entry's clamp floor is 15px — the card's is 13px — so the style anchor
     * alone separates the two.
     */
    for (const n of ["JD Shumpert", "Tyler Larson", "Matt Facchine", "Fake Grether"]) {
      expect(
        html,
        `${n} is missing from the score-entry ROW (the nested MatchCard does not count)`
      ).toMatch(
        new RegExp(`<span class="block truncate" data-name-step="1" style="font-size:clamp\\(15px[^>]*>${n}<`)
      );
    }
  });

  /**
   * THE THIRD AND FOURTH FINDINGS ON THIS ONE ROW, and they share the cause of
   * the first: a per-SIDE row rendering per-PLAYER content.
   *
   *   1. the joined name, laddered into a person who does not exist
   *   2. one avatar standing for two players
   *   3. "(you)" that a doubles player could never see
   *
   * The row is per side because the SCORE is per side — that part is right, and
   * the subtitle, the save badge and the score cell are correctly per side. It
   * is the identity of who is playing that is per player, and every one of these
   * was that distinction being dropped.
   */
  it("a 2v2 row carries one avatar PER PLAYER, not one for the side", () => {
    const html = renderToStaticMarkup(
      <MatchEntryView
        gameName="Stress"
        units={units}
        matches={DOUBLES}
        values={{}}
        onChange={() => {}}
        currentHole={1}
        meId="p2"
      />
    );

    /**
     * `Avatar` emits `aria-label="<name> initials"`, which is the anchor: a
     * side-level avatar can only ever produce the JOINED label, so these four
     * strings are unreachable without one disk per player.
     */
    for (const n of ["JD Shumpert", "Tyler Larson", "Matt Facchine", "Fake Grether"]) {
      expect(html, `${n} has no avatar of their own`).toContain(`aria-label="${n} initials"`);
    }

    /** And the side-level disk it replaces must be gone, not merely joined by them. */
    expect(html).not.toContain('aria-label="JD Shumpert &amp; Tyler Larson initials"');
    expect(html).not.toContain('aria-label="Matt Facchine &amp; Fake Grether initials"');

    /** Four players, four disks — counted, so an extra side-level one fails too. */
    expect([...html.matchAll(/aria-label="[^"]* initials"/g)]).toHaveLength(4);

    /** Each disk carries its own player's TEAM COLOR, not the neutral fallback
     *  — the side-level avatar's one colour was the thing being replaced. */
    expect([...html.matchAll(/background:#22c55e/g)]).toHaveLength(2);
    expect([...html.matchAll(/background:#f97316/g)]).toHaveLength(2);

    /**
     * FOURTH FINDING. `isMe` compares the SIDE id, which for a 2v2 is a
     * play_group id and can never equal a user id — so a doubles player never
     * saw "(you)" on their own row. Asked per player, it has an answer.
     *
     * `meId` is "p2" = Tyler Larson, so the marker belongs to HIM and to nobody
     * else on the row — asserting only that "(you)" appears somewhere would pass
     * against a build that put it on every name.
     */
    expect(html).toMatch(/Tyler Larson<span[^>]*> \(you\)<\/span>/);
    expect([...html.matchAll(/\(you\)/g)]).toHaveLength(1);
  });

  /** The 1v1 row is explicitly unchanged: ONE avatar, and it keeps `avatarIcon`
   *  (which a side has and a `SidePlayer` does not). */
  it("a 1v1 row still carries exactly one avatar", () => {
    const singles: MatchGroupData[] = [
      {
        matchId: "m1",
        label: "Match 1",
        a: { id: "u1", name: "Bud Banks", color: "#22c55e" },
        b: { id: "u2", name: "Rob Drupp", color: "#f97316" },
        strokesA: 0,
        strokesB: 0,
      },
    ];
    const html = renderToStaticMarkup(
      <MatchEntryView gameName="Stress" units={units} matches={singles} values={{}} onChange={() => {}} currentHole={1} />
    );
    expect(html).toContain('aria-label="Bud Banks initials"');
    expect([...html.matchAll(/aria-label="[^"]* initials"/g)]).toHaveLength(2); // one per side
  });

  /**
   * THE PADDING, AND IT IS UNCONDITIONAL. `minHeight` let the row grow but the
   * padding did not grow with it, so names sat against the top edge and the
   * subtitle against the bottom. Asserted on BOTH shapes, because the 1v1 was
   * tight too — only visibly so once a 2v2 stood beside it — and a build that
   * padded only the stacked case would look correct in isolation.
   */
  it("pads the row vertically whether or not it is stacked", () => {
    const singles: MatchGroupData[] = [
      { matchId: "m1", label: "Match 1", a: { id: "u1", name: "Bud Banks", color: "#22c55e" }, b: { id: "u2", name: "Rob Drupp", color: "#f97316" }, strokesA: 0, strokesB: 0 },
    ];
    for (const [shape, matches] of [["2v2", DOUBLES], ["1v1", singles]] as const) {
      const html = renderToStaticMarkup(
        <MatchEntryView gameName="Stress" units={units} matches={matches} values={{}} onChange={() => {}} currentHole={1} />
      );
      expect(html, `${shape} row lost its vertical padding`).toContain("padding:10px 14px 10px 11px");
      expect(html, `${shape} row still has the old flush-top padding`).not.toContain("padding:0 14px 0 0");
    }
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
