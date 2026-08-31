import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitionHero, CollapsedHero } from "./CompetitionHero";
import type { LBTeam } from "./CompetitionLeaderboard";
import { TEAM_NAME_MAX } from "@/lib/teamNameLimits";

/**
 * The cup header is a SUBJECT slot: it keeps the FULL name, because it is where
 * the crew reads the names they chose. What was added instead of a truncation is
 * a two-line RESERVE, and the reserve — not the wrap — is the thing under test.
 *
 * ── What a static render can and cannot see ──────────────────────────────────
 * `renderToStaticMarkup` produces HTML with no layout engine behind it, so this
 * file CANNOT assert that the two sides end up the same height, or that `ROSTER`
 * and the scores share a baseline. That is Zach's look on a device, and it is
 * the actual acceptance test.
 *
 * What it CAN assert is the mechanism that produces it: the reserve is emitted
 * UNCONDITIONALLY, at the same value, for a one-word name and a name at the cap.
 * That is the property a future edit would break — the tempting "optimisation"
 * is to apply the reserve only when the name is long enough to wrap, which
 * restores the unequal-baseline bug the reserve exists to prevent and which no
 * outcome assertion in this repo would notice.
 *
 * The reserve lives in a STYLE PROPERTY, not in a value, so nothing else guards
 * it: the configHash coverage guard watches columns, the exhaustive-record maps
 * watch keys, and mutation testing here changes values. A `min-height` that went
 * missing has no column, no key and no value to break. Hence a test that reads
 * the style directly (CLAUDE.md, "the first where the distinction lived in a
 * style property").
 */

const team = (id: string, name: string, short: string, color: string): LBTeam => ({
  id,
  name,
  short_name: short,
  color,
});

// Exactly the cap the input enforces — the longest name that can reach this
// header from the Edit Team form. Built by slice/pad so it tracks the constant
// rather than restating it, and deliberately free of "&": React escapes that to
// "&amp;" in the markup, which would make these assertions about HTML entities
// instead of about the name. The escaping is correct and is covered separately.
const AT_CAP = "Scurvy Hookers of the Booty Hunters".slice(0, TEAM_NAME_MAX).padEnd(TEAM_NAME_MAX, "x");
const SHORT = "Whack";

const hero = (aName: string, bName: string) =>
  renderToStaticMarkup(
    <CompetitionHero
      cupName="BBMI"
      tagline={null}
      teams={[team("a", aName, "BS", "#f87171"), team("b", bName, "WHK", "#c084fc")]}
      teamTotals={{ a: 5, b: 12 }}
      pointsAvailable={100}
      winNumber={78}
      clincher={null}
      gamesRemaining={3}
      scoringModel="match_play"
      canEdit={false}
      onEditTeam={() => {}}
    />
  );

const collapsed = (aName: string, bName: string) =>
  renderToStaticMarkup(
    <CollapsedHero
      teams={[team("a", aName, "BS", "#f87171"), team("b", bName, "WHK", "#c084fc")]}
      teamTotals={{ a: 5, b: 12 }}
      winNumber={78}
      pointsAvailable={100}
      clincher={null}
      onEditTeam={() => {}}
    />
  );

/** Every `min-height` the markup declares, in source order. */
const reserves = (html: string) => html.match(/min-height:[^;"]+/g) ?? [];

describe("cup header — the full name survives", () => {
  it("spells a name at the cap in full, with no ellipsis", () => {
    const html = hero(AT_CAP, SHORT);
    expect(html).toContain(AT_CAP);
    // Not an assertion about the CSS clamp (which cannot fire in a static
    // render) but about the string: nothing may pre-truncate the name on its
    // way to the DOM.
    expect(html).not.toContain("…");
  });

  it("renders an ampersand name intact, as an entity", () => {
    // The real team on the trip this was reported on. Worth its own case: the
    // markup assertions above avoid "&" on purpose, so without this nothing
    // would show that the name most likely to be in the header survives.
    const html = hero("Booty Hunters & Scurvy Hookers", SHORT);
    expect(html).toContain("Booty Hunters &amp; Scurvy Hookers");
  });
});

describe("cup header — the two-line reserve is unconditional", () => {
  it("reserves the same height for a short name as for one at the cap", () => {
    const long = reserves(hero(AT_CAP, AT_CAP));
    const short = reserves(hero(SHORT, SHORT));
    const mixed = reserves(hero(AT_CAP, SHORT));

    // Two name blocks, both reserved, in all three states — this is the
    // "both-long / both-short / one-of-each" trio from the spec, reduced to the
    // one property a static render can actually hold.
    expect(short).toHaveLength(2);
    expect(long).toEqual(short);
    expect(mixed).toEqual(short);

    // And the value is two lines, not an arbitrary pin.
    expect(short[0]).toContain("2.4em");
  });

  it("reserves in the COLLAPSED bar too, which is the same surface", () => {
    /**
     * The sticky bar and the expanded card are one header in two components.
     * Fixing only the reported one would leave a long name wrapping unpinned
     * here — and this bar is the only header on screen once anyone scrolls, so
     * it is the one people would actually be looking at mid-round.
     */
    const long = reserves(collapsed(AT_CAP, AT_CAP));
    const short = reserves(collapsed(SHORT, SHORT));
    expect(short).toHaveLength(2);
    expect(long).toEqual(short);
    expect(short[0]).toContain("2.4em");
  });
});
