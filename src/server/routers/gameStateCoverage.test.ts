import { describe, it, expect } from "vitest";
import { HASH_COLS } from "./games";
import {
  IDENTITY_COLS,
  LIFECYCLE_COLS,
  CONFIG_COL_DEPARTED,
} from "@/server/lib/gameReadiness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The COVERAGE guard for the New / Configuring split — the durable half of the
 * change, and the reason the classification can't drift the way the labels did.
 *
 * `isNew` answers "has this game been configured at all?" by asking, of each
 * CONFIG column, whether it has departed from its creation value. That is only
 * trustworthy if the classification is TOTAL: every column of `GAME_CONFIG_COLS`
 * must be in exactly one of IDENTITY / LIFECYCLE / CONFIG. A migration that adds
 * a column trips this test until someone decides which it is.
 *
 * Same mechanism as `configHash.coverage.test.ts`, for the same reason — the
 * failure it prevents is silent. An unclassified column is simply not read, so
 * `isNew` keeps answering, just wrongly, and in the permissive direction: a game
 * configured ONLY through the new column reads as untouched.
 *
 * Pure (no DB): `GAME_CONFIG_COLS` is the enforced list, and the whole point is
 * to compare against IT rather than against the live schema. The live schema is
 * already policed for this table by `configHash.coverage.test.ts` — if a new
 * column exists and is not in `GAME_CONFIG_COLS`, that test is the one that
 * fires. The two together close both directions: a column must reach the hash
 * list, and everything on the hash list must be classified here.
 */

const gameCols = HASH_COLS.games.split(",").map((s) => s.trim());

describe("New/Configuring classification covers GAME_CONFIG_COLS", () => {
  it("puts every column in exactly one set", () => {
    const identity = new Set<string>(IDENTITY_COLS);
    const lifecycle = new Set<string>(LIFECYCLE_COLS);
    const config = new Set(Object.keys(CONFIG_COL_DEPARTED));

    const unclassified = gameCols.filter(
      (c) => !identity.has(c) && !lifecycle.has(c) && !config.has(c)
    );
    expect(
      unclassified,
      `unclassified games columns — add each to IDENTITY_COLS, LIFECYCLE_COLS or ` +
        `CONFIG_COL_DEPARTED in gameReadiness.ts: ${unclassified.join(", ")}`
    ).toEqual([]);

    // The other direction: nothing classified that isn't actually a config column,
    // which would mean `isNew` reads a key the row never carries — and, thanks to
    // the fail-safe in `gameRowTouched`, would make every game read Configuring
    // forever. A dead key here is not harmless.
    const known = new Set(gameCols);
    const strays = [...identity, ...lifecycle, ...config].filter((c) => !known.has(c));
    expect(strays, `classified but not in GAME_CONFIG_COLS: ${strays.join(", ")}`).toEqual([]);
  });

  it("keeps the three sets disjoint", () => {
    const seen = new Map<string, string[]>();
    const add = (col: string, set: string) =>
      seen.set(col, [...(seen.get(col) ?? []), set]);
    for (const c of IDENTITY_COLS) add(c, "IDENTITY");
    for (const c of LIFECYCLE_COLS) add(c, "LIFECYCLE");
    for (const c of Object.keys(CONFIG_COL_DEPARTED)) add(c, "CONFIG");

    const overlaps = [...seen.entries()].filter(([, sets]) => sets.length > 1);
    expect(
      overlaps.map(([c, sets]) => `${c} in ${sets.join(" + ")}`),
      "a column in two sets makes the partition ambiguous"
    ).toEqual([]);
  });
});

/**
 * The leaderboard's `select` must NAME every config column the predicate reads.
 *
 * This is the half a pure classification test cannot see. `gameRowTouched` treats
 * an absent column as touched, so a select missing one degrades every game to
 * "Configuring" — quietly, with no error and no visible defect except that New
 * stops appearing. That is exactly the invisibility this whole change was written
 * to remove, so it gets a real check rather than a comment.
 *
 * Reads the SOURCE, because the failure is a missing string in a select and there
 * is no runtime value to inspect: `computeCompetitionLeaderboard` would have to be
 * run against a DB to observe it, and it would still answer, just wrongly. The
 * regex is anchored to `.from("games")`'s select so it cannot accidentally match
 * one of the other selects in the same file.
 */
describe("the leaderboard select carries every column isNew reads", () => {
  it("names all of them", () => {
    const src = readFileSync(
      join(process.cwd(), "src/server/lib/competitionLeaderboard.ts"),
      "utf8"
    );
    // The games select is the one carrying `display_order` — the board's own
    // ordering column, which no other select in this file reads.
    const match = src.match(/\.select\(\s*"([^"]*display_order[^"]*)"\s*\)/);
    expect(match, "could not find the games select in competitionLeaderboard.ts").toBeTruthy();
    const selected = new Set(match![1].split(",").map((s) => s.trim()));

    const missing = Object.keys(CONFIG_COL_DEPARTED).filter((c) => !selected.has(c));
    expect(
      missing,
      `isNew reads these columns but the leaderboard select omits them, so every ` +
        `game would read Configuring: ${missing.join(", ")}`
    ).toEqual([]);

    // `status` too — `isNew` short-circuits on it.
    expect(selected.has("status")).toBe(true);
  });
});
