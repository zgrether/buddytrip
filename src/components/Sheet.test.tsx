import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheet } from "./Sheet";

/**
 * `Sheet` must portal to `document.body`.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 *
 * Every game surface renders inside `CompetitionFace`'s game panel, which is
 * `fixed … z-30`. A positioned element with a z-index creates a stacking
 * context, so a `z-50` Sheet rendered INLINE is capped inside z-30 — correct
 * against its siblings, underneath anything really at z-40 or z-50.
 *
 * Shipped consequence: the pick'em slate opened UNDERNEATH the settings
 * slide-over (which portals, so its z-50 is real). "The slate" read as a dead
 * button. The Sheet was in the DOM, visible, right size, right content — and
 * completely covered.
 *
 * ── Why these are the assertions they are ──────────────────────────────────
 *
 * The defect is a STACKING one, and stacking needs layout. This suite runs in
 * `environment: "node"` — no jsdom, no layout, no `elementFromPoint` — so a
 * test here CANNOT witness "is it on top". Pretending otherwise would be the
 * decorative-assertion trap: a check that passes against the broken build.
 *
 * So this file guards the MECHANISM instead, and says plainly that it does:
 * the portal call must be present, and it must target `document.body`. That is
 * a real regression guard — it fails if someone removes the portal — and it is
 * honestly weaker than the browser check that actually found the bug
 * (`elementFromPoint` at the modal's own centre, against a running page).
 */

describe("Sheet portals to body", () => {
  const source = readFileSync(join(__dirname, "Sheet.tsx"), "utf8");

  it("calls createPortal targeting document.body", () => {
    // The premise: we are reading the file we think we are.
    expect(source).toContain("export function Sheet");
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toMatch(/createPortal\(\s*tree\s*,\s*document\.body\s*\)/);
  });

  it("does NOT return null off-browser — that would empty every consumer's tests", () => {
    // The first attempt at the fix used `if (typeof document === "undefined")
    // return null`, copied from SettingsSlideOver. Correct there, wrong here:
    // Sheet's consumers are covered by renderToStaticMarkup in a node env, and
    // 25 assertions in PickemSlateModal.test.tsx went blank at once.
    //
    // Asserted behaviourally rather than by reading the source, because the
    // shape of the guard is not the point — the OUTPUT being non-empty is.
    const html = renderToStaticMarkup(
      <Sheet title="Probe" onClose={() => {}} testId="probe-sheet">
        <p>body content</p>
      </Sheet>
    );
    expect(html).toContain("body content");
    expect(html).toContain("Probe");
    expect(html).toContain('data-testid="probe-sheet"');
  });

  it("keeps the z-50 that the portal makes meaningful", () => {
    // z-50 without the portal is the bug; the portal without z-50 is a
    // different one. Both halves have to be here.
    const html = renderToStaticMarkup(
      <Sheet title="Probe" onClose={() => {}}>
        <p>x</p>
      </Sheet>
    );
    expect(html).toContain("z-50");
  });
});
