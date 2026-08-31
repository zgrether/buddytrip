import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * ── ADDING A MATCHUP IS NOT A DISMISSAL (#1204) ─────────────────────────────
 *
 * `PickemSlateModal.mutate` writes on every change (#1184), and
 * `pickem.saveConfig`'s `onSuccess` still closed the sheet — correct back when a
 * Save button was its only caller (#1080), wrong once every add was one. The
 * runner was ejected mid-slate on each addition, which is what was reported as
 * "it looks like it gets added but then closes the picks modal immediately" and,
 * counted a different way, as a cap at five games.
 *
 * ── WHY THIS IS A SOURCE GUARD, AND WHAT THAT DOES NOT COVER ───────────────
 *
 * The defect is a COMPOSITION: two components, each correct alone, wrong
 * together — so no per-component test could see it, and neither half's suite
 * went red while the bug was live. Seeing it for real means mounting
 * `PickemGameView`, clicking Add, and asserting the sheet is still there.
 *
 * This suite runs `environment: "node"` with no jsdom and no Testing Library —
 * nothing in this repo clicks, anywhere — so that test cannot be written here
 * today. Rather than imply coverage this does not have: what follows reads the
 * two files and pins the WIRING that made the pair wrong. It would have gone red
 * on the commit that introduced the bug, and it goes red on the obvious bad
 * fixes. It cannot witness a tap. A Playwright spec is what would add that, and
 * `PickemSlateModal.test.tsx` says the same thing about its own funnel guard.
 *
 * The half that IS covered behaviourally is persistence — `pickemSlateSave.test.ts`
 * drives the runner's real sequence through the real RPC.
 */

const COMMENT_BLOCK = new RegExp(String.raw`/\*[\s\S]*?\*/`, "g");

/** Source with comments stripped — the prose below deliberately NAMES the calls
 *  it is asserting the absence of, so an unstripped scan would match itself. */
function code(file: string): string {
  return readFileSync(resolve(__dirname, file), "utf8")
    .replace(COMMENT_BLOCK, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const VIEW = code("PickemGameView.tsx");
const MODAL = code("pickem/PickemSlateModal.tsx");

/** The body of a `const <name> = ...` whose closing token sits at `indent`. */
function block(src: string, opener: string, closer: string): string {
  const at = src.indexOf(opener);
  expect(at, `could not find \`${opener}\` — this scan is not looking at the code it thinks it is`).toBeGreaterThan(-1);
  const end = src.indexOf(closer, at);
  expect(end, `could not find the closing \`${closer.trim()}\``).toBeGreaterThan(at);
  return src.slice(at, end);
}

describe("a successful slate write dismisses nothing", () => {
  const saveConfig = block(
    VIEW,
    "const saveConfig = trpc.pickem.saveConfig.useMutation(",
    "\n  });"
  );

  it("the scan reaches the END of the mutation — not a truncated prefix", () => {
    /**
     * THE CONTROL THAT MATTERS. Every assertion below is about something NOT
     * being in this slice, and a slice that stopped early would satisfy all of
     * them while reading almost none of the handler. `onError` is the last key
     * in the option object, so seeing it proves the whole thing was captured.
     */
    expect(saveConfig).toContain("onSuccess");
    expect(saveConfig).toContain("onError");
  });

  it("onSuccess does not close the slate — dismissal belongs to the person", () => {
    expect(
      saveConfig.includes("setSlateOpen"),
      "`pickem.saveConfig`'s onSuccess touches `slateOpen`. It writes on EVERY " +
        "slate change — add, edit, delete, drag-reorder — so anything here that " +
        "dismisses ejects the runner on every addition (#1204). Closing is the " +
        "Done button's job."
    ).toBe(false);
  });

  it("onSuccess still refreshes the game — the fix removed a dismissal, not the write", () => {
    // Otherwise "does not close" is satisfiable by an empty handler, which would
    // leave the slate stale on screen instead.
    expect(saveConfig).toContain("utils.pickem.get.invalidate");
  });

  it("a failed write is still loud", () => {
    // The one thing that SHOULD make an add behave differently from any other.
    expect(saveConfig).toContain("showToast");
  });
});

describe("the slate is still dismissible — the fix did not neuter closing", () => {
  /**
   * The likeliest overcorrection: the fastest way to stop a modal closing is to
   * break closing. Both ends of the path are pinned — the view hands the modal
   * an `onClose` that really closes, and the modal's Done button really calls
   * it — so a build that simply deleted the dismissal fails here.
   */
  it("the view closes the slate on the modal's onClose", () => {
    expect(VIEW).toContain("onClose={() => setSlateOpen(false)}");
  });

  it("Done is wired to onClose", () => {
    /**
     * Bounded by the BUTTON, not by its testid. The first cut of this sliced
     * forward from `data-testid="pickem-slate-done"` and went red against
     * correct code, because `onClick` sits ABOVE the testid in the element —
     * the assertion was reading everything after the handler it was looking
     * for. Open the element from its own `<button`.
     */
    const at = MODAL.indexOf('data-testid="pickem-slate-done"');
    expect(at, "the Done button is gone entirely").toBeGreaterThan(-1);
    const open = MODAL.lastIndexOf("<button", at);
    const done = MODAL.slice(open, MODAL.indexOf("</button>", at));

    // Read from the button's own markup, so a page-wide match on some other
    // control's handler cannot stand in for this one.
    expect(done).toContain("Done");
    expect(done).toContain("onClick={onClose}");
  });

  it("the Done bar is what carries save state, now that the toast does not", () => {
    // Removing the per-add toast is only correct because this line is on screen
    // the whole time. If it goes, the toast has to come back.
    expect(MODAL).toContain('data-testid="pickem-slate-status"');
    expect(MODAL).toContain("Changes saved");
  });
});

describe("every add persists, not just the first", () => {
  const mutate = block(MODAL, "const mutate = (", "\n  };");

  it("the scan can see the funnel", () => {
    expect(mutate).toContain("setDraft");
    expect(mutate).toContain("onSave");
  });

  it("the write is UNCONDITIONAL — no one-shot flag around it", () => {
    /**
     * Fails against the tempting wrong fix: a `useRef`/boolean that suppresses
     * the close (or the write) after the first add, which looks reasonable if
     * the cause is mistaken for a remount. It leaves add #2 broken — the exact
     * shape "add, then add again without reopening" is meant to catch, and the
     * nearest thing to that test that this environment can express.
     */
    expect(mutate).toContain("onSave({ slate: next })");
    expect(
      /\bif\s*\(/.test(mutate),
      "`mutate` grew a branch. Every slate change must write every time; a " +
        "condition here is how the second add silently stops persisting."
    ).toBe(false);
  });
});
