import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { GAME_TYPE_DEFINITIONS, canBeSideGame } from "./gameTypes";

/**
 * Migration 218's "Play it as a side game" refuses a format that cannot be a
 * side game with a LITERAL list in SQL, because the RPC cannot call
 * `canBeSideGame`. A second copy of a declaration is how the two drift: a format
 * that gains `recordsPerPersonResults` would be offered the move by the app and
 * refused by the database, or the reverse.
 *
 * So the list is pinned here to the declaration, read from the newest migration
 * that defines the move (a later redefinition of `save_game_config` is the one
 * that runs, and is the one to check).
 */

const MIGRATIONS = resolve(__dirname, "..", "..", "supabase", "migrations");

function newestDefinition(): { file: string; list: string[] } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.reverse()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    if (!sql.includes("CREATE OR REPLACE FUNCTION public.save_game_config(")) continue;
    const block = sql.slice(sql.indexOf("leaveCompetition"));
    const m = block.match(/v_type NOT IN \(([^)]*)\)/);
    if (!m) throw new Error(`${f} redefines save_game_config without the side-game format list`);
    return { file: f, list: [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() };
  }
  throw new Error("no migration defines save_game_config");
}

describe("the side-game move's SQL format list is the declaration", () => {
  it("equals every format that canBeSideGame", () => {
    const declared = Object.keys(GAME_TYPE_DEFINITIONS).filter((id) => canBeSideGame(id)).sort();
    const { list } = newestDefinition();
    expect(list).toEqual(declared);
  });

  it("CONTROL: the parser reads a list, and a list that differs is caught", () => {
    const { list } = newestDefinition();
    expect(list.length).toBeGreaterThan(0);
    const declared = Object.keys(GAME_TYPE_DEFINITIONS).filter((id) => canBeSideGame(id)).sort();
    expect([...list, "gtt_rack_n_stack"].sort()).not.toEqual(declared);
  });
});
