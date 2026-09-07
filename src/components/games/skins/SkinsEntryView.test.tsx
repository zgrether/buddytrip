import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkinsEntryView } from "./SkinsEntryView";
import { SkinsBoard } from "./SkinsBoard";
import { SkinsScorecard } from "./SkinsScorecard";
import { tallySkins, computeSkinsStandings, skinsPerGrouping, type SkinsOutcomeRow } from "@/lib/skins";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { Participant } from "../types";

/**
 * The three skins surfaces, rendered via react-dom/server (node env).
 *
 * ── Every assertion anchors to a `data-testid`, and that is not a formality ─
 *
 * CLAUDE.md records five separate cases where a substring assertion passed
 * against a build that was broken — an em-dash matched by a row's own sub-title,
 * `">16<"` matched by the PAR row, `data-name-step="2"` supplied by a card
 * nested inside the component under test. The strings here are worse haystacks
 * than any of those: this is a screen made almost entirely of small integers,
 * and `4` appears as a hole number, a par, a yardage and a pot on the same
 * render. So nothing matches a bare value — every check reads an attribute only
 * the cell in question emits.
 */

const GFH3: GloriousConfig = { enabled: true, n: 3 };

const ANN: Participant = { id: "u_ann", name: "Ann", color: "#4ade80" };
const BEN: Participant = { id: "u_ben", name: "Ben", color: "#fb923c" };
const CAL: Participant = { id: "u_cal", name: "Cal", color: "#60a5fa" };

const units18 = Array.from({ length: 18 }, (_, i) => ({ label: String(i + 1), par: 4 }));

const won = (hole: number, winnerId: string): SkinsOutcomeRow => ({ hole, result: "won", winnerId });
const tied = (hole: number): SkinsOutcomeRow => ({ hole, result: "tied", winnerId: null });
const allWonThrough = (upTo: number, who: string) =>
  Array.from({ length: upTo }, (_, i) => won(i + 1, who));

function renderEntry(
  rows: SkinsOutcomeRow[],
  hole: number,
  glorious: GloriousConfig = GFH3,
  extra: Partial<Parameters<typeof SkinsEntryView>[0]> = {}
) {
  return renderToStaticMarkup(
    <SkinsEntryView
      gameName="Skins"
      units={units18}
      grouping={{ id: "g1", name: "Group 1", players: [ANN, BEN, CAL] }}
      rows={rows}
      onChange={() => {}}
      currentHole={hole}
      glorious={glorious}
      {...extra}
    />
  );
}

/** The pot the banner rendered, read off the attribute only it emits. */
function bannerPot(html: string): number | null {
  const m = html.match(/data-skins-pot="(\d+)"/);
  return m ? Number(m[1]) : null;
}

describe("SkinsEntryView — the pot banner is forward-looking", () => {
  it("says what hole 17 is worth BEFORE anything is entered on it", () => {
    /**
     * The requirement in one case. 16 was tied, 17 has not been played, and the
     * banner has to say 4 — a hole nobody has touched.
     *
     * A banner that only reported settled holes passes every other case in this
     * file and fails this one, which is the whole reason it is written as an
     * unplayed hole rather than as a completed round.
     */
    const html = renderEntry([...allWonThrough(15, ANN.id), tied(16)], 17);
    expect(bannerPot(html)).toBe(4);
    expect(html).toContain('data-testid="skins-pot-live"');
  });

  it("an ordinary hole with nothing carried says its own value", () => {
    // The control. Without it, a banner hardcoded to a carried figure would pass
    // the case above.
    expect(bannerPot(renderEntry([], 3))).toBe(1);
    // …and a glorious hole says 2 on its own, with no carry involved.
    expect(bannerPot(renderEntry([], 17))).toBe(2);
  });

  it("a tied hole reports where the pot WENT, not what the hole was worth", () => {
    const html = renderEntry([...allWonThrough(15, ANN.id), tied(16)], 16);
    expect(html).toContain('data-testid="skins-pot-pushed"');
    expect(html).not.toContain('data-testid="skins-pot-live"');
  });

  it("a tied FINAL hole says the pot is gone — a different sentence, not the same one", () => {
    /**
     * The same number, 6, means two things: on 17 it is what 18 is playing for,
     * and on a tied 18 it is what nobody will be paid. The banner has to
     * separate them because the value cannot, and this pair is what makes that
     * testable — a build with one "pushed" sentence passes the case above and
     * fails here.
     */
    const rows = [...allWonThrough(15, ANN.id), tied(16), tied(17), tied(18)];
    const dead = renderEntry(rows, 18);
    expect(dead).toContain('data-testid="skins-pot-dead"');
    expect(dead).not.toContain('data-testid="skins-pot-pushed"');

    const live = renderEntry([...allWonThrough(15, ANN.id), tied(16), tied(17)], 17);
    expect(live).toContain('data-testid="skins-pot-pushed"');
    expect(live).not.toContain('data-testid="skins-pot-dead"');
  });
});

