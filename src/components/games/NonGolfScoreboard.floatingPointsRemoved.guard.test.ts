import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — the floating point value is gone, and the ribbon that
 * replaced it is still fed the real number.
 *
 * ── Why a source guard rather than a render test ────────────────────────────
 *
 * `NonGolfScoreboard.tsx` owns `trpc.useUtils()` and cannot render outside a
 * provider — no test precedent exists for the whole file (see the header of
 * `NonGolfScoreboard.test.ts`, and `MatchesScoreboard.test.tsx`'s for the same
 * situation on its sibling). So "the ribbon renders 16 pts" cannot be written
 * here as a render assertion; what CAN be checked mechanically is the source
 * shape that produces it.
 *
 * ── What this protects, and why it is two checks and not one ───────────────
 *
 * Phase 0 confirmed both values read `game.points_total` — the floating
 * `PointsAtStake` and `ScoringStateBanner`'s `pointsTotal` prop were always the
 * SAME number, so a test asserting only "the floating value is gone" would
 * pass against a build that removed BOTH and left the surface saying nothing
 * about what the game is worth. So this asserts the removal AND that the
 * ribbon still receives the real field, not a stripped or hardcoded one.
 */

const FILE = resolve(__dirname, "NonGolfScoreboard.tsx");

function source(): string {
  return readFileSync(FILE, "utf8");
}

describe("NonGolfScoreboard: the floating point value is gone", () => {
  it("no longer imports PointsAtStake", () => {
    // The removed component's import — not merely "no <PointsAtStake" in the
    // render, which an unused import left behind would still pass.
    expect(source()).not.toMatch(/import\s*\{\s*PointsAtStake\s*\}/);
  });

  it("does not render a standalone PointsAtStake row", () => {
    expect(source()).not.toContain("<PointsAtStake");
  });
});

describe("NonGolfScoreboard: the ribbon still carries the real value", () => {
  it("ScoringStateBanner is still rendered, fed game.points_total", () => {
    // Anchored to the PROP, not merely to the component's presence — a build
    // that rendered `<ScoringStateBanner pointsTotal={null} />` would pass a
    // weaker check while showing nothing at all.
    //
    // `\b` after the tag name, not a bare `.indexOf`/`.toContain` — a plain
    // substring match here would pass against `<ScoringStateBannerDISABLED`
    // just as readily as against the real tag, since the shorter string is a
    // PREFIX of the longer one. Caught by mutating exactly that shape before
    // trusting this file: renaming the JSX tag left the two checks above
    // green (the import and the literal `<PointsAtStake` are both unaffected
    // by a change to a DIFFERENT tag), and this one silently passed too until
    // the boundary was added — the same substring landmine this project keeps
    // finding elsewhere, this time in the guard meant to catch it.
    const src = source();
    const tagMatch = src.match(/<ScoringStateBanner\b/);
    expect(tagMatch).not.toBeNull();
    const tagIndex = tagMatch!.index!;
    const bannerBlock = src.slice(tagIndex, tagIndex + 400);
    expect(bannerBlock).toMatch(/pointsTotal=\{game\.points_total/);
  });
});
