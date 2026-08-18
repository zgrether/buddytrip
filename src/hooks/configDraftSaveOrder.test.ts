import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * The draft slices are dropped only AFTER the server mirror has been refreshed.
 *
 * ── The bug this pins (T4) ──────────────────────────────────────────────────
 * Every settings field renders `slice ?? serverConfigDraft.<field>`, and
 * `serverConfigDraft` is memoised on the view's game query. `handleSave` used to
 * call `reset(true)` — which nulls every slice — BEFORE the `onSaved` refetch that
 * refreshes that mirror. So for one network round-trip after a SUCCESSFUL write,
 * the whole form fell back to a mirror that was stale by construction and
 * displayed its pre-save values. Measured at 237ms with the panel still mounted.
 *
 * Reordering the two is the entire fix, and it is invisible in a diff: both lines
 * are still there, still in the same function, doing the same thing. Nothing about
 * the wrong order looks wrong. That is why it is worth a guard.
 *
 * ── Why a SOURCE guard and not a render test ────────────────────────────────
 * The honest answer is that a render test is not reachable here. The flash is a
 * sub-500ms property of what a React hook returns across an await, and this suite
 * is `environment: "node"` — there is no jsdom and no testing-library in the
 * project. Adding one to catch this would mean introducing a whole DOM-testing
 * capability, which is a real decision and not a side effect of a bug fix.
 *
 * So this guard is deliberately weaker than the thing it protects, and it is worth
 * being precise about the gap: it proves the two statements are still in the right
 * ORDER in this file. It does NOT prove the form renders correctly, and it cannot
 * see a flash reintroduced some other way — a view that starts nulling its own
 * slices in its `onSaved`, say. What it does buy is that the specific regression
 * that already happened cannot happen again silently.
 */

const HOOK = resolve(__dirname, "useConfigDraft.ts");

/** The body of `handleSave`, from its signature to the first line-start `  }`. */
function handleSaveBody(src: string): string {
  const start = src.indexOf("async function handleSave");
  expect(start, "handleSave not found — was it renamed?").toBeGreaterThan(-1);
  const end = src.indexOf("\n  }", start);
  expect(end, "could not find the end of handleSave").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("useConfigDraft — save ordering (T4)", () => {
  const src = readFileSync(HOOK, "utf8");
  const body = handleSaveBody(src);

  it("refreshes the server mirror BEFORE dropping the draft slices", () => {
    const refresh = body.search(/await\s+onSaved\s*\?\.\s*\(/);
    const drop = body.search(/\breset\s*\(\s*true\s*\)/);

    expect(refresh, "`await onSaved?.()` not found in handleSave").toBeGreaterThan(-1);
    expect(drop, "`reset(true)` not found in handleSave").toBeGreaterThan(-1);

    // The assertion that would be FALSE if the bug came back. Ordering, not presence:
    // both lines exist in the broken version too, which is the whole problem.
    expect(
      refresh,
      "`reset(true)` runs before `await onSaved?.()` — every field will fall back to a " +
        "stale server mirror for the length of that refetch, showing pre-save values " +
        "after a successful write (T4).",
    ).toBeLessThan(drop);
  });

  it("keeps the save bar disabled across the WHOLE commit, not just the mutation", () => {
    // Consequence of the ordering above: the draft stays touched during the refetch, so
    // `dirty` stays true. `saveConfigM.isPending` goes false when the mutation resolves —
    // mid-commit — so without `committing` the Save button re-enables during the refetch
    // and a second click commits against a now-stale `baseHash`.
    expect(
      src,
      "`saving` must span the whole commit (`saveConfigM.isPending || committing`), or Save " +
        "re-enables mid-commit and can write against a stale baseHash.",
    ).toMatch(/saving:\s*saveConfigM\.isPending\s*\|\|\s*committing/);
  });
});
