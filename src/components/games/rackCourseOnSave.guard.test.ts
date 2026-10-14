import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * #1627 — rack's setup screen sets its course through the settings save, not
 * through `games.applyCourse`.
 *
 * #1474 happened because one rule (no course change once a game has results)
 * was enforced in two write paths that disagreed. Every format's settings page
 * stages its course in the draft and saves it through `save_game_config`; rack's
 * setup screen was the one live caller of the second path. It now stages the
 * picked course into the same draft (`courseToStage` → `applyFrontToDraft`), so
 * the course saves with the groupings on Save.
 *
 * The flow itself was exercised in the running app (pick a course → "Set up
 * playing groups" → settings open with the course staged and nothing written →
 * Save → the course and its tee snapshot are stored). This pins that the view
 * cannot quietly go back to the second write path.
 */
const src = readFileSync(join(__dirname, "RackGameView.tsx"), "utf8");

describe("rack's course has one write path (#1627)", () => {
  it("RackGameView never calls games.applyCourse", () => {
    expect(src).not.toMatch(/games\.applyCourse/);
  });

  it("CONTROL: it stages the setup screen's course into the settings draft", () => {
    // Without this, a view that dropped the course altogether would pass the
    // case above.
    expect(src).toContain("if (pendingCourse) setCourseToStage(pendingCourse);");
    expect(src).toContain("applyFrontToDraft(c.id, c.teeName);");
  });
});
