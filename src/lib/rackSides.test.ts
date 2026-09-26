import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { rackSides } from "@/lib/rackNStack";

/**
 * Ruling 12 (PR 4): rack's two sides are the competition's two teams, answered
 * ONCE (`rackSides`) for the finalize, the board's projection and the rack
 * screen.
 *
 * ── Why the second half is a SOURCE check, and what that is worth ─────────
 *
 * The three paths used to pick "the two teams" three ways (every roster
 * assignment sorted by id; the game's participants' teams sorted by id; the
 * cup's team list in creation order). Since PR 4 a head-to-head cup is exactly
 * two teams and every participant is rostered on one, so in every state the app
 * can produce the three agreed on WHICH two teams and differed only in which was
 * A — and `computeRack` is symmetric in A and B. No behavioural test can tell the
 * old paths from the new one, because nothing reachable separates them.
 *
 * So the instrument is the source: each path must call `rackSides`, and neither
 * server path may keep its private derivation. That is the only check that can
 * fail here, and it is deliberately the whole claim — not a weaker stand-in for
 * a behavioural one that does not exist. Its red proof is restoring any one of
 * the three derivations.
 */

describe("rackSides — the cup's two teams, or nothing", () => {
  it("two teams → sides A and B, in the order given", () => {
    expect(rackSides(["blue", "red"])).toEqual({ A: "blue", B: "red" });
  });

  it.each([[[]], [["blue"]], [["blue", "red", "green"]]])("%j → null: not a two-team cup", (teams) => {
    expect(rackSides(teams)).toBeNull();
  });
});

const PATHS = {
  finalize: "../server/lib/rackNStack.ts",
  projection: "../server/lib/liveProjection.ts",
  screen: "../components/games/RackGameView.tsx",
} as const;

describe("every rack path takes its sides from rackSides", () => {
  it.each(Object.entries(PATHS))("%s calls rackSides", (_name, rel) => {
    expect(readFileSync(resolve(__dirname, rel), "utf8")).toContain("rackSides(");
  });

  // The old private derivation, shared by both server paths: the distinct team
  // ids of whoever was mapped, sorted — a pick that follows the ROSTER rather
  // than the cup.
  it.each([PATHS.finalize, PATHS.projection])("%s keeps no private derivation of the two teams", (rel) => {
    expect(readFileSync(resolve(__dirname, rel), "utf8")).not.toContain(".values()])].sort()");
  });
});
