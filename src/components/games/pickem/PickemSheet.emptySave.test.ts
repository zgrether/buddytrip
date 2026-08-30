import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — the empty-sheet confirm sits in FRONT of the save.
 *
 * ── Why a source guard, stated rather than implied ─────────────────────────
 *
 * The rule (`confirmEmptySheetSave`) and the wording (`emptySheetWarning`) are
 * pure and tested exactly in `pickemSheet.test.ts`. What cannot be tested here
 * is the WIRE between them and the button: this suite is `environment: "node"`
 * with `renderToStaticMarkup`, nothing clicks, and the prompt is state-driven —
 * so it is invisible to a static render by construction, and `createPortal`
 * returns null without a document anyway.
 *
 * The same gap on the finalize confirm was found by a mutation that broke
 * nothing: deleting the interception entirely, so Save fires immediately and the
 * prompt never opens, passed every behavioural test. A guard over the source is
 * what is available, and it is worth having precisely because that mutation is
 * invisible otherwise.
 *
 * What this proves: the click consults the predicate, and the confirm calls the
 * same handler rather than a second save path. What it does not prove: that the
 * dialog renders or that tapping it works. A Playwright spec would add that.
 */

const SRC = readFileSync(
  resolve(__dirname, "PickemSheet.tsx"),
  "utf8"
);

/** Comments stripped — a guard that compares positions must not measure prose.
 *  The first version of the finalize guard failed against correct code because
 *  the paragraph explaining the fix named the call it was looking for. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("the empty-sheet confirm is in front of the save", () => {
  it("the scan can see the pieces — not passing vacuously", () => {
    expect(CODE).toContain("confirmEmptySheetSave");
    expect(CODE).toContain("emptySheetWarning");
    expect(CODE).toContain("onSave(ready)");
    // ...and the stripping happened: the prose above the click names the call.
    expect(CODE).not.toContain("banner mistake");
  });

  it("the button consults needsEmptyConfirm rather than saving straight away", () => {
    expect(
      /onClick=\{\(\) =>\s*\(?\s*needsEmptyConfirm\s*\?/.test(CODE),
      "The Save button no longer checks needsEmptyConfirm. An empty sheet would " +
        "save with no warning — which is the state the confirm exists for, and " +
        "which no behavioural test in this suite can see, because it runs in " +
        "node and nothing clicks."
    ).toBe(true);
  });

  it("the confirm calls the SAME save, not a second path", () => {
    /**
     * Two call sites would be two things to keep in step — the shape
     * `oneFinalizePath` guards one level up. There is one `onSave(ready)` behind
     * the button and one behind the prompt, and they are the same call.
     */
    const calls = CODE.match(/onSave\(ready\)/g) ?? [];
    expect(calls.length, "expected exactly two: the direct save and the confirmed one").toBe(2);
  });

  it("the prompt is rendered CONDITIONALLY — it is a response, not a state", () => {
    // A dialog that renders whenever the sheet is empty would be the standing
    // banner this deliberately is not.
    expect(CODE).toContain("{confirmingEmpty && (");
  });
});
