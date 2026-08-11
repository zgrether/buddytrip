import { describe, it, expect } from "vitest";
import {
  FORMAT_SURFACE,
  surfaceForGameType,
  registeredGameTypes,
  surfaceHasScorecard,
  type GameSurfaceId,
} from "@/lib/formatSurface";
import { isGolfFormat, opensAsPanel, gameHref } from "@/lib/gameRoutes";
import { GAME_TYPES, isManualGameType } from "@/lib/gameTypes";

/**
 * The registry is only worth having if it cannot disagree with the code that
 * already answers these questions. `gameRoutes.ts` decided "is this golf" and
 * "does this open as a panel" long before the registry existed; these tests pin
 * the two together rather than making the registry a second opinion.
 *
 * The point of the registry is `satisfies Record<GameSurfaceId, FormatSurface>`
 * — a compile error the moment a fifth surface exists without answering
 * everything. That guard is not testable at runtime (it either compiles or it
 * doesn't), so what IS tested here is the part that can rot: the answers.
 */

const SURFACES = Object.keys(FORMAT_SURFACE) as GameSurfaceId[];

describe("format surface registry", () => {
  it("every registered game type resolves back to its own surface", () => {
    for (const id of SURFACES) {
      const entry = FORMAT_SURFACE[id];
      if (entry.gameTypes === "manual") continue;
      for (const t of entry.gameTypes) expect(surfaceForGameType(t)).toBe(id);
    }
  });

  it("no game type is claimed by two surfaces", () => {
    const all = registeredGameTypes();
    expect(new Set(all).size).toBe(all.length);
  });

  it("scorecard agrees with isGolfFormat for every known game type", () => {
    // The registry says a surface carries a scorecard; `gameRoutes` says a game
    // type is golf. They are the same claim from two directions, and a fifth
    // format is exactly where they would part company.
    for (const def of GAME_TYPES) {
      expect(
        surfaceHasScorecard(def.id),
        `${def.id}: registry and isGolfFormat disagree about the scorecard`,
      ).toBe(isGolfFormat(def.id));
    }
  });

  it("every known game type resolves to a surface, and it is the one it routes to", () => {
    for (const def of GAME_TYPES) {
      const surface = surfaceForGameType(def.id);
      expect(surface, `${def.id} resolves to no surface`).not.toBeNull();
      // A type that routes to the shared manual page must resolve to `nongolf`,
      // and a type with its own golf route must not.
      expect(surface === "nongolf").toBe(isManualGameType(def.id));
      // And it must actually have a page — a surface with no route is a format
      // that compiles and then dead-ends.
      expect(gameHref("t1", def.id, "g1"), `${def.id} has no route`).not.toBeNull();
      expect(opensAsPanel(def.id), `${def.id} does not open as a panel`).toBe(true);
    }
  });

  it("an unregistered id resolves to null, not to the non-golf catch-all", () => {
    // Unknown must not silently become non-golf: that is how an unimplemented
    // format would render a plausible-looking settings page instead of failing.
    expect(surfaceForGameType("gtt_not_a_real_format")).toBeNull();
    expect(surfaceForGameType(null)).toBeNull();
    expect(surfaceForGameType(undefined)).toBeNull();
  });

  it("non-golf is the only surface without a course", () => {
    // Stated as an invariant rather than four assertions so that a fifth GOLF
    // surface declaring `course: false` fails here instead of at a tee box.
    for (const id of SURFACES) {
      expect(FORMAT_SURFACE[id].course, `${id}`).toBe(FORMAT_SURFACE[id].scorecard);
    }
  });

  it("the scan sees the real registry (not passing vacuously)", () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(4);
    expect(GAME_TYPES.length).toBeGreaterThan(4);
  });
});
