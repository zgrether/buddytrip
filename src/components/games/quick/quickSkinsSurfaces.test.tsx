import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickSkinsStrip } from "./QuickSkinsStrip";
import { QuickSkinsResult } from "./QuickSkinsResult";
import { BetForm, freshBetDraft } from "@/components/games/bets/betControls";
import { setBetKind, type BetDraft } from "@/lib/betDraft";
import type { SkinsStanding } from "@/lib/skins";

/**
 * The Quick Skins surfaces. `environment: "node"`, so these render and never
 * click — the arithmetic is `quickSkins.test.ts`'s, and what is asserted here
 * is what a person can SEE.
 *
 * Anchored to `data-testid`s that only the cell in question emits, never to a
 * bare number: a skins card is full of small integers, and "3" appears as a
 * hole, a position, a count and a pot on the same screen (CLAUDE.md's substring
 * corollary — the tell is the SCOPE, and a whole rendered component is the
 * document).
 */

const PLAYERS = [
  { id: "p1", name: "Zach Grether", color: "#2dd4bf" },
  { id: "p2", name: "Buddy Jones", color: "#60a5fa" },
];

const STANDINGS: SkinsStanding[] = [
  { entityId: "p1", skins: 3, groupingId: "quick", position: 1, started: true },
  { entityId: "p2", skins: 1, groupingId: "quick", position: 2, started: true },
];

const strip = (stake: number) =>
  renderToStaticMarkup(
    <QuickSkinsStrip
      players={PLAYERS}
      standings={STANDINGS}
      netByPlayer={{ p1: 10, p2: -10 }}
      stake={stake}
    />
  );

describe("the live strip", () => {
  it("leads with the MONEY when there is money on the round", () => {
    const html = strip(10);
    expect(html).toContain('data-testid="quick-skins-headline-p1"');
    expect(html).toContain(">+$10<");
    expect(html).toContain("$10/skin");
  });

  it("leads with the SKIN COUNT when the round is for nothing", () => {
    // "$0" for every player says the arithmetic broke rather than that nobody
    // is betting — the empty-is-not-unknown split, in a display decision.
    const html = strip(0);
    expect(html).not.toContain("$0");
    expect(html).not.toContain('data-testid="quick-skins-stake"');
    expect(html).toContain('data-testid="quick-skins-headline-p1"');
  });

  it("shows the count under BOTH headlines, so money never hides the result", () => {
    for (const html of [strip(10), strip(0)]) {
      expect(html).toContain('data-testid="quick-skins-count-p1"');
      expect(html).toContain("3 skins");
      expect(html).toContain("1 skin<");
    }
  });
});

const result = (over: { stake?: number; deadPot?: number } = {}) =>
  renderToStaticMarkup(
    <QuickSkinsResult
      players={PLAYERS}
      standings={STANDINGS}
      netByPlayer={{ p1: 10, p2: -10 }}
      settlement={[{ fromPlayerId: "p2", toPlayerId: "p1", amount: 10 }]}
      stake={over.stake ?? 10}
      deadPot={over.deadPot ?? 0}
      subtitle="Pebble Creek"
      onScorecard={() => {}}
      onPlayAgain={() => {}}
      onDiscard={() => {}}
    />
  );

describe("the finish screen", () => {
  it("ranks by skins and names who owes whom", () => {
    const html = result();
    expect(html).toContain('data-testid="quick-skins-standing-p1"');
    expect(html).toContain('data-testid="quick-skins-total-p1"');
    expect(html).toContain('data-testid="quick-skins-settlement"');
    expect(html).toContain("owes");
  });

  it("drops the money column and the settlement entirely at a zero stake", () => {
    const html = result({ stake: 0 });
    expect(html).not.toContain('data-testid="quick-skins-money-p1"');
    expect(html).not.toContain('data-testid="quick-skins-settlement"');
    // …and still says who won what, which is the whole round.
    expect(html).toContain('data-testid="quick-skins-total-p1"');
  });

  it("says a destroyed pot went unpaid — the fact no number on the screen carries", () => {
    // Every figure is correct without mentioning it, and every one is equally
    // consistent with the pot never having existed. So the sentence has to say
    // it, and only when it happened.
    expect(result({ deadPot: 3 })).toContain('data-testid="quick-skins-dead-pot"');
    expect(result({ deadPot: 3 })).toContain("3 skins went unpaid");
    expect(result()).not.toContain('data-testid="quick-skins-dead-pot"');
  });
});

describe("the nudge toward a Skins round", () => {
  const FOUR = ["Zach", "Buddy", "Mike", "Ryan"].map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: "#2dd4bf",
  }));
  const form = (draft: BetDraft, onPlaySkinsRound?: () => void) =>
    renderToStaticMarkup(
      <BetForm
        players={FOUR}
        draft={draft}
        setDraft={() => {}}
        sidesLocked={false}
        lockedSides={[]}
        holeCount={18}
        nassauAvailable
        sideName={(s) => s.playerIds.join(" & ")}
        onCancel={() => {}}
        onCommit={() => {}}
        onPlaySkinsRound={onPlaySkinsRound}
      />
    );
  const skinsDraft = freshBetDraft(FOUR, 1); // four players ⇒ a pot
  const h2hDraft = setBetKind(freshBetDraft(FOUR.slice(0, 2), 1), "head_to_head");

  it("offers to play the format when SKINS is the bet being made", () => {
    expect(skinsDraft.kind).toBe("skins");
    expect(form(skinsDraft, () => {})).toContain('data-testid="side-bet-play-skins-round"');
  });

  it("says nothing on a head-to-head", () => {
    expect(form(h2hDraft, () => {})).not.toContain('data-testid="side-bet-play-skins-round"');
  });

  it("is absent where there is nowhere to switch to", () => {
    // Mid-round the callback is omitted, and a suggestion the reader cannot act
    // on is worse than none — following it would mean abandoning the round they
    // are playing (CLAUDE.md's refusal rule, applied to an offer).
    expect(form(skinsDraft)).not.toContain('data-testid="side-bet-play-skins-round"');
  });
});
