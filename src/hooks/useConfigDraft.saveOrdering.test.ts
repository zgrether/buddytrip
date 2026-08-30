import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — the baseline's draft and its hash must come from ONE moment.
 *
 * ── The bug this pins, which was an ORDERING and not a race ────────────────
 *
 * `useConfigDraft` freezes a `{ draft, hash }` baseline: the dirty reference AND
 * the optimistic-concurrency base Save sends as `baseHash`. The two halves come
 * from different queries — the game/child mirror, and `games.configHash`.
 *
 * `handleSave` used to await the mirror refresh, call `reset(true)`, and only
 * THEN fire the hash refetch un-awaited. That is not a race that usually lands
 * the right way; it is deterministic. `reset(true)` flips `anyTouched` false, the
 * baseline effect runs on the next pass, and at that instant the mirror is fresh
 * and the hash refetch has not been CALLED. The baseline was therefore ALWAYS
 * re-frozen as { draft: fresh, hash: one write stale }.
 *
 * It healed when the hash landed — and stopped healing the moment the user
 * touched anything, because the freeze guard returns `prev` untouched from then
 * on. The next Save sent the stale hash and the server answered "This game
 * changed on another device" on a game nobody else had opened. Reported from a
 * phone: set the total, Save, reopen settings, change the roll-up, Save.
 *
 * ── Why a source guard ─────────────────────────────────────────────────────
 *
 * The property is about the ORDER of two awaits around a state reset inside a
 * hook. This suite is `environment: "node"` — no React renderer — so there is no
 * behavioural test available here, and the honest thing is to pin the shape and
 * say so rather than approximate it with something that would pass either way.
 *
 * What this proves: the hash refresh is awaited alongside the mirror, before the
 * reset. What it does not prove: that the effect then freezes the right pair.
 * That is `useConfigDraft`'s own logic and is unchanged by this fix.
 */

const SRC = readFileSync(resolve(__dirname, "useConfigDraft.ts"), "utf8");

/**
 * `handleSave`'s body, COMMENTS STRIPPED — a refetch elsewhere in the file must
 * not satisfy this, and neither must a mention of the code in prose.
 *
 * The stripping is not tidiness. The first draft of this guard compared
 * `indexOf("reset(true)")` against `indexOf("hashQ.refetch(")` over the raw
 * slice, and the paragraph above the fix — which explains the bug by NAMING
 * `reset(true)` — sat earlier in the file than either call. So the guard failed
 * against the correct code and would have passed against the broken code with
 * the comment removed. It was measuring the region, not the thing.
 */
function saveBody(): string {
  const start = SRC.indexOf("async function handleSave()");
  expect(start, "handleSave not found — did it get renamed?").toBeGreaterThan(-1);
  const end = SRC.indexOf("function handleCancel()", start);
  expect(end, "could not find the function after handleSave").toBeGreaterThan(start);
  return SRC.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("useConfigDraft — the post-save refresh", () => {
  const body = saveBody();

  it("the scan can see the pieces at all — not passing vacuously", () => {
    expect(body).toContain("reset(true)");
    expect(body).toContain("hashQ.refetch");
    expect(body).toContain("onSaved");
    // ...and the stripping actually happened: the explanatory comment names
    // every one of those, so a guard reading the raw slice measures prose.
    expect(body).not.toContain("deterministic");
  });

  it("refreshes the hash and the mirror TOGETHER", () => {
    expect(
      /await Promise\.all\(\[\s*onSaved\?\.\(\)\s*,\s*hashQ\.refetch\(\)/.test(body),
      "handleSave no longer awaits the mirror refresh and the hash refetch together. " +
        "Refreshing them separately lets `reset(true)` run while one is still stale, " +
        "and the baseline then freezes a fresh draft against an out-of-date hash — " +
        "which the next Save sends as baseHash and the server rejects as a conflict."
    ).toBe(true);
  });

  it("does not fire the hash refetch AFTER the reset", () => {
    /**
     * The inverse, and the exact shape of the bug: a trailing `void
     * hashQ.refetch()` reads as a harmless bit of freshening and re-opens the
     * whole window. There is one refetch in this function and it is inside the
     * Promise.all.
     */
    const refetches = body.match(/hashQ\.refetch\(/g) ?? [];
    expect(
      refetches.length,
      "handleSave calls hashQ.refetch() more than once. The post-reset call is the " +
        "bug: by then `anyTouched` is already false and the baseline has re-frozen " +
        "against the previous hash."
    ).toBe(1);

    const resetAt = body.indexOf("reset(true)");
    const refetchAt = body.indexOf("hashQ.refetch(");
    expect(
      refetchAt,
      "hashQ.refetch() runs after reset(true). The baseline re-freezes on the reset, " +
        "so the hash has to be in hand before it, not after."
    ).toBeLessThan(resetAt);
  });
});
