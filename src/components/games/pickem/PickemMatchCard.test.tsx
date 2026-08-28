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
    expect(matchPill(st({ remaining: 8 }), 0)).toBe("not-started");
  });

  it("is LIVE once something is in and it is still open", () => {
    expect(matchPill(st({ remaining: 5 }), 3)).toBe("live");
  });

  it("is CLINCHED when the lead is beyond reach — but only while games remain", () => {
    expect(matchPill(st({ remaining: 3, margin: 40, clinched: true }), 5)).toBe("clinched");
  });

  it("is FINAL when nothing is left, even if the standing says clinched", () => {
    /**
     * `matchStanding` already sets `clinched: false` at zero remaining — a
     * finished match is DECIDED, not clinched. This pins the card's half of
     * that: it must not put a live-sounding word on a settled result even if
     * handed a standing that claims it.
     */
    expect(matchPill(st({ remaining: 0, margin: 40, clinched: true }), 8)).toBe("final");
  });
});

describe("matchNote — precedence, because these states share their numbers", () => {
  it("separates DEAD EVEN from NOTHING PLAYED — both read 0-0", () => {
    // The empty-versus-unknown split, in copy. A finished 0-0 and an unplayed
    // 0-0 are opposite facts about what is left.
    expect(matchNote(st({ remaining: 0, margin: 0 }), 8, "Zach")).toContain("Dead even");
    expect(matchNote(st({ remaining: 8, margin: 0 }), 0, "Zach")).toBe("No games in yet");
  });

  it("says LEVEL WITH n TO PLAY once something is in and it is tied", () => {
    // Distinct from "no games in yet": tied after five is a different match
    // from tied before any.
    expect(matchNote(st({ remaining: 3, margin: 0 }), 5, "Zach")).toBe("Level with 3 to play");
  });

  it("says who TAKES IT and by how much when it is over", () => {
    expect(matchNote(st({ remaining: 0, margin: -12 }), 8, "Ty")).toBe("Ty takes it by 12");
  });

  it("says SAFE with the numbers that make it safe", () => {
    // The clinch line names both sides of the comparison, because "is safe" on
    // its own is a claim the reader cannot check.
    const note = matchNote(st({ remaining: 4, margin: 30, clinched: true, trailingUpside: 9 }), 4, "Zach");
    expect(note).toBe("Zach is safe — only 9 in play against a 30 lead");
  });

  it("otherwise says the lead AND what is still in play", () => {
    // Mid-match, the second number is the one that decides whether to care.
    const note = matchNote(st({ remaining: 6, margin: 7, trailingUpside: 21 }), 2, "Zach");
    expect(note).toBe("Zach by 7 · 21 still in play");
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
        mine={false}
        youSide={null}
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

  it("tags the viewer's own side", () => {
    expect(render({ mine: true, youSide: "b" })).toContain("You");
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
