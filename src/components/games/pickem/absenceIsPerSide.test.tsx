import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMatchCard } from "./PickemMatchCard";
import { PickemHeadToHead } from "./PickemHeadToHead";
import type { BoardRow, MatchStanding } from "@/lib/pickemBoard";

/**
 * "Nobody submitted" belongs to a PERSON, and it has to sit under them.
 *
 * ── The defect, on both screens ───────────────────────────────────────────
 *
 * One centred badge between two names names NEITHER of them. On the card it
 * sat under the bottom-left and read as the left player's; on the detail page
 * it sat in the middle of the header. Either way a reader had to work out which
 * of the two people it was about from the scores — on the one card where the
 * scores are 0-0 and explain nothing.
 *
 * ── Why presence assertions are useless here ──────────────────────────────
 *
 * `toContain("NO PICKS")` passes against the build that ships today: the badge
 * IS in the row, in the wrong place. The spec called this out and it is the
 * substring corollary again — the assertion is true, about the wrong element.
 *
 * So both suites below assert a TRUTH TABLE (only the missing side is marked)
 * and, on the detail page, CONTAINMENT (the notice is inside that player's own
 * subtree). A single centred badge cannot satisfy either.
 */

const st = (over: Partial<MatchStanding> = {}): MatchStanding => ({
  aTotal: 0,
  bTotal: 0,
  margin: 0,
  remaining: 8,
  trailingUpside: 0,
  clinched: false,
  ...over,
});

const card = (picked: { a: boolean; b: boolean }) =>
  renderToStaticMarkup(
    <PickemMatchCard
      aName="Grether"
      bName="Taj"
      aAvatar={{ avatarIcon: null, teamColor: "#5b8def" }}
      bAvatar={{ avatarIcon: null, teamColor: "#e0873f" }}
      standing={st({ aTotal: 17, margin: 17, remaining: 9, trailingUpside: 0 })}
      resolvedCount={7}
      picked={picked}
      mine={false}
      onOpen={() => {}}
    />
  );

describe("the CARD marks only the side that is missing", () => {
  it("puts the notice on B when B is the one who did not submit", () => {
    const html = card({ a: true, b: false });
    expect(html).toContain('data-testid="pickem-match-nopicks-b"');
    expect(html).not.toContain('data-testid="pickem-match-nopicks-a"');
  });

  it("puts it on A when A is", () => {
    const html = card({ a: false, b: true });
    expect(html).toContain('data-testid="pickem-match-nopicks-a"');
    expect(html).not.toContain('data-testid="pickem-match-nopicks-b"');
  });

  it("marks both when neither submitted, and neither when both did", () => {
    /**
     * The two ends of the table. Without them a build that always marked side A
     * would pass the first case, and a build that marked both sides always
     * would pass the first two.
     */
    const both = card({ a: false, b: false });
    expect(both).toContain('data-testid="pickem-match-nopicks-a"');
    expect(both).toContain('data-testid="pickem-match-nopicks-b"');

    const neither = card({ a: true, b: true });
    expect(neither).not.toContain("pickem-match-nopicks");
    expect(neither).not.toContain("NO PICKS");
  });

  it("stops printing the centred pill that named the wrong player", () => {
    /**
     * The old badge is GONE rather than joined by the new ones — otherwise the
     * card says the same thing twice and the wrong one is still on it.
     */
    expect(card({ a: true, b: false })).not.toContain("Nothing submitted");
  });
});

