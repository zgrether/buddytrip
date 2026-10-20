import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * #1679 — a split with more places than can finish is said ONCE, as the Point
 * Distribution row's subtitle, and Save is disabled without repeating it at
 * the bottom (Zach). Two halves per settings page, and a page with only one
 * of them either hides the reason or lets the save through to a refusal.
 */
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("every settings page shows the split warning on the row and blocks Save", () => {
  for (const file of ["StrokeGameView.tsx", "skins/SkinsGameView.tsx"]) {
    it(file, () => {
      const src = read(file);
      expect(src).toMatch(/const distPlacesWarning = [^;]*splitPlacesWarning\(/);
      expect(src).toMatch(/distPlacesWarning \? \(\s*<span style=\{\{ color: "var\(--color-bt-warning\)" \}\} data-testid="split-places-warning">/);
      expect(src).toMatch(/saveBlocked=\{!!distPlacesWarning\}/);
    });
  }
  it("NonGolfGameView.tsx blocks Save with the call its row makes", () => {
    expect(read("NonGolfGameView.tsx")).toMatch(/const distPlacesWarning = splitPlacesWarning\(configDraft\.pointsDistribution, capacity\)/);
    expect(read("NonGolfGameView.tsx")).toMatch(/saveBlocked=\{!!distPlacesWarning\}/);
    expect(read("NonGolfSettingsRows.tsx")).toMatch(/const placesWarning = splitPlacesWarning\(draft\.pointsDistribution, capacity\)/);
  });
  it("the distribution editor does not say it a second time", () => {
    expect(read("../competition/CompetitionGamesPanel.tsx")).toMatch(/placement\.state !== "too_many_places" && \(/);
  });
});
