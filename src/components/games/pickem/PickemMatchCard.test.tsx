import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMatchCard, matchPill, matchNote } from "./PickemMatchCard";
import type { MatchStanding } from "@/lib/pickemBoard";

/**
 * The match card — Screen C.
 *
 * The pill and the note are decided together from one standing, so they cannot
 * disagree about the same match. Both are exported and tested directly: the
 * PRECEDENCE is the part that goes subtly wrong, because several of these states
 * show the same numbers and mean different things.
 */

/** Both sides submitted — the ordinary case the margin copy is about. */
const BOTH = { a: true, b: true } as const;
const NAMES = { a: "Zach", b: "Ty" } as const;

const st = (over: Partial<MatchStanding> = {}): MatchStanding => ({
  aTotal: 0,
  bTotal: 0,
  margin: 0,
  remaining: 0,
  trailingUpside: 0,
  clinched: false,
  ...over,
});

describe("matchPill", () => {
  it("is NOT STARTED when nothing has been played", () => {
    expect(matchPill(st({ remaining: 8 }), 0, BOTH)).toBe("not-started");
  });

  it("is LIVE once something is in and it is still open", () => {
    expect(matchPill(st({ remaining: 5 }), 3, BOTH)).toBe("live");
  });

  it("is CLINCHED when the lead is beyond reach — but only while games remain", () => {
    expect(matchPill(st({ remaining: 3, margin: 40, clinched: true }), 5, BOTH)).toBe("clinched");
  });

  it("is FINAL when nothing is left, even if the standing says clinched", () => {
    /**
     * `matchStanding` already sets `clinched: false` at zero remaining — a
     * finished match is DECIDED, not clinched. This pins the card's half of
     * that: it must not put a live-sounding word on a settled result even if
     * handed a standing that claims it.
     */
    expect(matchPill(st({ remaining: 0, margin: 40, clinched: true }), 8, BOTH)).toBe("final");
  });
});

describe("matchNote — precedence, because these states share their numbers", () => {
  it("separates DEAD EVEN from NOTHING PLAYED — both read 0-0", () => {
    // The empty-versus-unknown split, in copy. A finished 0-0 and an unplayed
    // 0-0 are opposite facts about what is left.
    expect(matchNote(st({ remaining: 0, margin: 0 }), 8, "Zach", BOTH, NAMES)).toContain("Dead even");
    expect(matchNote(st({ remaining: 8, margin: 0 }), 0, "Zach", BOTH, NAMES)).toBe("No games in yet");
  });

  it("says LEVEL WITH n TO PLAY once something is in and it is tied", () => {
    // Distinct from "no games in yet": tied after five is a different match
    // from tied before any.
    expect(matchNote(st({ remaining: 3, margin: 0 }), 5, "Zach", BOTH, NAMES)).toBe("Level with 3 to play");
  });

  it("says who TAKES IT and by how much when it is over", () => {
    expect(matchNote(st({ remaining: 0, margin: -12 }), 8, "Ty", BOTH, NAMES)).toBe("Ty takes it by 12");
  });

  it("says SAFE with the numbers that make it safe", () => {
    // The clinch line names both sides of the comparison, because "is safe" on
    // its own is a claim the reader cannot check.
    const note = matchNote(st({ remaining: 4, margin: 30, clinched: true, trailingUpside: 9 }), 4, "Zach", BOTH, NAMES);
    expect(note).toBe("Zach is safe — only 9 in play against a 30 lead");
  });

  it("otherwise says the lead AND what is still in play", () => {
    // Mid-match, the second number is the one that decides whether to care.
    const note = matchNote(st({ remaining: 6, margin: 7, trailingUpside: 21 }), 2, "Zach", BOTH, NAMES);
    expect(note).toBe("Zach by 7 · 21 still in play");
  });
});