describe("the CARD's scores carry team identity", () => {
  const leadingA = renderToStaticMarkup(
    <PickemMatchCard
      aName="Grether"
      bName="Matt"
      aAvatar={{ avatarIcon: null, teamColor: "#5b8def" }}
      bAvatar={{ avatarIcon: null, teamColor: "#e0873f" }}
      standing={st({ aTotal: 41, bTotal: 34, margin: 7, remaining: 6, trailingUpside: 21 })}
      resolvedCount={2}
      picked={{ a: true, b: true }}
      mine={false}
      onOpen={() => {}}
    />
  );

  it("paints the LEADER's score in their team colour and the trailer grey", () => {
    /**
     * THE MUTATION: colour both, or colour by side rather than by who leads.
     * Either passes a test that only checks the colour is present somewhere.
     * The pair is the assertion.
     */
    const at = leadingA.indexOf('data-testid="pickem-side-score-leading"');
    expect(at, "no leading score rendered").toBeGreaterThan(-1);
    const leadTag = leadingA.slice(leadingA.lastIndexOf("<", at), leadingA.indexOf(">", at) + 1);
    expect(leadTag).toContain("#5b8def");
    expect(leadTag).toContain("font-weight:700");

    const bt = leadingA.indexOf('data-testid="pickem-side-score"');
    const trailTag = leadingA.slice(leadingA.lastIndexOf("<", bt), leadingA.indexOf(">", bt) + 1);
    expect(trailTag).toContain("--color-bt-text-dim");
    expect(trailTag).not.toContain("#e0873f");
  });

  it("keeps BOTH raw totals — a margin alone would flatten them", () => {
    /**
     * 8-7 and 1-0 are both "1 UP" and are not the same match. This is the one
     * thing golf's card cannot lend pick'em, because a hole is worth one and a
     * pick'em game is worth up to 32.
     */
    expect(leadingA).toContain("41");
    expect(leadingA).toContain("34");
  });

  it("drops the avatars — the colour on the number carries the team now", () => {
    /**
     * They were the only team signal, and `collapse` could reduce them to a dot
     * or drop them entirely as a name grew — so the signal was the first thing
     * sacrificed exactly when the card was busiest.
     */
    expect(leadingA).not.toContain("pickem-board-avatar");
    expect(leadingA).not.toContain("border-radius:50%");
  });

  it("falls back to full text colour when a player has no team", () => {
    /**
     * Not an error case — an unassigned player has no team. The leader must
     * still read as the leader, without a colour being invented for them.
     */
    const noTeam = renderToStaticMarkup(
      <PickemMatchCard
        aName="Grether"
        bName="Matt"
        standing={st({ aTotal: 41, bTotal: 34, margin: 7, remaining: 6 })}
        resolvedCount={2}
        picked={{ a: true, b: true }}
        mine={false}
        onOpen={() => {}}
      />
    );
    const at = noTeam.indexOf('data-testid="pickem-side-score-leading"');
    const leadTag = noTeam.slice(noTeam.lastIndexOf("<", at), noTeam.indexOf(">", at) + 1);
    expect(leadTag).toContain("var(--color-bt-text)");
    expect(leadTag).toContain("font-weight:700");
  });
});

const row: BoardRow = {
  slateGameId: "g1",
  result: null,
  multiplier: 1,
  aPick: "home",
  bPick: null,
  aConfidence: null,
  bConfidence: null,
  aPoints: 0,
  bPoints: 0,
  swing: 0,
  zeroKind: null,
  upsideA: 0,
  upsideB: 0,
};

const detail = (picked: { a: boolean; b: boolean }) =>
  renderToStaticMarkup(
    <PickemHeadToHead
      slate={[
        { id: "g1", awayTeam: "Toledo Rockets", homeTeam: "Michigan State Spartans", spread: null, kickoff: null, multiplier: 1 },
      ]}
      rows={[row]}
      aName="JohnnyD"
      bName="Taj"
      aUserId="u1"
      bUserId="u2"
      avatarFor={() => ({ avatarIcon: null, teamColor: null })}
      matchIndex={1}
      matchCount={8}
      resolved={0}
      picked={picked}
      useConfidence
      note="unused when decided"
      onBack={() => {}}
    />
  );

