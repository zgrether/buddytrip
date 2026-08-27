import { describe, it, expect } from "vitest";
import {
  FORMAT_SURFACE,
  surfaceForGameType,
  registeredGameTypes,
  surfaceHasScorecard,
  usesScoringLifecycle,
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

/** The game-type ids a surface owns. Mirrors how the tests above resolve the
 *  `"manual"` catch-all arm, rather than inventing a second rule for it. */
const surfaceGameTypes = (id: GameSurfaceId): string[] => {
  const entry = FORMAT_SURFACE[id];
  return entry.gameTypes === "manual"
    ? GAME_TYPES.filter((t) => isManualGameType(t.id)).map((t) => t.id)
    : [...entry.gameTypes];
};

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

  it("`modifiers` is pinned to compatibleModifiers, not hand-declared", () => {
    /**
     * The boolean was hand-written and WRONG: rack and stroke both said `true`
     * while their `compatibleModifiers` is `[]`, so each passed a `modifiersRow`
     * whose value was permanently `undefined`. `oneSettingsPage.test.ts` did not
     * catch it because it checked the PROP WAS PASSED IN THE SOURCE rather than
     * that a row ever rendered — a corrected boolean under that guard would just
     * reset the clock.
     *
     * So the boolean is no longer an independent claim. It must equal "does any
     * game type on this surface actually have a modifier", which is a fact about
     * `gameTypes.ts`. A fifth format cannot declare it wrong, and adding stroke's
     * first modifier fails HERE until someone adds the row back deliberately.
     */
    for (const id of SURFACES) {
      const entry = FORMAT_SURFACE[id];
      const types =
        entry.gameTypes === "manual"
          ? GAME_TYPES.filter((t) => isManualGameType(t.id))
          : GAME_TYPES.filter((t) => entry.gameTypes.includes(t.id));
      const hasAny = types.some((t) => (t.compatibleModifiers ?? []).length > 0);
      expect(
        entry.modifiers,
        `${id}: FORMAT_SURFACE says modifiers=${entry.modifiers}, but its game types ` +
          `${hasAny ? "DO" : "do NOT"} declare any compatibleModifiers`,
      ).toBe(hasAny);
    }
  });

  it("non-golf is the only surface without a course", () => {
    // Stated as an invariant rather than four assertions so that a fifth GOLF
    // surface declaring `course: false` fails here instead of at a tee box.
    for (const id of SURFACES) {
      expect(FORMAT_SURFACE[id].course, `${id}`).toBe(FORMAT_SURFACE[id].scorecard);
    }
  });


  describe("usesScoringLifecycle — the board's setup shortcut", () => {
    it("is TRUE for every format whose go-live really is scoring_enabled", () => {
      for (const id of ["match", "rack", "stroke", "nongolf"] as GameSurfaceId[]) {
        for (const t of surfaceGameTypes(id)) {
          expect(usesScoringLifecycle(t), t).toBe(true);
        }
      }
    });

    it("is FALSE for pick'em, whose go-live is picks_opened_at", () => {
      // The bug: `isPreScoring` reads status + scoring_enabled, both of which
      // stay put for pick'em's entire picking phase, so the leaderboard's
      // "drop the owner into setup" shortcut fired forever and the one person
      // who most needed their own sheet could never reach it.
      expect(usesScoringLifecycle("gtt_pickem")).toBe(false);
    });

    it("defaults an UNREGISTERED type to the golf answer", () => {
      // Fail-safe direction: a type the registry has not met behaves the way
      // every caller assumed before the registry existed.
      expect(usesScoringLifecycle("gtt_not_a_real_type")).toBe(true);
      expect(usesScoringLifecycle(null)).toBe(true);
    });

    it("agrees with the registry's own gameState flag, rather than being a second opinion", () => {
      for (const id of SURFACES) {
        for (const t of surfaceGameTypes(id)) {
          expect(usesScoringLifecycle(t), t).toBe(FORMAT_SURFACE[id].gameState);
        }
      }
    });
  });

  it("the scan sees the real registry (not passing vacuously)", () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(4);
    expect(GAME_TYPES.length).toBeGreaterThan(4);
  });
});
