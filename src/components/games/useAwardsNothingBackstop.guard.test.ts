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
