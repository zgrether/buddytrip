import { describe, it, expect } from "vitest";
import { outcomeOverwriteNotice } from "./outcomeOverwriteNotice";

/** #1437 — the notice's words: what the hole is now, named by the sides. */

const m1 = { label: "Match 1", aName: "Fake Grether", bName: "Frank" };

describe("outcomeOverwriteNotice", () => {
  it("names a halve", () => {
    expect(outcomeOverwriteNotice({ matchId: "m1", hole: 3, to: "halved" }, m1, 1)).toBe("Hole 3 changed to Halved");
  });

  it("names the winner of a won hole — each side", () => {
    expect(outcomeOverwriteNotice({ matchId: "m1", hole: 2, to: "side_b" }, m1, 1)).toBe("Hole 2 changed — Frank won it");
    expect(outcomeOverwriteNotice({ matchId: "m1", hole: 2, to: "side_a" }, m1, 1)).toBe(
      "Hole 2 changed — Fake Grether won it",
    );
  });

  it("says a cleared hole was cleared", () => {
    expect(outcomeOverwriteNotice({ matchId: "m1", hole: 4, to: null }, m1, 1)).toBe("Hole 4 was cleared");
  });

  it("names the match only when there is more than one — 'Hole 3' is ambiguous exactly then", () => {
    expect(outcomeOverwriteNotice({ matchId: "m1", hole: 3, to: "halved" }, m1, 2)).toBe(
      "Match 1, hole 3 changed to Halved",
    );
  });

  it("still says something when the match cannot be found — never an empty toast", () => {
    expect(outcomeOverwriteNotice({ matchId: "gone", hole: 5, to: "side_a" }, undefined, 1)).toBe("Hole 5 changed");
  });
});
