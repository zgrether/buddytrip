import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheetRow } from "./PickemSheetRow";
import { SETTLED_DIM } from "./PickemGameCard";
import { PickemRunView } from "./PickemRunView";
import { PickemHeadToHead } from "./PickemHeadToHead";
import { sideMarks, sideNameStyle, sideDecoration } from "./slateRowVisual";
import type { BoardRow } from "@/lib/pickemBoard";

/**
 * THE THREE VIEWING SURFACES SAY THE SAME THINGS IN THE SAME PLACES.
 *
 * ── Why one file and not three ────────────────────────────────────────────
 *
 * Every claim here is about AGREEMENT, and a per-surface test cannot hold one:
 * three files each asserting "my multiplier is bottom-left" all stay green
 * while one of them quietly moves, because nothing compares them. That is
 * CLAUDE.md's composition class — both halves right, the pair wrong — and the
 * only thing that catches it is rendering more than one surface in a single
 * assertion.
 *
 * The fourth surface, the slate BUILDER, is deliberately excluded from the
 * convergence and therefore from this file. It is a pre-game authoring screen
 * with no score, no result and no contention for its top-right corner, and it
 * shares `MatchupLine` with the three that did converge — which is the trap the
 * whole change had to route around, since changing the shared component
 * outright would have moved it too, silently.
 */

const GAME = {
  id: "g1",
  awayTeam: "Toledo Rockets",
  homeTeam: "Michigan State Spartans",
  spread: "-9.5",
  kickoff: "Sat Nov 8, 3:30p",
  note: null,
  multiplier: 2,
};

const boardRow = (over: Partial<BoardRow> = {}): BoardRow => ({
  slateGameId: "g1",
  result: null,
  multiplier: 2,
  aPick: "home",
  bPick: "away",
  aConfidence: null,
  bConfidence: null,
  aPoints: 0,
  bPoints: 0,
  swing: 0,
  zeroKind: null,
  upsideA: 0,
  upsideB: 0,
  ...over,
});

/** Screen C — the picks sheet. */
const picks = (over: Partial<Parameters<typeof PickemSheetRow>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemSheetRow game={GAME} pick={null} points={null} editable onPick={() => {}} {...over} />
  );

/** Screen E — results entry. */
const results = (over: Partial<Parameters<typeof PickemRunView>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemRunView
      slate={[{ ...GAME, result: null }]}
      canEdit
      busyId={null}
      onSetResult={() => {}}
      {...over}
    />
  );

/** Screen D — the head-to-head. */
const matches = (
  slateOver: Record<string, unknown> = {},
  rowOver: Partial<BoardRow> = {}
) =>
  renderToStaticMarkup(
    <PickemHeadToHead
      slate={[{ ...GAME, ...slateOver }]}
      rows={[boardRow(rowOver)]}
      aName="Ada"
      bName="Bo"
      aUserId="u1"
      bUserId="u2"
      avatarFor={() => ({ avatarIcon: null, teamColor: null })}
      matchIndex={1}
      matchCount={1}
      resolved={0}
      picked={{ a: true, b: true }}
      useConfidence
      note="Live"
      onBack={() => {}}
    />
  );

/** One element's OWN opening tag — the only region a style assertion may be
 *  scoped to, since anything wider is the whole document. */
