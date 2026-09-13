import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMatchPlayCard } from "./PickemMatchPlayCard";
import { buildBoardRows } from "@/lib/pickemBoard";
import type { BoardSlateGame } from "./PickemBoard";
import type { ScoredPick } from "@/lib/pickemScoring";

/**
 * THE CARD IS RENDERED, NOT THE MODEL.
 *
 * `pickemCardAgreement.test.ts` asserts the adapter and the engine agree with
 * `matchStanding`, and it passed while the live card was wrong — because it
 * called `matchState(model.results, model.unitCount, model.weightOf, …)`
 * itself. The COMPONENT does not. It hands `MatchCard` a `weightOf` through a
 * prop that, until this file was written, did not accept one:
 *
 *   MatchCard.tsx      glorious?: GloriousConfig      <- narrower than the
 *   matchPlay.ts       weighting: Weighting              parameter it feeds
 *
 * So pick'em could only pass `isWeightedUnit`, which draws the segment bar and
 * never reaches the engine. Every pick'em card was scored UNWEIGHTED.
 *
 * Lived on bbmi.app 2026-09-13, the same day the ceiling was fixed and
 * immediately behind it: Grether led Tyler 9-8, but unweighted the sides are
 * level at 4-4 — Grether's four wins include the 2x game and Tyler's four do
 * not — so the card rendered "AS" on a match that was won.
 *
 * A test that calls the engine itself cannot see a prop that does not carry.
 * This one renders the component, so the assertion crosses every seam the app
 * crosses. That is the whole reason it exists next to the model-level file
 * rather than inside it.
 */

/** The real BBMI 2026 slate: results and multipliers in display order. */
const RESULTS = "aahahhhaahahaa-a";
const MULT = "1111111111111222";
/** The real sheets. Grether takes the 2x game at unit 14; Tyler does not. */
const GRETHER = "hhaaahhaahhhhahh";
const TYLER = "ahhhaahaaaahahhh";

const expand = (c: string) => (c === "a" ? "away" : c === "h" ? "home" : null);

const slate: BoardSlateGame[] = [...RESULTS].map((r, i) => ({
  id: `g${i}`,
  result: expand(r) as BoardSlateGame["result"],
  multiplier: Number(MULT[i]),
  awayTeam: `Away ${i}`,
  homeTeam: `Home ${i}`,
  spread: null,
  kickoff: null,
}));

const sheetOf = (s: string): ScoredPick[] =>
  [...s].flatMap((c, i) => {
    const p = expand(c);
    return p ? [{ slateGameId: `g${i}`, pick: p as "away" | "home", confidence: null }] : [];
  });

function markup() {
  const rows = buildBoardRows(slate, sheetOf(GRETHER), sheetOf(TYLER), false);
  return renderToStaticMarkup(
    <PickemMatchPlayCard
      matchNumber={4}
      aName="Grether"
      bName="Tyler"
      slate={slate}
      rows={rows}
      aColor="#3b82f6"
      bColor="#f97316"
      picked={{ a: true, b: true }}
      mine={false}
      onOpen={() => {}}
    />
  );
}

describe("PickemMatchPlayCard renders the WEIGHTED match", () => {
  /**
   * The lead chip, on the leader's side.
   *
   * NOT "1&2". Pick'em renders under `dialect="slate"`, which deliberately
   * shows the bare lead rather than golf's close-out notation — "&2" counts
   * holes to play and reads as a score line on a slate. The close-out LOGIC is
   * unchanged (`st.closed` is true and `st.margin` is "1&2"); only the notation
   * differs, and this asserts what the screen says.
   *
   * Anchored `>1 UP<` rather than "1 UP": `Margin` renders text only for a side
   * that is `active || square`, so a decided card emits exactly one chip — but
   * the bare pair could sit inside a name, and the anchor cannot.
   */
  it("shows Grether's lead chip, not AS", () => {
    expect(markup()).toContain(">1 UP<");
  });

  /**
   * The failing symptom, asserted directly. `Margin` renders its text only when
   * the side is `active || square`, so an all-square card emits "AS" on BOTH
   * chips and a decided one emits neither. Anchored to `>AS<` rather than "AS"
   * because the bare pair could appear inside a team or player name.
   */
  it("does not render the all-square chip", () => {
    expect(markup()).not.toContain(">AS<");
  });

  /**
   * The centre cell is "F" once the engine considers the match over, and the
   * raw thru-count while it is live. It reads 15 against the unweighted build,
   * so this fails there too — and it is the half that catches a build which
   * gets the leader right at the wrong moment.
   */
  it("shows the match as finished in the centre cell", () => {
    const html = markup();
    expect(html).toContain(">F<");
    // The header word moves with it — "FINAL", not the live "LEFT n".
    expect(html).toContain(">FINAL<");
  });
});