describe("SkinsEntryView — the choice list", () => {
  it("offers every player in the grouping, plus Tied", () => {
    // N choices, not two. A view that assumed a pair would render one or two of
    // these and this is the case that says so.
    const html = renderEntry([], 1);
    for (const p of [ANN, BEN, CAL]) {
      expect(html, `${p.name} has no choice row`).toContain(`data-testid="skins-choice-${p.id}"`);
    }
    expect(html).toContain('data-testid="skins-choice-tied"');
  });

  it("grows with the grouping rather than being fixed at three", () => {
    const four = renderToStaticMarkup(
      <SkinsEntryView
        gameName="Skins"
        units={units18}
        grouping={{ id: "g1", name: "Group 1", players: [ANN, BEN, CAL, { id: "u_dee", name: "Dee", color: "#f472b6" }] }}
        rows={[]}
        onChange={() => {}}
        currentHole={1}
      />
    );
    expect(four).toContain('data-testid="skins-choice-u_dee"');
  });

  it("the Tied row names its consequence before it is chosen", () => {
    // "Carries 4 to hole 17" is the only place the cost of a tie is stated in
    // advance. Anchored on the pot attribute plus the row's own testid rather
    // than on the sentence, so the copy can change without the guard going quiet.
    const html = renderEntry([...allWonThrough(15, ANN.id), tied(16)], 17);
    const tiedRow = html.slice(html.indexOf('data-testid="skins-choice-tied"'));
    expect(tiedRow).toContain("Carries 4 to hole 18");
  });

  it("…and on the LAST hole says the opposite thing", () => {
    const html = renderEntry([...allWonThrough(17, ANN.id)], 18);
    const tiedRow = html.slice(html.indexOf('data-testid="skins-choice-tied"'));
    expect(tiedRow).toContain("Nobody is paid");
  });

  it("read-only renders no commit bar and no clear", () => {
    const html = renderEntry([], 1, GFH3, { readOnly: true });
    expect(html).not.toContain('data-testid="skins-ok"');
    expect(html).not.toContain('data-testid="skins-clear-hole"');
  });
});

describe("SkinsBoard", () => {
  function renderBoard(rowsByGrouping: Record<string, SkinsOutcomeRow[]>) {
    const tallies = tallySkins(["A", "B"], rowsByGrouping, 18, GFH3);
    const standings = computeSkinsStandings(
      [
        { userId: ANN.id, groupingId: "A" },
        { userId: BEN.id, groupingId: "A" },
        { userId: CAL.id, groupingId: "B" },
      ],
      tallies
    );
    return renderToStaticMarkup(
      <SkinsBoard
        rows={standings}
        participants={[ANN, BEN, CAL]}
        tallies={tallies}
        groupNames={{ A: "A Flight", B: "B Flight" }}
        perGrouping={skinsPerGrouping(18, GFH3)}
      />
    );
  }

  it("every row says which group it was competing in", () => {
    /**
     * The board's whole problem: four independent contests in one ordering. A
     * row without its group is a comparison between people who never met, so the
     * chip is not decoration — it is what makes the single ordering honest.
     */
    const html = renderBoard({ A: [won(1, ANN.id)], B: [won(1, CAL.id)] });
    for (const p of [ANN, BEN, CAL]) {
      expect(html, `${p.name} has no group chip`).toContain(`data-testid="skins-group-chip-${p.id}"`);
    }
    const annChip = html.slice(html.indexOf(`data-testid="skins-group-chip-${ANN.id}"`));
    expect(annChip).toContain("A Flight");
  });

  it("a live carry and a dead pot read differently on the group strip", () => {
    const live = renderBoard({ A: [...allWonThrough(15, ANN.id), tied(16)], B: [] });
    expect(live.slice(live.indexOf('data-testid="skins-pot-state-A"'))).toContain("on hole 17");

    const dead = renderBoard({
      A: [...allWonThrough(15, ANN.id), tied(16), tied(17), tied(18)],
      B: [],
    });
    expect(dead.slice(dead.indexOf('data-testid="skins-pot-state-A"'))).toContain("unpaid");
  });

  it("a player in a group that has not started shows a dash, not a zero", () => {
    /**
     * Same number, two facts: Ben has won nothing across a played hole, Cal's
     * group has not begun. Under a count, 0 is a real score and "not started" is
     * not — rendering them identically is the empty-is-not-unknown mistake at the
     * display layer.
     */
    const html = renderBoard({ A: [won(1, ANN.id)], B: [] });
    const benCell = html.slice(html.indexOf(`data-testid="skins-count-${BEN.id}"`));
    const calCell = html.slice(html.indexOf(`data-testid="skins-count-${CAL.id}"`));
    expect(benCell.slice(0, 60)).toContain(">0<");
    expect(calCell.slice(0, 60)).toContain("—");
  });
});

