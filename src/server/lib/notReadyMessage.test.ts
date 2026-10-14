import { describe, it, expect } from "vitest";
import { notReadyMessage, POINT_VALUE_HINT } from "./notReadyMessage";
import { GAME_TYPE_DEFINITIONS, canBeSideGame } from "@/lib/gameTypes";

/**
 * The Save banner's NOT_READY copy. The contract with the DATABASE (the
 * refusal's HINT, migration 214) is pinned in `games.saveConfig.test.ts`
 * against the real refusal; this file pins the choice made on top of it —
 * which formats are offered the side-game route.
 */
const SIDE = "Set a point value, or delete this game and add it again as a side game.";
const PLAIN = "Set a point value before enabling scoring.";
const DB_TEXT = "set a point value before enabling scoring";

describe("notReadyMessage", () => {
  it("offers the side-game route for every format that can BE one, and no other", () => {
    // Driven off the declarations, so a format gaining `side_game` moves into the
    // first list here without this file changing — and a mutant that names
    // formats instead of reading the declaration fails whichever it forgot.
    const ids = Object.keys(GAME_TYPE_DEFINITIONS);
    const side = ids.filter((id) => canBeSideGame(id));
    const notSide = ids.filter((id) => !side.includes(id));
    // Both halves non-empty, or the loops below prove nothing.
    expect(side.length).toBeGreaterThan(0);
    expect(notSide.length).toBeGreaterThan(0);
    for (const id of side) expect(notReadyMessage(DB_TEXT, POINT_VALUE_HINT, id), id).toBe(SIDE);
    for (const id of notSide) expect(notReadyMessage(DB_TEXT, POINT_VALUE_HINT, id), id).toBe(PLAIN);
  });

  it("keys on the CODE, not the sentence (214): the same text without the hint passes through", () => {
    // What the old text-keyed version would have caught; the hint is now the
    // only thing that selects the point-value advice.
    expect(notReadyMessage(DB_TEXT, null, "gtt_match_play")).toBe(DB_TEXT);
    // And a reworded refusal still gets the advice, as long as the code is there.
    expect(notReadyMessage("this game needs points first", POINT_VALUE_HINT, "gtt_match_play")).toBe(SIDE);
  });

  it("an unknown or unread format gets the plain advice, never the side-game route", () => {
    expect(notReadyMessage(DB_TEXT, POINT_VALUE_HINT, null)).toBe(PLAIN);
    expect(notReadyMessage(DB_TEXT, POINT_VALUE_HINT, "gtt_nonexistent")).toBe(PLAIN);
  });

  it("every other refusal passes through untouched, and an empty one gets the generic copy", () => {
    const bracket = "a bracket needs at least two entrants before it can go live. Build the field in this game's settings first.";
    expect(notReadyMessage(bracket, null, "gtt_match_play")).toBe(bracket);
    expect(notReadyMessage(undefined, null, "gtt_match_play")).toBe("Finish setting up this game before switching it to scoring.");
  });
});
