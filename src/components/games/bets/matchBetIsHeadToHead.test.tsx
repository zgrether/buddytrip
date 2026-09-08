import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BetForm, freshBetDraft } from "./betControls";
import { quickBetSetupSides } from "@/lib/quickGameBets";
import type { BetSide } from "@/lib/sideBets";

/**
 * "Hide skins from quick match play's side bets."
 *
 * The rules are pinned in `betDraft.test.ts` (a locked draft records a
 * head-to-head) and `quickGameBets.test.ts` (a match's setup-time sides). What
 * is left, and what this file is for, is the thing a person actually reported:
 * **the Skins control is not on the screen**, and the round's format is what
 * decides that.
 *
 * Rendered rather than read. A source grep for `sidesLocked` would have passed
 * against the build that had the bug — `QuickGameSetupSheet` mentioned the prop
 * on every render, and passed it the literal `false`.
 *
 * `environment: "node"`, so this renders and never clicks — which is the whole
 * reason the *rules* live in `betDraft.ts` and only the presence of a control
 * is asserted here.
 */

const FOUR = ["Zach", "Buddy", "Mike", "Ryan"].map((name, i) => ({
  id: `p${i + 1}`,
  name,
  color: "#2dd4bf",
}));

const MATCH_ROWS = [
  { id: "p1", side: "A" as const },
  { id: "p2", side: "A" as const },
  { id: "p3", side: "B" as const },
  { id: "p4", side: "B" as const },
];

function form(sidesLocked: boolean, lockedSides: BetSide[]) {
  return renderToStaticMarkup(
    <BetForm
      players={FOUR}
      draft={freshBetDraft(FOUR, 1, sidesLocked)}
      setDraft={() => {}}
      sidesLocked={sidesLocked}
      lockedSides={lockedSides}
      holeCount={18}
      nassauAvailable
      sideName={(s) => s.playerIds.join(" & ")}
      onCancel={() => {}}
      onCommit={() => {}}
    />
  );
}

describe("the bet form in a MATCH round", () => {
  // Through the same helper the setup sheet calls, so this cannot pass against
  // a build where that helper is right and the sheet asks it the wrong thing —
  // which is exactly the shape of the bug (`sidesLocked={false}`, hardcoded,
  // for every format).
  const match = quickBetSetupSides("match", MATCH_ROWS);
  const stroke = quickBetSetupSides("stroke", MATCH_ROWS);

  it("offers no Head-to-Head/Skins choice at all", () => {
    // `side-bet-kind` is the Segmented's own testid — a value nothing else in
    // this form emits, rather than the word "Skins", which the blurb under the
    // control also contains.
    expect(form(match.sidesLocked, match.lockedSides)).not.toContain('data-testid="side-bet-kind"');
  });

  it("still offers it in a STROKE round with the same four players", () => {
    // The control the case above asserts the absence of, present — so that
    // assertion is about the format and not about a testid that was renamed.
    expect(form(stroke.sidesLocked, stroke.lockedSides)).toContain('data-testid="side-bet-kind"');
  });

  it("names the match's two sides instead of asking who is betting", () => {
    const html = form(match.sidesLocked, match.lockedSides);
    expect(html).toContain('data-testid="side-bet-sides-locked"');
    expect(html).toContain("p1 &amp; p2 v p3 &amp; p4");
    expect(html).not.toContain('data-testid="side-bet-player-chip"');
  });

  it("shows the per-person share of a skin where skins IS on offer", () => {
    // The other half of the money fix, on the screen: "Stakes (per skin)" has
    // always been the label and the arithmetic used to price it per person, so
    // the form now states what each of them puts in. $10 between four is $2.50.
    const html = form(stroke.sidesLocked, stroke.lockedSides);
    expect(html).toContain('data-testid="side-bet-skin-share"');
    expect(html).toContain("$2.50");
  });
});