describe("SkinsScorecard", () => {
  function renderCard(rows: SkinsOutcomeRow[]) {
    return renderToStaticMarkup(
      <SkinsScorecard
        units={units18}
        players={[ANN, BEN, CAL]}
        rows={rows}
        groupingId="g1"
        glorious={GFH3}
      />
    );
  }

  it("marks the winner's cell with a COUNT chip — no direction arrow", () => {
    /**
     * The spec's §5, and the reason it is a separate component: `LeadPill` is a
     * number plus ▲, which asserts a direction and an opponent. A skin is a
     * count. Asserting the arrow's ABSENCE would pass against a card that
     * rendered nothing at all, so both halves are checked.
     */
    const html = renderCard([won(1, ANN.id)]);
    expect(html).toContain(`data-testid="skins-card-won-${ANN.id}-1"`);
    expect(html).toContain('data-testid="skins-count-pill"');
    expect(html).not.toContain('data-testid="outcome-lead-pill"');
    expect(html).not.toContain("▲");
  });

  it("a pushed hole is marked on the push row; an unplayed one is blank there", () => {
    // The distinction the format turns on, at the one place both states are
    // visible side by side.
    const html = renderCard([tied(1)]);
    expect(html).toContain('data-testid="skins-card-push-1"');
    expect(html).not.toContain('data-testid="skins-card-push-2"');
  });

  it("a carried pot is paid to whoever takes the next hole, in one chip", () => {
    const html = renderCard([...allWonThrough(15, ANN.id), tied(16), won(17, BEN.id)]);
    const cell = html.slice(html.indexOf(`data-testid="skins-card-won-${BEN.id}-17"`));
    // 17's own 2 plus 16's whole pot of 2. Read off the pill's own `data-count`
    // rather than by matching ">4<" in the region: this card renders hole
    // numbers, par and yardage as bare integers, so a substring over it would be
    // satisfied by markup that has nothing to do with the pot.
    expect(cell.slice(0, 400)).toContain('data-count="4"');
  });

  it("only a DEAD pot is printed in the total column", () => {
    const live = renderCard([...allWonThrough(15, ANN.id), tied(16)]);
    const dead = renderCard([...allWonThrough(15, ANN.id), tied(16), tied(17), tied(18)]);
    expect(live).not.toContain('data-testid="skins-card-dead-pot"');
    expect(dead).toContain('data-testid="skins-card-dead-pot"');
    expect(dead.slice(dead.indexOf('data-testid="skins-card-unpaid"')).slice(0, 60)).toContain(">6<");
  });

  it("player totals are the skins they won", () => {
    const html = renderCard([won(1, ANN.id), won(2, ANN.id), won(3, BEN.id)]);
    expect(html.slice(html.indexOf(`data-testid="skins-card-total-${ANN.id}"`)).slice(0, 60)).toContain(">2<");
    expect(html.slice(html.indexOf(`data-testid="skins-card-total-${BEN.id}"`)).slice(0, 60)).toContain(">1<");
    expect(html.slice(html.indexOf(`data-testid="skins-card-total-${CAL.id}"`)).slice(0, 60)).toContain(">0<");
  });
});

/** A no-glorious round is the plain case, and it must still work. */
describe("without the modifier", () => {
  it("every hole is worth 1 and the round pays 18", () => {
    expect(bannerPot(renderEntry([], 17, NO_GLORIOUS))).toBe(1);
    expect(skinsPerGrouping(18, NO_GLORIOUS)).toBe(18);
  });
});