describe("a side that never picked — NOT a clinch", () => {
  /**
   * Someone with no sheet has zero upside, so `matchStanding` correctly reports
   * the lead as beyond reach from the first result. The maths was always right;
   * CLINCHED was the wrong WORD.
   *
   * A clinch is a contest won. Beating an empty sheet is not a contest, and the
   * difference is actionable rather than pedantic: a clinched match is decided,
   * while this one is decided because nobody entered.
   *
   * Live, this read "CLINCHED · Merling is safe — only 0 in play against a 17
   * lead" with nine games still to play, which reads as a broken app rather than
   * an opponent who never picked.
   *
   * ── The word changed twice, and the second time for a different reason ────
   *
   * CLINCHED became NO PICKS, and NO PICKS became DIDN'T PICK. "No picks"
   * suggests a sheet whose picks are missing; what is missing is the SHEET.
   * That matters because of what a reader assumes fills the gap — the picking
   * screen opens on every home team, so a missing sheet feels like it ought to
   * score the chalk. It scores nothing: verified on the live game, where three
   * people hold zero rows in `pickem_picks` and zero points while every
   * submitted sheet holds sixteen.
   */
  const empty = { a: false, b: true } as const;

  it("takes the DIDN'T PICK pill rather than CLINCHED", () => {
    const s = st({ remaining: 9, margin: -17, clinched: true, trailingUpside: 0 });
    expect(matchPill(s, 7, empty)).toBe("no-sheet");
    // ...and the same standing IS a clinch when both sides actually played.
    expect(matchPill(s, 7, BOTH)).toBe("clinched");
  });

  it("names who takes it, and leaves the FACT to the pill beside it", () => {
    /**
     * It used to end "unless that changes". Nothing can change it: this
     * surface renders on a LOCKED game and nowhere else, and
     * `pickem_picks_write` gates on `pickem_picks_open` — so neither the
     * person nor a captain proxying for them can add a sheet. The sentence was
     * the refusal rule pointing the other way, an invitation nobody can accept.
     *
     * It then said "X didn't submit a sheet — it scores nothing, so Y takes
     * the match", which repeated the PILL ("Nothing submitted") and overran
     * the line it shares with it. The repetition is what went; the pill still
     * carries the fact on both surfaces that render this note, which is the
     * thing to verify before shortening a sentence into a label.
     *
     * The explicit consequence — "it scores nothing" — is genuinely lost and
     * is now carried by implication. Recorded in `matchNote` rather than
     * quietly dropped.
     */
    const note = matchNote(
      st({ remaining: 9, margin: -17, clinched: true, trailingUpside: 0 }),
      7,
      "Ty",
      empty,
      NAMES
    );
    expect(note).toBe("Ty takes it");
    expect(note).not.toContain("unless that changes");
    // The pill's own words must not be repeated here — that is the whole
    // reason this line is short.
    expect(note).not.toContain("submit");
    // The line before that one is gone too: "only 0 in play" is true and
    // explains nothing.
    expect(note).not.toContain("in play");
    expect(note).not.toContain("safe");
  });

  it("says NEITHER when both are empty — no leader to name", () => {
    // Two guests paired together. Naming one as taking it would invent a winner.
    const note = matchNote(st({ remaining: 9 }), 7, "Zach", { a: false, b: false }, NAMES);
    expect(note).toBe("Nothing scores");
    expect(note).not.toContain("yet");
    // No winner invented where there is none: "takes it" belongs only to the
    // branch that has somebody to name.
    expect(note).not.toContain("takes it");
  });

  it("is FINAL once nothing is left, not DIDN'T PICK", () => {
    // Once the games are gone the reason the margin was built stops mattering,
    // and the match is simply the result.
    const s = st({ remaining: 0, margin: -17 });
    expect(matchPill(s, 16, empty)).toBe("final");
    expect(matchNote(s, 16, "Ty", empty, NAMES)).toBe("Ty takes it by 17");
  });

  it("does NOT fire for a partial sheet — real upside is honest already", () => {
    // A sheet is all-or-nothing at save time; a partial one is only reachable if
    // the runner GROWS the slate afterwards. That person has genuine upside on
    // what they did pick, so the ordinary margin copy is true and this state
    // would be a lie in the other direction.
    const s = st({ remaining: 9, margin: -17, trailingUpside: 22 });
    expect(matchPill(s, 7, BOTH)).toBe("live");
    expect(matchNote(s, 7, "Ty", BOTH, NAMES)).toBe("Ty by 17 · 22 still in play");
  });
});

