import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * #1639 c — every format's "Save results" asks first when the game would award
 * no points, through ONE hook (`useAwardsNothingBackstop`). The failure this
 * guards is a surface whose finalize button calls finalize directly: the game
 * then finishes awarding nothing without a word, which is the #1455 case.
 *
 * Read per FILE, and the unit is the button: each surface's GameLifecycleActions
 * (or, for match play, the Overview's onFinish) must be handed the hook's
 * handler, and the hook's prompt must be rendered.
 */

const ROOT = join(__dirname);
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SURFACES: { file: string; handler: RegExp }[] = [
  { file: "StrokeGameView.tsx", handler: /onFinalize=\{awardsNothingBackstop\.onFinalize\}/ },
  { file: "skins/SkinsGameView.tsx", handler: /onFinalize=\{awardsNothingBackstop\.onFinalize\}/ },
  { file: "RackGameView.tsx", handler: /onFinalize=\{awardsNothingBackstop\.onFinalize\}/ },
  { file: "MatchGameView.tsx", handler: /onFinish=\{awardsNothingBackstop\.onFinalize\}/ },
  { file: "NonGolfScoreboard.tsx", handler: /onFinalize=\{awardsNothingBackstop\.onFinalize\}/ },
  { file: "bracket/BracketScoringSurface.tsx", handler: /onFinalize=\{awardsNothingBackstop\.onFinalize\}/ },
];

describe("every finalize button goes through the awards-nothing backstop", () => {
  for (const { file, handler } of SURFACES) {
    it(file, () => {
      const src = read(file);
      expect(src).toMatch(/useAwardsNothingBackstop\(\{/);
      expect(src).toMatch(handler);
      expect(src).toMatch(/\{awardsNothingBackstop\.prompt\}/);
    });
  }

  it("no surface keeps a private copy of the prompt", () => {
    for (const { file } of SURFACES) {
      expect(read(file), file).not.toMatch(/title=\{AWARD_WORD\.none\}/);
    }
  });
});

describe("the split refusal reaches the button and replaces the summary (#1679)", () => {
  // Each view hands its button the LINKED line, opening that view's settings.
  for (const file of ["StrokeGameView.tsx", "skins/SkinsGameView.tsx", "NonGolfGameView.tsx"]) {
    it(file, () => {
      expect(read(file)).toMatch(/finalizeBlockedLine=\{splitRefusal && <SplitRefusalLine refusal=\{splitRefusal\} onSettings=\{openConfig\} \/>\}/);
    });
  }
  it("NonGolfScoreboard.tsx passes it through", () => {
    expect(read("NonGolfScoreboard.tsx")).toMatch(/finalizeBlockedLine=\{finalizeBlockedLine\}/);
  });
  it("the views that build a summary hide it when refused", () => {
    expect(read("StrokeGameView.tsx")).toMatch(/finalizeAward && !splitRefusal && \(/);
    expect(read("skins/SkinsGameView.tsx")).toMatch(/finalizeOutcome\?\.award && !splitRefusal && \(/);
  });

  it("a finishing order shows no award summary: an unfillable place there is the refusal", () => {
    expect(read("NonGolfGameView.tsx")).not.toMatch(/FinalizeAwardSummary/);
    expect(read("NonGolfScoreboard.tsx")).not.toMatch(/awardNote/);
  });
});
