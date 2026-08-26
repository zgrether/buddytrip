import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { hasManagementContent } from "./GameSettingsPage";
import { FORMAT_SURFACE, type GameSurfaceId } from "@/lib/formatSurface";

/**
 * GAME MANAGEMENT does not render as a lone header over nothing.
 *
 * An empty section header is a promise of content, and it is the same class of
 * falsehood as the "Not live — scoring disabled" line that used to sit under it
 * on the pick'em settings page. Both were found by looking at the rendered page
 * rather than by reading the code.
 */

const base = {
  competitionId: "cup-1",
  hasTotalPointsRow: false,
  hasCourseRow: false,
  hasStandaloneRows: false,
};

describe("hasManagementContent", () => {
  it("is FALSE for pick'em with nothing passed — the case this exists for", () => {
    expect(hasManagementContent({ surface: "pickem", ...base })).toBe(false);
  });

  it("is TRUE for every surface that owns a Game State control", () => {
    // The four golf/non-golf surfaces always render the Setup|Scoring panel, so
    // the zone can never be empty for them. Asserted across the registry rather
    // than a hand-written list, so a new surface has to answer.
    for (const id of Object.keys(FORMAT_SURFACE) as GameSurfaceId[]) {
      if (!FORMAT_SURFACE[id].gameState) continue;
      expect(hasManagementContent({ surface: id, ...base }), id).toBe(true);
    }
  });

  it("pick'em's zone appears as soon as it has a row to put there", () => {
    // Not a permanent hide: when the page-level draft lands and pick'em passes a
    // Total Points row, the header comes back with something under it.
    expect(
      hasManagementContent({ surface: "pickem", ...base, hasTotalPointsRow: true })
    ).toBe(true);
    expect(hasManagementContent({ surface: "pickem", ...base, hasCourseRow: true })).toBe(true);
  });

  it("a total-points row on a STANDALONE game does not raise the zone", () => {
    // The zone renders `{competitionId && totalPointsRow}` — a points row on a
    // game with no competition is never drawn, so it must not count here either.
    // This is the pairing most likely to drift if someone edits one side.
    expect(
      hasManagementContent({
        surface: "pickem",
        competitionId: null,
        hasTotalPointsRow: true,
        hasCourseRow: false,
        hasStandaloneRows: false,
      })
    ).toBe(false);
  });

  it("standalone rows count only on a standalone game — the mirror case", () => {
    expect(
      hasManagementContent({ surface: "pickem", ...base, hasStandaloneRows: true })
    ).toBe(false); // in a competition, standaloneRows is not rendered
    expect(
      hasManagementContent({
        surface: "pickem",
        competitionId: null,
        hasTotalPointsRow: false,
        hasCourseRow: false,
        hasStandaloneRows: true,
      })
    ).toBe(true);
  });

  it("the page actually USES the predicate", () => {
    // The predicate being right is worth nothing if the render stopped calling
    // it. A source check is the weak form generally (#945) — it is used here
    // ONLY as the link between a tested pure function and the JSX, which the
    // node test environment cannot render (the danger zone reaches for tRPC).
    const src = readFileSync(join(__dirname, "GameSettingsPage.tsx"), "utf8");
    expect(src).toContain("hasManagementZone = hasManagementContent(");
    expect(src).toContain("{hasManagementZone && (");
  });
});
