import { describe, it, expect } from "vitest";
import { notReadyMessage, POINT_VALUE_NOT_READY } from "./notReadyMessage";
import { GAME_TYPE_DEFINITIONS } from "@/lib/gameTypes";

/**
 * The Save banner's NOT_READY copy. The contract with the DATABASE's wording is
 * pinned in `games.saveConfig.test.ts` against the real refusal; this file pins
 * the choice made on top of it — which formats are offered the side-game route.
 */
const SIDE = "Set a point value, or delete this game and add it again as a side game.";
const PLAIN = "Set a point value before enabling scoring.";

describe("notReadyMessage", () => {
  it("offers the side-game route for every format that can BE one, and no other", () => {
    // Driven off the declarations, so a format gaining `side_game` moves into the
    // first list here without this file changing — and a mutant that names
    // formats instead of reading the declaration fails whichever it forgot.
    const ids = Object.keys(GAME_TYPE_DEFINITIONS);
    const side = ids.filter((id) => GAME_TYPE_DEFINITIONS[id].allowedContainers.includes("side_game"));
    const notSide = ids.filter((id) => !side.includes(id));
    // Both halves non-empty, or the loops below prove nothing.
    expect(side.length).toBeGreaterThan(0);
    expect(notSide.length).toBeGreaterThan(0);
    for (const id of side) expect(notReadyMessage(POINT_VALUE_NOT_READY, id), id).toBe(SIDE);
    for (const id of notSide) expect(notReadyMessage(POINT_VALUE_NOT_READY, id), id).toBe(PLAIN);
  });

  it("an unknown or unread format gets the plain advice, never the side-game route", () => {
    expect(notReadyMessage(POINT_VALUE_NOT_READY, null)).toBe(PLAIN);
    expect(notReadyMessage(POINT_VALUE_NOT_READY, "gtt_nonexistent")).toBe(PLAIN);
  });

  it("every other refusal passes through untouched, and an empty one gets the generic copy", () => {
    const bracket = "a bracket needs at least two entrants before it can go live. Build the field in this game's settings first.";
    expect(notReadyMessage(bracket, "gtt_match_play")).toBe(bracket);
    expect(notReadyMessage(undefined, "gtt_match_play")).toBe("Finish setting up this game before switching it to scoring.");
  });
});
