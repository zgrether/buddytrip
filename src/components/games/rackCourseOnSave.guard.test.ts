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
 * Save → the course and its tee snapshot are stored).
 *
 * `games.applyCourse` has since been retired, so the compiler now refuses any
 * call to it; this file's first case ("never calls games.applyCourse") could
 * only ever pass and is gone. What can still regress is the view dropping the
 * staging and losing the setup screen's course, which the case below pins.
 */
const src = readFileSync(join(__dirname, "RackGameView.tsx"), "utf8");

describe("rack's course has one write path (#1627)", () => {
  it("stages the setup screen's course into the settings draft", () => {
    expect(src).toContain("if (pendingCourse) setCourseToStage(pendingCourse);");
    expect(src).toContain("applyFrontToDraft(c.id, c.teeName);");
  });
});
