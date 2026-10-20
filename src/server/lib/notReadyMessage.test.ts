import { describe, it, expect } from "vitest";
import { notReadyMessage, POINT_VALUE_HINT } from "./notReadyMessage";

/**
 * The Save banner's NOT_READY copy. The contract with the DATABASE (the
 * refusal's HINT, migration 214) is pinned in `games.saveConfig.test.ts`
 * against the real refusal. WHEN the side-game exit is open is
 * `sideGameExitOpen`'s question, tested through the router in
 * `games.saveConfig.leaveCompetition.test.ts`; this file pins the sentence
 * chosen for each answer.
 */
const SIDE = "Set a point value, or play it as a side game.";
const PLAIN = "Set a point value before enabling scoring.";
const DB_TEXT = "set a point value before enabling scoring";

describe("notReadyMessage", () => {
  it("names the side-game exit only when it is open", () => {
    expect(notReadyMessage(DB_TEXT, POINT_VALUE_HINT, true)).toBe(SIDE);
    expect(notReadyMessage(DB_TEXT, POINT_VALUE_HINT, false)).toBe(PLAIN);
  });

  it("keys on the CODE, not the sentence (214): the same text without the hint passes through", () => {
    expect(notReadyMessage(DB_TEXT, null, true)).toBe(DB_TEXT);
    // And a reworded refusal still gets the advice, as long as the code is there.
    expect(notReadyMessage("this game needs points first", POINT_VALUE_HINT, true)).toBe(SIDE);
  });

  it("every other refusal passes through untouched, and an empty one gets the generic copy", () => {
    const bracket = "a bracket needs at least two entrants before it can go live. Build the field in this game's settings first.";
    expect(notReadyMessage(bracket, null, true)).toBe(bracket);
    expect(notReadyMessage(undefined, null, false)).toBe("Finish setting up this game before switching it to scoring.");
  });
});
