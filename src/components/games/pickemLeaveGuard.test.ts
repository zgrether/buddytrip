import fs from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * ── THE UNSAVED-PICKS TRAP ────────────────────────────────────────────────
 *
 * Reported from the running app, and it had exactly one exit — the one that
 * destroys the work:
 *
 *   1. a sheet is open with unsaved picks
 *   2. the runner closes picking
 *   3. EVERY tab change is guarded, the Picks tab included, so tapping Picks
 *      raises the prompt instead of opening the sheet
 *   4. Save is refused by the server — picks are closed, and stay closed
 *   5. Keep editing dismisses the prompt and leaves you where you were, which
 *      is not the sheet, so it reads as a button that does nothing
 *   6. Discard is the only door, and it throws the picks away
 *
 * The guard's premise is "you can still save this if you want to". Once picks
 * close that is false, so asking is worse than not asking: two of the three
 * answers are walls.
 *
 * ── Why this is a SOURCE guard, and what it therefore does not prove ──────
 *
 * `leaveSheet` is a closure inside `PickemGameView`, a 2000-line client
 * component full of hooks and tRPC. This suite is `environment: "node"` and
 * cannot mount it, and the trap is a sequence of taps that no static render
 * reaches. So what is available is the source.
 *
 * It proves the guard consults the picks-open predicate. It does NOT prove the
 * sequence above is unreachable — that needs a person, or a Playwright spec,
 * and if this surface ever gets one the trap is the thing to put in it. Said
 * here rather than implied, because a file called "leave guard" that only
 * greps is worth less than one that says so.
 */
describe("the leave guard only fires while the draft can still be saved", () => {
  const SRC = fs.readFileSync(
    join(__dirname, "PickemGameView.tsx"),
    "utf8"
  );

  const strip = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

  const code = strip(SRC);

  it("the scan can see the guard at all — not passing on a moved file", () => {
    // The vacuity check, and it earns its place: this guard's subject is a
    // closure that could be renamed or extracted without anything else here
    // failing.
    expect(code.length, "nothing was stripped").toBeLessThan(SRC.length);
    expect(code).toContain("const leaveSheet");
    expect(code).toContain("setPendingLeave");
  });

  it("consults picksOpen, not just the dirty flag", () => {
    /**
     * The whole fix. `sheetDirty.current` alone re-creates the trap: the flag
     * outlives the ability to save, so it keeps raising a prompt whose Save is
     * refused and whose Keep editing returns to a tab that is not the sheet.
     */
    const at = code.indexOf("const leaveSheet");
    const body = code.slice(at, code.indexOf("};", at));
    expect(body).toContain("sheetDirty.current");
    expect(
      body,
      "leaveSheet no longer checks whether picks are still open — a draft that " +
        "cannot be saved would raise a prompt with no working answer"
    ).toContain("picksOpen(clock, now)");
  });

  it("is the ONE exit, so a new leave cannot forget it", () => {
    /**
     * The guard's own design note: one function for every leave. If a second
     * navigation path stopped routing through it, that path would drop a
     * saveable draft with no prompt — the mirror of the bug fixed here.
     *
     * Asserted as "every setOpenPanel/setPicksSub goes through leaveSheet"
     * rather than by counting call sites, which would need updating whenever a
     * tab is added.
     */
    for (const setter of ["setOpenPanel(", "setPicksSub("]) {
      const idx: number[] = [];
      let i = code.indexOf(setter);
      while (i > -1) {
        idx.push(i);
        i = code.indexOf(setter, i + 1);
      }
      expect(idx.length, setter + " is never called").toBeGreaterThan(0);
      for (const at of idx) {
        // Look back a short way for the guard that should wrap it.
        const before = code.slice(Math.max(0, at - 200), at);
        expect(
          before.includes("leaveSheet(") || before.includes("go()"),
          setter + " at " + at + " is not routed through leaveSheet"
        ).toBe(true);
      }
    }
  });
});
