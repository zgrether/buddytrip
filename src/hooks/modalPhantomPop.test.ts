import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { shouldPopPhantom } from "./useModalBackButton";

/**
 * The bug this file exists for: tapping "Start round" / "Resume round" on a
 * dashboard Quick Game tile did nothing.
 *
 * The sheet holds a phantom history entry so Android back closes it. Committing
 * unmounted the sheet, whose cleanup calls `history.back()` — which raced the
 * router's own (asynchronous) history write and undid the navigation. Nothing
 * errored; the button simply had no effect.
 */
describe("shouldPopPhantom", () => {
  const OURS = { modal: true };

  it("pops when the sheet was dismissed and its entry is still current", () => {
    expect(shouldPopPhantom({ closedByBack: false, consumed: false, historyState: OURS })).toBe(true);
  });

  it("does NOT pop once a navigation has taken the entry", () => {
    // The regression. `consumed` is the ONLY thing standing between the fix and
    // the bug here: the entry is still ours (the router has not written its own
    // state yet), which is precisely the window the race happened in.
    expect(shouldPopPhantom({ closedByBack: true, consumed: true, historyState: OURS })).toBe(false);
    expect(shouldPopPhantom({ closedByBack: false, consumed: true, historyState: OURS })).toBe(false);
  });

  it("does NOT pop when the back-press already did", () => {
    expect(shouldPopPhantom({ closedByBack: true, consumed: false, historyState: OURS })).toBe(false);
  });

  it("does NOT pop an entry that is not ours", () => {
    // `modal` must be strictly true — a truthy-but-foreign state is somebody
    // else's entry, and popping it steals a back-press from them.
    for (const s of [null, undefined, {}, { modal: false }, { modal: "yes" }, { other: 1 }]) {
      expect(shouldPopPhantom({ closedByBack: false, consumed: false, historyState: s })).toBe(false);
    }
  });
});

/**
 * The two-sided contract the fix rests on, pinned because a mismatch fails
 * SILENTLY — the same shape as the score-broadcast topic string (CLAUDE.md #20).
 *
 * `consumeMarker` leaves the phantom entry in place; only a REPLACE spends it.
 * Pair it with a `push` and back from the round lands on a dead entry wearing
 * the dashboard's URL, costing an extra back-press with nothing to show for it.
 *
 * This is a source read, and it is a weaker check than clicking the button —
 * which this suite cannot do (`environment: "node"`, no jsdom). It is here
 * because the alternative is no check on the pairing at all.
 */
describe("the dashboard's quick-game commit navigates by replace", () => {
  const src = readFileSync("src/app/dashboard/DashboardClient.tsx", "utf8");

  it("declares navigatesOnCommit on the setup sheet", () => {
    expect(src).toMatch(/navigatesOnCommit/);
  });

  it("routes to the round with replace, never push", () => {
    expect(src).toMatch(/router\.replace\(`\/quick-game\?format=\$\{f\}`\)/);
    expect(src).not.toMatch(/router\.push\(`\/quick-game/);
  });
});
