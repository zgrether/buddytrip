import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { finishSheetStep, settingsTies, type FinishStep } from "./cupDecision";

/**
 * The two decision gates of a points cup's Final (spec §5, v2.8): who gets the
 * finish sheet, and when ⚙ offers Tiebreaks. The functions are the gates; the
 * source checks at the end hold that the board and the face actually use them,
 * since no node test renders either.
 */

const open = { canEdit: true, awaitingFinish: true, openedAt: null, closedThisVisit: false, boardShown: true, boardUncovered: true } as const;

/** Every combination of everything but the role. */
function everyState() {
  const out: Parameters<typeof finishSheetStep>[0][] = [];
  const bools = [true, false];
  const steps: (FinishStep | null)[] = [null, "ask", "ties"];
  for (const awaitingFinish of bools)
    for (const openedAt of steps)
      for (const closedThisVisit of bools)
        for (const boardShown of bools)
          for (const boardUncovered of bools) out.push({ canEdit: false, awaitingFinish, openedAt, closedThisVisit, boardShown, boardUncovered });
  return out;
}

describe("the finish sheet", () => {
  it("a Member never gets it, in any state of the board, the visit, or the screen", () => {
    const states = everyState();
    expect(states).toHaveLength(48);
    expect(states.map(finishSheetStep).filter((s) => s !== null)).toEqual([]);
  });

  it("CONTROL: an Owner or Organizer arriving at a waiting cup gets the ask", () => {
    expect(finishSheetStep(open)).toBe("ask");
  });

  it("it waits for the board to be on screen and not under a game", () => {
    expect(finishSheetStep({ ...open, boardShown: false })).toBeNull();
    expect(finishSheetStep({ ...open, boardUncovered: false })).toBeNull();
  });

  it("closed this visit, it stays closed; the card's button still opens it at a step", () => {
    expect(finishSheetStep({ ...open, closedThisVisit: true })).toBeNull();
    expect(finishSheetStep({ ...open, closedThisVisit: true, openedAt: "ties" })).toBe("ties");
  });

  it("nothing waiting, nothing open, even from the card", () => {
    expect(finishSheetStep({ ...open, awaitingFinish: false })).toBeNull();
    expect(finishSheetStep({ ...open, awaitingFinish: false, openedAt: "ties" })).toBeNull();
  });
});

describe("⚙ Tiebreaks", () => {
  const ties = [{ place: 1 }, { place: 3 }];

  it("a tied cup before Final offers nothing: its ties belong to the finish's tie step", () => {
    expect(settingsTies({ final: false, ties })).toEqual([]);
  });

  it("CONTROL: the same ties at Final are offered", () => {
    expect(settingsTies({ final: true, ties })).toEqual(ties);
  });

  it("no clinch (a head-to-head Cup, or no board yet) offers nothing", () => {
    expect(settingsTies(null)).toEqual([]);
    expect(settingsTies(undefined)).toEqual([]);
  });
});

describe("the components use these gates", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the board opens the sheet only through finishSheetStep, with the viewer's role", () => {
    const board = src("src/components/competition/CompetitionLeaderboard.tsx");
    expect(board).toMatch(/const finishStep = finishSheetStep\(\{\s*canEdit,/);
    expect(board).toMatch(/\{finishStep && data\.clinch && \(\s*<FinishCupSheet/);
    expect(board.match(/<FinishCupSheet\b/g)).toHaveLength(1);
  });

  it("the Cup face's canEdit is Owner or Organizer, so a Member's is false", () => {
    expect(src("src/components/competition/LiveFaceClient.tsx")).toContain('const canEdit = role === "owner" || role === "organizer";');
  });

  it("the gear's ties come only through settingsTies", () => {
    expect(src("src/components/competition/CompetitionFace.tsx")).toContain("const ties = settingsTies(boardForTies.data?.clinch) as SharedTie[];");
  });
});