/** One element's subtree, bounded by span depth from its testid. */
function subtree(markup: string, testId: string): string {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  let i = markup.indexOf(">", at) + 1;
  let depth = 0;
  const start = i;
  while (i < markup.length) {
    const open = markup.indexOf("<span", i);
    const close = markup.indexOf("</span>", i);
    if (close === -1) break;
    if (open !== -1 && open < close) {
      depth += 1;
      i = open + 5;
    } else if (depth === 0) {
      return markup.slice(start, close);
    } else {
      depth -= 1;
      i = close + 7;
    }
  }
  return "";
}

describe("the DETAIL page puts the notice inside the player it is about", () => {
  it("nests NO PICKS in the missing player's own side, beside their name", () => {
    /**
     * CONTAINMENT, which is what "under the player it belongs to" means and
     * what a presence assertion cannot express. The notice must be in the same
     * subtree as the NAME — a centred badge is in neither side's subtree, so it
     * fails here however plainly it renders.
     */
    const html = detail({ a: true, b: false });

    const right = subtree(html, "pickem-h2h-side-right");
    expect(right, "the right side's subtree could not be bounded").not.toBe("");
    expect(right).toContain("Taj");
    expect(right).toContain("NO PICKS");

    const left = subtree(html, "pickem-h2h-side-left");
    expect(left).toContain("JohnnyD");
    expect(left).not.toContain("NO PICKS");
  });

  it("does not ALSO say it in the centre pill", () => {
    /**
     * Three statements of one fact on one card — twice under the names, once
     * between them — is the composition defect this feature keeps producing.
     */
    expect(detail({ a: true, b: false })).not.toContain("Nothing submitted");
  });

  it("stands the pill down entirely once the banner is speaking", () => {
    /**
     * FOUND BY LOOKING, not by any assertion here: a match decided by a missing
     * sheet rendered the green "JohnnyD takes it" band with "1 LEFT" between the
     * two names. Both were true — one game genuinely was unresolved — and
     * together they said the match was over and still running.
     *
     * Neither component was wrong on its own, which is why only the assembled
     * screen could show it. The pill is the LIVE state and the banner is the
     * decided one; they must not both be on screen.
     */
    const decidedHtml = detail({ a: true, b: false });
    expect(decidedHtml).toContain('data-testid="pickem-h2h-result"');
    expect(decidedHtml).not.toContain('data-testid="pickem-h2h-pill"');

    // ...and a LIVE match still has its pill, so this is not passing by the
    // pill having been deleted.
    const liveHtml = detail({ a: true, b: true });
    expect(liveHtml).toContain('data-testid="pickem-h2h-pill"');
    expect(liveHtml).not.toContain('data-testid="pickem-h2h-result"');
  });
});

describe("a decided match gets the result banner, with its reason", () => {
  it("says who takes it AND why, in the golf banner", () => {
    /**
     * The reason is the half that only matters here. On the CARD the per-side
     * badge is inches away, so `matchNote` shortens to "JohnnyD takes it"; the
     * banner is wider and a decided 0-0 with no explanation reads as a bug.
     */
    const html = detail({ a: true, b: false });
    expect(html).toContain('data-testid="pickem-h2h-result"');
    expect(html).toContain("JohnnyD takes it");
    expect(html).toContain("Taj submitted no picks");
  });

  it("uses golf's banner rather than a second one", () => {
    // The place-1 treatment, from the extracted component — not a pick'em
    // lookalike. A second banner is what the instruction forbade.
    const html = detail({ a: true, b: false });
    expect(html).toContain("var(--color-bt-place-1-bg)");
    expect(html).toContain("var(--color-bt-place-1-border)");
  });

  it("leaves a LIVE match with the quiet note, not a result treatment", () => {
    /**
     * THE MUTATION: banner everything. A running commentary in a green result
     * band announces a result that has not happened — and every assertion above
     * still passes, because they only ever look at decided matches.
     */
    const html = detail({ a: true, b: true });
    expect(html).not.toContain('data-testid="pickem-h2h-result"');
    expect(html).toContain('data-testid="pickem-h2h-note"');
  });
});
