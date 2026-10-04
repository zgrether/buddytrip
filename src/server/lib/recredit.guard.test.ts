import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { GAME_TYPE_DEFINITIONS } from "@/lib/gameTypes";
import { RECREDIT_FORMATS, TEAM_SCORING } from "@/lib/recredit";

/**
 * Which formats can be re-credited is decided in TWO places, on purpose:
 * `teamDependent: false` in code (what the preview offers) and
 * `_recredit_eligible_format` in the database (what `recredit_games` will
 * write). Two lists that must agree is #1332's shape — game readiness lived in
 * SQL and TypeScript with no test comparing them, and drifted. This compares
 * them for EVERY registered format, so a format flipped in one place and not
 * the other fails here rather than in front of an Owner.
 *
 * And each re-creditable format must say how its TEAMS rank
 * (`TEAM_SCORING`): a format that becomes team-independent without one would
 * be ranked with a guessed direction.
 */

let ctx: TestContext;
beforeAll(async () => { ctx = await TestContext.create(); }, 60_000);
afterAll(async () => { await ctx.cleanup(); }, 60_000);

describe("re-creditable formats: code and database agree", () => {
  it("CONTROL: the list is not empty — stroke play and skins, as ruled", () => {
    expect(RECREDIT_FORMATS).toEqual(["gtt_skins", "gtt_stroke_play"]);
  });

  it("every registered format gets the same answer from the database as from its declaration", async () => {
    const disagreements: string[] = [];
    for (const def of Object.values(GAME_TYPE_DEFINITIONS)) {
      const { data, error } = await ctx.admin.rpc("_recredit_eligible_format", { p_game_type_id: def.id });
      if (error) throw error;
      if (data !== (def.teamDependent === false)) disagreements.push(`${def.id}: db=${data} code=${!def.teamDependent}`);
    }
    expect(disagreements).toEqual([]);
  });

  it("an unregistered format is refused (the safe direction)", async () => {
    const { data, error } = await ctx.admin.rpc("_recredit_eligible_format", { p_game_type_id: "gtt_not_a_format" });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("every re-creditable format says how its teams rank, and nothing else does", () => {
    expect(Object.keys(TEAM_SCORING).sort()).toEqual([...RECREDIT_FORMATS]);
  });
});