function tag(markup: string, testId: string): string {
  const at = markup.indexOf('data-testid="' + testId + '"');
  if (at === -1) return "";
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

describe("the multiplier is in one place, and it is the same place", () => {
  const surfaces = [
    ["picks", picks()],
    ["results", results()],
    ["matches", matches()],
  ] as const;

  it("draws it inline on the meta line on every one of the three", () => {
    /**
     * THE MUTATION: revert any ONE surface to the pinned corner badge.
     *
     * That surface still renders a multiplier, still renders it legibly, and
     * still passes every per-surface test that asks whether a 2x game is
     * marked. Only the comparison across the three can see it — which is the
     * argument for this file existing.
     */
    for (const [name, html] of surfaces) {
      expect(html, name).toContain('data-testid="pickem-matchup-multiplier-inline"');
      expect(html, name).not.toContain("pickem-matchup-multiplier-slot");
    }
  });

  it("puts it BELOW both team names, which is what bottom-left means here", () => {
    /**
     * Position, not merely presence. The testid could be moved without moving
     * the badge, so this asserts the badge comes after the home line — the two
     * names above it, the date and the note beside it.
     */
    for (const [name, html] of surfaces) {
      const home = html.indexOf('data-testid="pickem-matchup-home-line"');
      const badge = html.indexOf('data-testid="pickem-matchup-multiplier-inline"');
      expect(home, name).toBeGreaterThan(-1);
      expect(badge, name).toBeGreaterThan(home);
    }
  });

  it("draws none at all on an ordinary game, on all three", () => {
    // The other half: a badge that appeared on every row would satisfy both
    // assertions above and say nothing.
    const plain = { ...GAME, multiplier: 1 };
    const all = [
      ["picks", picks({ game: plain })],
      ["results", results({ slate: [{ ...plain, result: null }] })],
      ["matches", matches({ multiplier: 1 }, { multiplier: 1 })],
    ] as const;
    for (const [name, html] of all) {
      expect(html, name).not.toContain("pickem-matchup-multiplier");
    }
  });
});

describe("the winner is bold on all three, and the loser is not", () => {
  /** Home wins 30-10 while laid -24.5: HOME won the game, AWAY covered. */
  const SPLIT = { result: "home" as const, awayScore: 10, homeScore: 30 };

  it("weights the winning name above the losing one, on every surface", () => {
    /**
     * ONE BOLD NAME, EXACTLY ONE, and it is the side that won the GAME —
     * which this round separated from the side that covered.
     *
     * THE MUTATION: derive weight from `result` on any one surface. Here the
     * two agree (home won and home covered), so this case alone cannot catch
     * it — `resultTreatment.test.tsx` holds the split case. What this one
     * holds is that all THREE surfaces answer it the same way, which no
     * per-surface test can say.
     */
    const scored = { ...GAME, ...SPLIT };
    const all = [
      ["picks", picks({ game: scored, result: "home", outcome: "won", pick: "home", editable: false })],
      ["results", results({ slate: [scored] })],
      ["matches", matches(SPLIT, { result: "home" })],
    ] as const;
    for (const [name, html] of all) {
      /**
       * ANCHORED TO THE TWO NAME ELEMENTS' OWN OPENING TAGS.
       *
       * The first version sliced a 900-character window after the home line
       * and looked for `font-weight:700` in it — and it PASSED against a
       * head-to-head with no emphasis at all, because that window also holds
       * the swing cell and two confidence chips, which are bold for their own
       * reasons. A substring assertion is scoped to the document, not to the
       * thing you are looking at; the tag is the only region that is.
       */
      expect(tag(html, "pickem-matchup-away"), name + " away").not.toContain("font-weight:700");
      expect(tag(html, "pickem-matchup-home"), name + " home").toContain("font-weight:700");
    }
  });
});

describe("a losing pick is STRUCK, because teal alone said the opposite", () => {
  /**
   * The bug, stated plainly: the sheet painted the side you took teal and left
   * it teal forever. Teal is this app's yes — the selected segment, the banked
   * chip, the live pill — so a wrong pick on a settled sheet read as a right
   * one. Not three surfaces disagreeing; one surface asserting something false.
   */
  const wrong = picks({ game: GAME, result: "home", outcome: "lost", pick: "away", editable: false });
  const right = picks({ game: GAME, result: "home", outcome: "won", pick: "home", editable: false });

  const nameSpan = (html: string, side: "away" | "home") =>
    tag(html, "pickem-matchup-" + side + "-name");

  it("draws a line through the side that was taken and lost", () => {
    expect(nameSpan(wrong, "away")).toContain("line-through");
  });

  it("draws no line through a pick that won", () => {
    /**
     * The half that makes the first one mean something. A build that struck
     * EVERY pick would pass the assertion above and be a worse lie than the one
     * being fixed.
     */
    expect(nameSpan(right, "home")).not.toContain("line-through");
  });

  it("strikes only YOUR side, never the contest", () => {
    // One strike means your bet; two mean the game was cancelled. The
    // difference has to be legible without knowing the rule, so the winning
    // name on a lost row must stay unstruck.
    expect(nameSpan(wrong, "home")).not.toContain("line-through");
  });

  it("strikes BOTH names on a cancellation, which is the other statement", () => {
    const cancelled = picks({
      game: GAME,
      result: "cancelled",
      outcome: "void",
      pick: "away",
      editable: false,
    });
    expect(nameSpan(cancelled, "away")).toContain("line-through");
    expect(nameSpan(cancelled, "home")).toContain("line-through");
  });

  it("keeps the accent on the pick either way, so a shut row still says what you took", () => {
    /**
     * The strike REPLACES nothing. Losing the accent would fix the false
     * positive by deleting the information — a closed locked row would stop
     * saying which side you had, which is the thing that made collapsing by
     * default honest in the first place.
     */
    const took = (result: "away" | "home") =>
      sideNameStyle(sideMarks("away", { result, awayScore: 30, homeScore: 10, pick: "away" }));
    expect(took("away").color).toBe("var(--color-bt-accent)");
    expect(took("home").color).toBe("var(--color-bt-accent)");
    // ...and the weight still answers its own question, not this one.
    expect(took("home").fontWeight).toBe(700);
  });

  it("maps the four combinations, and no two of them render alike", () => {
    /**
     * The decision table, over the ONE derivation all three surfaces call.
     * The mutation that matters is a MERGE — dropping the strike so a lost
     * pick renders as a won one is the original bug — so the last assertion
     * is that the four settled shapes are four distinct paint jobs.
     */
    const m = (side: "away" | "home", pick: "away" | "home" | null, result: "away" | "home") =>
      sideMarks(side, { result, pick, awayScore: 30, homeScore: 10 });

    // Away won the game 30-10 throughout, so weight is constant and the
    // varying marks are the ones this table is about.
    expect(m("away", "away", "away")).toMatchObject({ chosen: true, covered: true, struck: false });
    expect(m("away", "away", "home")).toMatchObject({ chosen: true, covered: false, struck: true });
    expect(m("away", "home", "away")).toMatchObject({ chosen: false, covered: true, struck: false });
    expect(m("away", "home", "home")).toMatchObject({ chosen: false, covered: false, struck: false });

    // Unplayed: nothing is decided, so only the pick has anything to say.
    const open = sideMarks("away", { result: null, pick: "away" });
    expect(open).toMatchObject({ chosen: true, covered: false, struck: false, wonGame: false });

    // A push happened and nobody covered: your pick STOOD, so no strike and
    // no box. Only a cancellation strikes a name you did not take.
    expect(sideMarks("away", { result: "push", pick: "away" })).toMatchObject({
      chosen: true,
      covered: false,
      struck: false,
    });
    expect(sideMarks("home", { result: "cancelled", pick: "away" }).struck).toBe(true);

    const four = [
      m("away", "away", "away"),
      m("away", "away", "home"),
      m("away", "home", "away"),
      m("away", "home", "home"),
    ];
    const painted = four.map((x) =>
      JSON.stringify({ ...sideNameStyle(x), ...sideDecoration(x), boxed: x.covered })
    );
    expect(new Set(painted).size, "two settled states render identically").toBe(4);
  });
});

describe("a game with no score renders exactly as it did before scores existed", () => {
  /**
   * The standing rule, at the surface. Most games carry no score for most of a
   * weekend — manual entry is optional and always will be — so absent is the
   * COMMON case and a build that rendered it as 0-0, or as a dash, or as a
   * reserved empty column, would be wrong on nearly every row.
   */
  const noScore = [
    ["picks", picks({ game: GAME, result: "home", outcome: "won", pick: "home", editable: false })],
    ["results", results({ slate: [{ ...GAME, result: "home" }] })],
    ["matches", matches({ result: "home" }, { result: "home" })],
  ] as const;

  it("renders no score element on any surface", () => {
    for (const [name, html] of noScore) {
      expect(html, name).not.toContain("pickem-score-away");
      expect(html, name).not.toContain("pickem-score-home");
    }
  });

  it("renders one when both numbers are there", () => {
    // Absence of matches is absence of search: without this, the assertions
    // above would pass against a build that never renders a score at all.
    const scored = { ...GAME, result: "home" as const, awayScore: 17, homeScore: 24 };
    expect(picks({ game: scored, result: "home", outcome: "won", pick: "home", editable: false }))
      .toContain('data-testid="pickem-score-away"');
    expect(matches({ result: "home", awayScore: 17, homeScore: 24 }, { result: "home" })).toContain(
      'data-testid="pickem-score-home"'
    );
  });

  it("shows nothing while picks are still OPEN, even if a score is stored", () => {
    /**
     * An editable sheet has not been played. A score beside a team you are
     * still choosing between asserts an outcome the row exists to precede — and
     * the caller is what enforces it, so this is the assertion that the gate is
     * actually wired rather than merely intended.
     */
    const open = picks({ game: { ...GAME, awayScore: null, homeScore: null }, editable: true });
    expect(open).not.toContain("pickem-score-away");
  });
});

describe("the score fields are absent for a reader who cannot write one", () => {
  it("offers no boxes without a handler", () => {
    // ABSENT, never disabled — the rule the segments already follow. Two empty
    // boxes nobody can fill are a control that lies about what is on offer.
    expect(results()).not.toContain("pickem-run-score-away");
  });

  it("offers them, empty, when there is one", () => {
    const html = results({ onSetScore: () => {} });
    expect(html).toContain('data-testid="pickem-run-score-away"');
    expect(html).toContain('data-testid="pickem-run-score-home"');
    /**
     * EMPTY, not "0". The box is the last place the absent/zero distinction can
     * be lost, and losing it here would put a 0 in front of the runner that
     * they would reasonably leave alone — writing a scoreless tie onto every
     * game nobody scored, by way of a default nobody typed.
     */
    expect(html).toContain('value=""');
    expect(html).not.toContain('value="0"');
  });

  it("labels each box with its own team, so the pair cannot be transposed", () => {
    // The convention is visitor-first and a runner transposes it exactly once
    // before they stop trusting the page. The names are the labels.
    const html = results({ onSetScore: () => {} });
    expect(html).toContain('aria-label="Toledo Rockets score"');
    expect(html).toContain('aria-label="Michigan State Spartans score"');
  });

  it("uses the numeric keypad rather than a spinner", () => {
    // Matched case-insensitively: React SSR emits the JSX casing verbatim here
    // and the DOM lowercases it, so pinning either spelling would be pinning
    // the renderer rather than the attribute.
    expect(results({ onSetScore: () => {} }).toLowerCase()).toContain('inputmode="numeric"');
  });
});

describe("the two marks compose on the row a spread exists for", () => {
  /**
   * THE CASE THE ROUND IS ABOUT, asserted on the PICKS surface because that is
   * where all four marks can appear at once.
   *
   * Home is laid -24.5 and wins 30-10: home WON THE GAME and AWAY COVERED. The
   * reader took home — so they watched their team win and lost the pick'em.
   */
  const SPLIT = { ...GAME, spread: "-24.5", awayScore: 10, homeScore: 30 };
  const html = picks({
    game: SPLIT,
    result: "away",
    outcome: "lost",
    pick: "home",
    editable: false,
  });

  it("boxes the coverer while bolding the winner — different sides, one row", () => {
    /**
     * THE MUTATION the spec names: box the bold side. It is the natural
     * implementation, it agrees with a correct build on every game where the
     * winner covered, and it is wrong on exactly the games a spread exists for.
     */
    expect(tag(html, "pickem-matchup-away"), "away is boxed").toContain('data-covered="true"');
    expect(tag(html, "pickem-matchup-home-line"), "home is not").toContain('data-covered="false"');
    expect(tag(html, "pickem-matchup-home"), "home is bold").toContain("font-weight:700");
    expect(tag(html, "pickem-matchup-away"), "away is not").not.toContain("font-weight:700");
  });

  it("strikes the losing pick WHILE the other side carries the box", () => {
    /**
     * THE MUTATION: drop the strike because the box already marks the winner.
     * That build loses "what did I pick", which is the information a shut
     * locked row depends on — and the box does not carry it, because the box
     * is about the runner's call and not about this reader's sheet.
     *
     * Both halves asserted on ONE render, so a build cannot satisfy either by
     * sacrificing the other.
     */
    expect(tag(html, "pickem-matchup-home-name")).toContain("line-through");
    expect(tag(html, "pickem-matchup-away")).toContain('data-covered="true"');
    // ...and the struck name keeps its teal, so the row still says what was
    // taken rather than only that it failed.
    expect(tag(html, "pickem-matchup-home")).toContain("var(--color-bt-accent)");
  });
});

describe("a push draws no box, on any surface", () => {
  it("leaves both sides unboxed wherever a contest is drawn", () => {
    // Nobody covered, so there is nothing to wrap. The scoreboard still has a
    // winner and still says so — the two marks are independent.
    const PUSHED = { ...GAME, awayScore: 24, homeScore: 17 };
    const all = [
      ["picks", picks({ game: PUSHED, result: "push", outcome: "void", pick: "away", editable: false })],
      ["results", results({ slate: [{ ...PUSHED, result: "push" }] })],
      ["matches", matches({ result: "push", awayScore: 24, homeScore: 17 }, { result: "push" })],
    ] as const;
    for (const [name, markup] of all) {
      expect(markup, name).not.toContain('data-covered="true"');
      // ...and not by rendering no rows at all.
      expect(markup, name + " rendered").toContain('data-covered="false"');
    }
  });
});

describe("the fade says ABSENCE, not settlement", () => {
  /**
   * The rule: fade what has no content, not what is finished.
   *
   * Every settled row used to fade to 0.38, on the reading that a dealt-with row
   * should recede. That stopped being true when the settled row became the
   * INFORMATIVE one — the score, both sides of the line, the winner by weight
   * and the cover box all arrive only once a game is over, and the fade put the
   * newest information behind the heaviest treatment on the page.
   *
   * A NOT PICKED row is the opposite: no pick to read, no stake to weigh, and
   * everything on it is context for a decision nobody made. Fading that says
   * something true.
   *
   * ── Why this guard did not exist before ─────────────────────────────────
   *
   * `PickemSheet.test.tsx`'s "DARKENS the row it stamps" compares an unpicked
   * row against a PICKED one — whose game, in that fixture, has no result. So it
   * passed identically before and after this change: its control row was never
   * settled, and the distinction it appeared to be making was one it could not
   * see. The two cases below differ only in `outcome`, which is the axis the
   * rule turns on.
   */
  const settled = { game: GAME, result: "home" as const, editable: false };

  it("does NOT fade a settled row somebody picked", () => {
    /**
     * THE MUTATION: `settled={outcome != null}`, which is the build this
     * replaces. It renders the same row with the same marks — the box, the
     * bold, the strike are all still there, at 38% of their contrast.
     */
    const html = picks({ ...settled, outcome: "won", pick: "home" });
    expect(html).not.toContain(`opacity:${SETTLED_DIM}`);
    // ...and it is a settled row, not an unplayed one rendering by accident.
    expect(html).toContain('data-covered="true"');
  });

  it("does not fade a LOST row either — a wrong pick is still information", () => {
    expect(picks({ ...settled, outcome: "lost", pick: "away" })).not.toContain(
      `opacity:${SETTLED_DIM}`
    );
  });

  it("STILL fades a row nobody picked", () => {
    // The other half. A build that simply deleted the fade would pass both
    // assertions above and lose the one case where fading is honest.
    const html = picks({ ...settled, outcome: "unpicked", pick: null });
    expect(html).toContain(`opacity:${SETTLED_DIM}`);
  });

  it("keeps the NOT PICKED stamp out of the fade it triggers", () => {
    // Opacity multiplies, so a stamp inside the faded subtree cannot be made
    // legible from within it — and every row this stamp appears on is faded.
    const html = picks({ ...settled, outcome: "unpicked", pick: null });
    const content = html.indexOf('data-testid="pickem-card-content"');
    const badge = html.indexOf('data-testid="pickem-card-badge"');
    expect(badge).toBeGreaterThan(content);
    const inner = html.slice(content, badge);
    expect(inner).not.toContain("pickem-row-not-picked");
  });
});
