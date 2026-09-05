import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A STICKY ELEMENT CARRIES ITS OWN VERTICAL GAP.
 *
 * Twice in one session, the same defect: an element that pins while content
 * scrolls under it had padding on one side only, because on the surfaces it was
 * built against the other side's gap came from a neighbour.
 *
 *   `GameLifecycleActions`  the finalize arm had no top padding — "the gap the
 *                           first one gets for free from the surface above it".
 *                           On three surfaces there was nothing above to
 *                           inherit, and "Save results" sat flush on the card.
 *
 *   `GamePageHeader`        `px-4 pt-3` and no bottom. Content scrolled up to
 *                           meet its edge with no gap and read as sliding
 *                           THROUGH it — reported as a transparency bug, which
 *                           it was not: the box is opaque and every sticky
 *                           element on those surfaces was checked and correct.
 *
 * A sticky element is the only participant that knows it is being scrolled
 * under, so the gap belongs to it rather than to whatever happens to sit
 * alongside. That is the rule; this pins the instance.
 *
 * ── Why a SOURCE guard ────────────────────────────────────────────────────
 *
 * `GamePageHeader` calls `useRealtimeScoreEvents` and a tRPC query, so a render
 * test needs providers and mocks — a lot of fixture to assert one padding
 * value, and fixture that would then have to be maintained for a reason
 * unrelated to what it proves. The repo already uses source guards for exactly
 * this trade (`TripIdProvider.test.ts`). Cheap, and it fails for the right
 * reason.
 */

const SRC = readFileSync("src/components/competition/GamePageHeader.tsx", "utf8");

describe("the sticky game header keeps its own vertical gap", () => {
  it("pins, and is opaque while it does", () => {
    // The anchor has to match at all — a renamed wrapper would otherwise make
    // every assertion below vacuously true.
    expect(SRC).toContain('position: "sticky"');
    expect(SRC).toContain("background: \"var(--color-bt-base)\"");
  });

  /**
   * SYMMETRIC, not merely present. `pt-3` alone is what shipped, and a guard
   * that only asked for "some vertical padding" would have passed against it.
   */
  it("pads top AND bottom, not just the top", () => {
    const wrapper = SRC.match(/className="([^"]*)"[\s\S]{0,200}?position: "sticky"/)?.[1];
    expect(wrapper, "the sticky wrapper's className was not found").toBeDefined();
    expect(wrapper).toMatch(/\bpy-\d/);
    expect(wrapper, "pt- without py-/pb- is the defect this exists for").not.toMatch(/\bpt-\d/);
  });
});
