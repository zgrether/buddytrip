import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemReadingHeader } from "./PickemOtherPicks";
import { PickemHeadToHead } from "./PickemHeadToHead";
import type { BoardRow } from "@/lib/pickemBoard";

/**
 * The two sub-screens that open something from a list share ONE back-header.
 *
 * ── What a plausible wrong build looks like, and why one assertion misses it ─
 *
 * The wrong build is a HALF-conversion: one consumer moved onto the shared
 * component and the other left on its inline copy. That build compiles, renders
 * correctly, and looks right on both screens — the two copies were
 * character-identical, which is how they drifted apart unnoticed in the first
 * place and why nothing in a diff would show it.
 *
 * So a test asserting "the header is there" passes on it. `pickem-reading-header`
 * in particular EXISTED before the extraction, so asserting that testid alone
 * proves nothing at all about where the markup came from.
 *
 * The anchor is therefore `data-pickem-back-header`, which only the shared
 * component emits — neither inline copy had it, so a consumer that did not move
 * cannot produce it however closely its markup matches. That is the difference
 * between asserting the OUTCOME (a header rendered) and asserting the MECHANISM
 * (it came from the one file).
 */

/**
 * One element's opening tag, found by testid.
 *
 * Anchored to the ELEMENT rather than searched for in the document, because
 * both of these headers sit above content that repeats their own words: the
 * head-to-head prints "Ada vs Bo" in the title and then every team name below
 * it, and the reading header sits above a whole sheet. A `toContain` over the
 * document would be satisfied by the wrong node — the substring corollary,
 * whose fifth instance was a component nested inside its own entry view.
 */
function tagWithTestId(markup: string, testId: string): string {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  const open = markup.lastIndexOf("<", at);
  const close = markup.indexOf(">", at);
  return markup.slice(open, close + 1);
}

const readingMarkup = () =>
  renderToStaticMarkup(<PickemReadingHeader name="Brad Giesler" onBack={() => {}} />);

const row: BoardRow = {
  slateGameId: "g1",
  result: null,
  multiplier: 1,
  aPick: "home",
  bPick: "home",
  aConfidence: null,
  bConfidence: null,
  aPoints: 0,
  bPoints: 0,
  swing: 0,
  zeroKind: null,
  upsideA: 0,
  upsideB: 0,
};

const h2hMarkup = () =>
  renderToStaticMarkup(
    <PickemHeadToHead
      slate={[
        {
          id: "g1",
          awayTeam: "Toledo Rockets",
          homeTeam: "Michigan State Spartans",
          spread: "-9.5",
          kickoff: "Fri Sep 4, 8:00p",
          note: null,
          multiplier: 1,
        },
      ]}
      rows={[row]}
      aName="Charlie"
      bName="JD"
      aUserId="u1"
      bUserId="u2"
      avatarFor={() => ({ avatarIcon: null, teamColor: null })}
      matchIndex={1}
      matchCount={8}
      resolved={0}
      picked={{ a: true, b: true }}
      useConfidence
      note="No games in yet"
      onBack={() => {}}
    />
  );

describe("PickemBackHeader — one component, both sub-screens", () => {
  it("is the source of BOTH headers, under two distinct testids", () => {
    /**
     * Two testids rather than one shared name: a shared testid would let this
     * file pass against a build where one consumer renders the other's markup,
     * which is the failure `PickemSegments`' `testIdPrefix` note describes.
     */
    const reading = tagWithTestId(readingMarkup(), "pickem-reading-header");
    const h2h = tagWithTestId(h2hMarkup(), "pickem-h2h-header");

    expect(reading, "Other picks → a person's sheet").not.toBe("");
    expect(h2h, "Matches → one pairing").not.toBe("");

    // The mechanism. An inline copy cannot emit this, so a half-conversion
    // fails here rather than passing on markup that merely looks the same.
    expect(reading).toContain("data-pickem-back-header");
    expect(h2h).toContain("data-pickem-back-header");
  });

  it("gives the head-to-head header the anchor it never had", () => {
    /**
     * The head-to-head's header div carried NO testid before the extraction —
     * its testids were on the back button and on the whole view. An unanchored
     * duplicate is invisible to any test of the other one, which is the
     * mechanism that let these two drift; naming it is half the point of the
     * extraction.
     */
    expect(h2hMarkup()).toContain('data-testid="pickem-h2h-header"');
  });

  it("keeps each screen's own words, back-target and trailing slot", () => {
    const reading = readingMarkup();
    const h2h = h2hMarkup();

    // The back BUTTON goes to different lists, and says so.
    expect(tagWithTestId(reading, "pickem-reading-back")).toContain('aria-label="Back to the list"');
    expect(tagWithTestId(h2h, "pickem-board-back")).toContain('aria-label="All matches"');

    // Titles and the counter survive the move into a shared shell.
    expect(reading).toContain("Brad Giesler");
    expect(reading).toContain("s picks");
    expect(h2h).toContain("Charlie");
    expect(h2h).toContain("Match ");
    expect(h2h).toContain("of ");
    expect(h2h).toContain("8");
  });

  it("sizes the title from the scale, not from a re-typed literal", () => {
    /**
     * Both copies hardcoded `fontSize: 17` while the counter beside one of them
     * used `TYPE_SCALE.caption` — so a scale change moved the small text and
     * left the title behind. 17 is now the `title` rung.
     *
     * Asserted on the STYLE ATTRIBUTE rather than a computed style: this suite
     * is `environment: "node"` with no DOM, so `getComputedStyle` does not
     * exist here. The inline attribute is what `renderToStaticMarkup` emits and
     * it is still the style rather than the text, which is the property that
     * matters.
     */
    for (const markup of [readingMarkup(), h2hMarkup()]) {
      const title = tagWithTestId(markup, "pickem-back-header-title");
      expect(title).not.toBe("");
      expect(title).toContain("font-size:17px");
    }
  });
});