describe("PickemMatchCard", () => {
  const render = (over: Partial<Parameters<typeof PickemMatchCard>[0]> = {}) =>
    renderToStaticMarkup(
      <PickemMatchCard
        aName="Zach"
        bName="Ty"
        standing={st({ aTotal: 41, bTotal: 34, margin: 7, remaining: 6, trailingUpside: 21 })}
        resolvedCount={2}
        picked={BOTH}
        mine={false}
        onOpen={() => {}}
        {...over}
      />
    );

  it("renders both totals and the margin bar", () => {
    const html = render();
    expect(html).toContain("41");
    expect(html).toContain("34");
    expect(html).toContain('data-testid="pickem-margin-bar"');
  });

  it("gives the LEADER the weight", () => {
    // Line 1's job is that you know who is ahead before reading the numbers.
    const html = render();
    const zachAt = html.indexOf("Zach");
    const leaderTag = html.lastIndexOf("font-weight:700", zachAt);
    expect(leaderTag).toBeGreaterThan(-1);
    // ...and the trailer is dim, so the pair reads as a comparison.
    expect(html).toContain("var(--color-bt-text-dim)");
  });

  it("marks the viewer's own match with the card FILL, not a badge", () => {
    /**
     * This replaces "tags the viewer's own side", which asserted a "YOU"
     * badge. The badge existed because `mine` only changed the 1px border —
     * a difference you have to hunt for in a list of eight — and it was the
     * only such tag in the app. A filled card says it from further away.
     *
     * Asserted as the PAIR, because the fill is what the badge's removal
     * rests on: a build that removed the tag and left `mine` as a border
     * change makes your own match harder to find than before, and every other
     * assertion here would still pass.
     */
    /**
     * Anchored to the CARD's own opening tag, not the document. The first
     * version of this test asserted over the whole render and failed against
     * correct code: the LIVE pill inside the card also uses
     * `--color-bt-accent-faint`, so "this card is mine" was being answered by
     * a descendant that means something else entirely. The substring
     * corollary, caught by the assertion going red rather than by reading it.
     */
    const cardTag = (markup: string) => markup.slice(0, markup.indexOf(">") + 1);

    const own = cardTag(render({ mine: true }));
    expect(own).toContain("var(--color-bt-accent-faint)");
    expect(own).toContain("var(--color-bt-accent-border)");
    expect(render({ mine: true })).not.toContain(">You<");

    // ...and a match that is not yours takes neither.
    const other = cardTag(render({ mine: false }));
    expect(other).not.toContain("var(--color-bt-accent-faint)");
    expect(other).toContain("var(--color-bt-card)");
  });

  it("appends the runner's note after the status, not instead of it", () => {
    // The status is derived and always true; the note is free text. Losing the
    // first to show the second would trade a fact for a comment.
    const html = render({ note: "moved to Sunday" });
    expect(html).toContain("Zach by 7");
    expect(html).toContain("moved to Sunday");
  });

  it("shows an EMPTY margin bar at dead level — no fill either side", () => {
    // A tied match must not look like a narrow lead for whoever is listed first.
    const html = render({ standing: st({ remaining: 4, margin: 0 }), resolvedCount: 2 });
    expect(html).toContain('data-testid="pickem-margin-bar"');
    expect(html).not.toContain("width:0%");
  });
});
