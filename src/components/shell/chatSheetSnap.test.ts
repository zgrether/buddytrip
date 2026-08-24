import { describe, it, expect } from "vitest";
import { nearestSnap, sheetBand } from "./ChatSheet";

/**
 * The chat sheet's resize arithmetic (#1046).
 *
 * Reported from a phone as three separate complaints; all three were one bug.
 * `handleDragEnd` divided the dragged pixels by the BAND (viewport minus top
 * chrome minus tab bar) while `style.height` was written as a percentage of the
 * VIEWPORT. On a 390×844 phone with 112px of top chrome and a 57px tab bar the
 * two differ by 169px, so every reading came back ~15% high:
 *
 *   • a sheet sitting at the 0.62 snap MEASURED as 0.716
 *   • dragging up 60px read 0.798 and jumped to 0.88   → hair-trigger
 *   • dragging down 80px read 0.606 and snapped back   → felt dead, which is
 *     the reported "I have to drag it up first"
 *   • 0.88 then resolved to 0.88 × 844 = 743px, putting the sheet's top edge at
 *     y=44 — under the 112px chrome, which is z-40 above the sheet's z-30. The
 *     grip became untappable and only a reload got it back.
 *
 * ── The assertion that actually catches it ──────────────────────────────────
 * A ROUND TRIP. Apply a snap, measure it, expect the same snap back. Testing
 * `nearestSnap` against hand-picked pixel values would pass against the old
 * code, because the old code's arithmetic was internally consistent — it was
 * consistent with the WRONG denominator. Only feeding it a height that was
 * produced by the band exposes the mismatch.
 */

// Measured live: iPhone-class viewport, PWA banner up, tab bar present.
const INNER = 844;
const CHROME = 112;
const NAV = 57;
const BAND = sheetBand(INNER, CHROME, NAV); // 675

describe("nearestSnap — round trip", () => {
  it("returns the same snap it was given, for every snap", () => {
    // THE regression. Under the old denominator (INNER instead of BAND) the
    // 0.62 case returned 0.88 — the reported hair-trigger, exactly.
    for (const snap of [0.42, 0.62, 0.88]) {
      expect(nearestSnap(snap * BAND, BAND), `snap ${snap} must survive a round trip`).toBe(snap);
    }
  });

  it("reproduces the OLD bug when the denominators disagree", () => {
    // Pins the diagnosis itself, so nobody has to take the story on trust: feed
    // a height produced as a fraction of the VIEWPORT into a band-based read
    // and the answer is wrong in the direction reported.
    const heightTheOldCodeRendered = 0.62 * INNER; // 523px
    expect(nearestSnap(heightTheOldCodeRendered, BAND)).toBe(0.88);
  });
});

describe("nearestSnap — symmetry", () => {
  it("moves one notch for the same push in either direction", () => {
    // "I can't just tap and drag down to shrink it": from the middle snap, an
    // equal drag each way must move one notch each way. The old code needed
    // ~150px down versus ~60px up.
    //
    // 0.15, not 0.10 — and the reason is worth stating, because 0.10 looks like
    // the obvious choice and FAILS. The snaps are not evenly spaced (0.42→0.62
    // is 0.20; 0.62→0.88 is 0.26), so the midpoints either side of 0.62 are
    // 0.52 and 0.75. A 0.10 push lands EXACTLY on the lower midpoint, where the
    // answer is decided by float rounding rather than by the code under test —
    // a knife-edge assertion that would flake with any change to the constants.
    // 0.15 clears both midpoints, so it tests the behaviour and not the tie.
    const middle = 0.62 * BAND;
    const push = 0.15 * BAND;
    expect(nearestSnap(middle - push, BAND)).toBe(0.42);
    expect(nearestSnap(middle + push, BAND)).toBe(0.88);
  });

  it("a nudge too small to change a notch keeps the current one", () => {
    const middle = 0.62 * BAND;
    expect(nearestSnap(middle + 0.02 * BAND, BAND)).toBe(0.62);
    expect(nearestSnap(middle - 0.02 * BAND, BAND)).toBe(0.62);
  });
});

describe("the largest snap never tucks the grip under the top chrome", () => {
  // The trap: the sheet is bottom-anchored, so its TOP edge is
  // innerHeight - nav - height. If that lands above the chrome's bottom edge,
  // the grip is behind a z-40 bar and the sheet cannot be resized again.
  const cases = [
    { name: "390x844, banner up", inner: 844, chrome: 112, nav: 57 },
    { name: "390x844, bar only", inner: 844, chrome: 56, nav: 57 },
    { name: "small phone", inner: 667, chrome: 112, nav: 57 },
    { name: "tablet", inner: 1024, chrome: 112, nav: 0 },
    { name: "notched, banner up", inner: 844, chrome: 159, nav: 83 },
  ];

  for (const c of cases) {
    it(`${c.name}`, () => {
      const band = sheetBand(c.inner, c.chrome, c.nav);
      const topEdge = c.inner - c.nav - 0.88 * band;
      expect(topEdge, "the grip must sit BELOW the chrome that would cover it").toBeGreaterThanOrEqual(
        c.chrome
      );
    });
  }

  it("the OLD viewport-fraction height fails this on a real phone", () => {
    // Same check against what the old code actually rendered, so the guard is
    // shown to discriminate rather than to pass everything.
    const oldHeight = 0.88 * INNER; // 743px, a fraction of the VIEWPORT
    const topEdge = INNER - NAV - oldHeight; // 44
    expect(topEdge).toBeLessThan(CHROME);
  });
});

describe("degenerate input", () => {
  it("falls back to the middle snap rather than dividing by zero", () => {
    // availableHeight() can transiently be <= 0 mid-rotation.
    expect(nearestSnap(400, 0)).toBe(0.62);
    expect(nearestSnap(400, -50)).toBe(0.62);
  });
});
