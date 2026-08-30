import { describe, it, expect } from "vitest";
import { toggleWinLoseTie } from "./NonGolfScoreboard";

/**
 * `NonGolfScoreboard.tsx` owns `trpc.useUtils()` and can't render outside a
 * provider (no test precedent exists for the whole file — see
 * `MatchesScoreboard.test.tsx`'s header for the same situation on its
 * sibling). This covers the one thing worth pinning without a renderer: the
 * tap-again-to-clear rule feedback asked for ("you can't unselect a team in
 * the simple format either").
 */
describe("toggleWinLoseTie — tap-again-to-clear for the Simple win/lose/tie draft", () => {
  it("tapping an undeclared control selects the tapped side", () => {
    expect(toggleWinLoseTie("", "team-a")).toBe("team-a");
    expect(toggleWinLoseTie("", "tie")).toBe("tie");
  });

  it("tapping the ALREADY-selected choice again clears it back to undeclared", () => {
    expect(toggleWinLoseTie("team-a", "team-a")).toBe("");
    expect(toggleWinLoseTie("tie", "tie")).toBe("");
    expect(toggleWinLoseTie("team-b", "team-b")).toBe("");
  });

  it("tapping a DIFFERENT choice switches to it — does not clear", () => {
    expect(toggleWinLoseTie("team-a", "team-b")).toBe("team-b");
    expect(toggleWinLoseTie("team-a", "tie")).toBe("tie");
  });
});
