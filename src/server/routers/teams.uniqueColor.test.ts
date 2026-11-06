import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { TEAM_CAP_LINE, TEAM_COLORS } from "@/lib/teamColors";
import { duplicateColorMessage } from "./teams";

/**
 * Migration 223: a team's color is unique within its competition, ignoring case
 * and surrounding spaces, and so a competition can have one team per palette
 * color. Every writer is covered by the INDEX, which the service-role case proves
 * by writing past the router; the router cases pin what a person sees instead.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;

const [blue, green, purple] = TEAM_COLORS;
const create = (name: string, color: string) =>
  ctx.caller().teams.create({ tripId, competitionId, name, shortName: name.slice(0, 3), color, colorDim: "#000000" });

beforeAll(async () => {
  ctx = await TestContext.create();
  ({ tripId, competitionId } = await ctx.createCupTrip({ title: "Color Trip", name: "Color Tournament", scoringModel: "points" }));
  await create("Alpha", blue.color);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("a team's color", () => {
  it("create refuses a color another team holds, and names it", async () => {
    await expect(create("Bravo", blue.color)).rejects.toThrow(duplicateColorMessage(blue.color));
    expect(duplicateColorMessage(blue.color)).toBe("Another team already uses Blue. Pick a different one.");
  });

  it("update refuses it too", async () => {
    const team = await create("Charlie", green.color);
    await expect(
      ctx.caller().teams.update({ tripId, teamId: team.id, color: blue.color, colorDim: blue.colorDim })
    ).rejects.toThrow(duplicateColorMessage(blue.color));
  });

  it("a team may keep its own color when it saves", async () => {
    const team = await create("Delta", purple.color);
    await expect(
      ctx.caller().teams.update({ tripId, teamId: team.id, name: "Delta Two", color: purple.color, colorDim: purple.colorDim })
    ).resolves.toBeTruthy();
  });

  it("the index holds past the router: case and spaces ignored", async () => {
    const { error } = await ctx.admin.from("teams").insert({
      id: `test-team-${Date.now()}`,
      competition_id: competitionId,
      name: "Echo",
      short_name: "ECH",
      color: ` ${blue.color.toUpperCase()} `,
      color_dim: "#000000",
    });
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("teams_competition_color_unique");
  });

  it("CONTROL: the same color in another competition is fine", async () => {
    const other = await ctx.createCupTrip({ title: "Other Trip", name: "Other", scoringModel: "points" });
    await expect(
      ctx.caller().teams.create({ tripId: other.tripId, competitionId: other.competitionId, name: "Alpha", shortName: "ALP", color: blue.color, colorDim: "#000000" })
    ).resolves.toBeTruthy();
  });
});

describe("the cap", () => {
  it("a ninth team is refused, in the approved words", async () => {
    const cup = await ctx.createCupTrip({ title: "Full Trip", name: "Full", scoringModel: "points" });
    const add = (i: number, color: string) =>
      ctx.caller().teams.create({ tripId: cup.tripId, competitionId: cup.competitionId, name: `Team ${i}`, shortName: `T${i}`, color, colorDim: "#000000" });
    for (const [i, c] of TEAM_COLORS.entries()) await add(i, c.color);
    await expect(add(9, "#123456")).rejects.toThrow(TEAM_CAP_LINE);
  });
});
