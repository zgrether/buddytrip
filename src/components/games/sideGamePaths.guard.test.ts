import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { GAME_TYPE_DEFINITIONS } from "@/lib/gameTypes";

/**
 * SOURCE GUARD: the paths a SIDE game travels (PR 6b).
 *
 * The side-game sweep found one class in two directions, both code written when
 * every game had a cup:
 *
 *  - SKIPPED because the game has no cup. The exit after finalize and the
 *    delete landed on the Trip tab (`competitionId ? leaderboard : trip home`),
 *    and a reopen-for-correction or a rename never told `games.sideBoard`
 *    (hand-written refreshes gated on the competition).
 *  - READING THE TRIP'S CUP instead of the game's own. A side match game on a
 *    trip that has a cup rendered that cup's standings header, because the view
 *    decided everything from `competitions.getByTrip`. That was the same answer
 *    only while a game's cup and its trip's cup were always one thing.
 *
 * The rules pinned here: a game view's competition is `game.competition_id`,
 * never the trip's cup; every exit and delete lands on `gamesPageHref`, which
 * takes no competition; every board refresh goes through `invalidateGameBoards`.
 */

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

/** The view each side-capable format renders through. A format that gains
 *  `side_game` must be added here, which means its view gets checked. */
const SIDE_GAME_VIEWS: Record<string, string> = {
  gtt_stroke_play: "StrokeGameView.tsx",
  gtt_match_play: "MatchGameView.tsx",
  gtt_skins: "skins/SkinsGameView.tsx",
};

/** Shared hooks and components every side game passes through. */
const SHARED = [
  "../../hooks/useGameCorrection.ts",
  "../../hooks/useGameFinalize.ts",
  "../../hooks/useExitToBoard.ts",
  "GameDangerZone.tsx",
];

describe("side-game paths", () => {
  it("every format that can be a side game has its view checked here", () => {
    const sideCapable = Object.keys(GAME_TYPE_DEFINITIONS)
      .filter((id) => GAME_TYPE_DEFINITIONS[id].allowedContainers.includes("side_game"))
      .sort();
    expect(sideCapable, "a format gained side_game: add its view to SIDE_GAME_VIEWS and check it").toEqual(
      Object.keys(SIDE_GAME_VIEWS).sort()
    );
  });

  for (const [format, file] of Object.entries(SIDE_GAME_VIEWS)) {
    describe(file, () => {
      const src = read(file);

      it("never takes the trip's cup as the game's competition", () => {
        // Any query on `competitions.getByTrip` may only be admitted by comparing
        // its id to the GAME's competition. Binding its id to a variable, which is
        // how `competitionId` came to mean "the trip's cup", is refused.
        const names = [...src.matchAll(/const (\w+) = trpc\.competitions\.getByTrip\.useQuery/g)].map((m) => m[1]);
        for (const name of names) {
          const uses = [...src.matchAll(new RegExp(`${name}\\.data\\?\\.id(.{0,16})`, "g"))].map((m) => m[1]);
          for (const tail of uses) expect(tail, `${format}: ${name}.data?.id must be compared to gameCompId`).toMatch(/^ === gameCompId/);
        }
        // The destructured form is refused outright, so the check above cannot be
        // walked around by renaming.
        expect(src).not.toMatch(/=\s*\w+\.data\?\.id as string \| undefined;/);
      });

      it("deletes land on the Games page, for every game", () => {
        expect(src).toMatch(/onDeleted=\{\(\) => router\.push\(gamesPageHref\(tripId!?\)\)\}/);
        expect(src).not.toContain("/leaderboard`");
      });

      it("refreshes the board only through the one invalidator", () => {
        expect(src).not.toMatch(/\.games\.listByTrip\.invalidate\(/);
        expect(src).not.toMatch(/\.competitions\.faceBootstrap\.invalidate\(/);
      });
    });
  }

  for (const file of SHARED) {
    it(`${file}: no hand-written board refresh, no competition-keyed destination`, () => {
      const src = read(file);
      expect(src).not.toMatch(/\.games\.listByTrip\.invalidate\(/);
      expect(src).not.toMatch(/\.competitions\.faceBootstrap\.invalidate\(/);
      expect(src).not.toContain("/leaderboard`");
    });
  }

  it("the exit after finalize is the Games page, and takes no competition", () => {
    const src = read("../../hooks/useExitToBoard.ts");
    expect(src).toContain("router.push(gamesPageHref(tripId));");
    expect(src).toMatch(/export function useExitToBoard\(tripId: string \| undefined\): \(\) => void/);
  });
});
