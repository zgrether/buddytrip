import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { duplicateShortNameMessage, duplicateTeamNameMessage } from "./teams";

/**
 * Migration 219 — a team's name, and its short name, are unique within its
 * competition, ignoring case and surrounding spaces (a blank short name may
 * repeat). Team badges look their label up BY NAME where a screen
 * has no team id (#1677), so two teams sharing a name would mislabel one.
 *
 * Every writer is covered by the INDEX, which the last case proves by writing
 * past the router with the service role. The router cases pin the sentence a
 * person sees instead of the raw unique_violation.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let bravoId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  const cup = await ctx.createCupTrip({ name: "219 unique names", scoringModel: "points", teams: ["Alpha", "Bravo"] });
  // Give the seeded teams known short names to clash with.
  for (const [id, short] of [[cup.teamIds[0]!, "ALP"], [cup.teamIds[1]!, "BRA"]] as const) {
    const { error } = await ctx.admin.from("teams").update({ short_name: short }).eq("id", id);
    if (error) throw error;
  }
  tripId = cup.tripId;
  competitionId = cup.competitionId;
  bravoId = cup.teamIds[1]!;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const create = (name: string, shortName: string) =>
  ctx.caller().teams.create({ tripId, competitionId, name, shortName, color: "#22c55e", colorDim: "#0a2a14" });

describe("a team's name is unique within its competition (219)", () => {
  it("creating a team with a name already taken is refused, ignoring case and spaces", async () => {
    await expect(create("  alpha ", "ALX")).rejects.toThrow(duplicateTeamNameMessage("  alpha "));
  });

  it("CONTROL: a new name is fine", async () => {
    await expect(create("Charlie", "CHA")).resolves.toBeTruthy();
  });

  it("renaming a team to another team's name is refused", async () => {
    await expect(ctx.caller().teams.update({ tripId, teamId: bravoId, name: "ALPHA" })).rejects.toThrow(
      duplicateTeamNameMessage("ALPHA")
    );
  });

  it("CONTROL: saving a team under its own name is fine", async () => {
    await expect(ctx.caller().teams.update({ tripId, teamId: bravoId, name: "Bravo" })).resolves.toBeTruthy();
  });

  it("CONTROL: another competition may use the same name", async () => {
    const other = await ctx.createCupTrip({ name: "219 other cup", scoringModel: "points", teams: ["Alpha", "Bravo"] });
    expect(other.teamIds).toHaveLength(2);
  });

  it("the database itself refuses it, past the router", async () => {
    const { error } = await ctx.admin
      .from("teams")
      .insert({ competition_id: competitionId, name: "BRAVO", short_name: "BRX", color: "#000000", color_dim: "#000000" });
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("teams_competition_name_unique");
  });
});

describe("a team's short name is unique within its competition too (219)", () => {
  it("creating a team with a short name already taken is refused, ignoring case and spaces", async () => {
    await expect(create("Delta", " bra")).rejects.toThrow(duplicateShortNameMessage(" bra"));
  });

  it("changing a short name to another team's is refused", async () => {
    await expect(ctx.caller().teams.update({ tripId, teamId: bravoId, shortName: "alp" })).rejects.toThrow(
      duplicateShortNameMessage("alp")
    );
  });

  it("CONTROL: a new short name is fine", async () => {
    await expect(create("Echo", "ECH")).resolves.toBeTruthy();
  });

  it("blank short names may repeat", async () => {
    const rows = ["Foxtrot", "Golf"].map((name) => ({ competition_id: competitionId, name, short_name: "  ", color: "#000000", color_dim: "#000000" }));
    for (const row of rows) {
      const { error } = await ctx.admin.from("teams").insert(row);
      expect(error).toBeNull();
    }
  });

  it("the database itself refuses a taken short name, past the router", async () => {
    const { error } = await ctx.admin
      .from("teams")
      .insert({ competition_id: competitionId, name: "Hotel", short_name: "BRA ", color: "#000000", color_dim: "#000000" });
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("teams_competition_short_name_unique");
  });
});
