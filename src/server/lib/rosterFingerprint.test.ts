import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { assertRosterUnchanged, readRosterFingerprint, ROSTER_CHANGED_MESSAGE } from "./rosterFingerprint";

/**
 * The roster fingerprint (PR 8 prerequisite 3): it must MOVE on every change a
 * before-and-after preview depends on, must NOT move on changes that credit
 * nobody differently, and a confirm must refuse when it moved.
 *
 * Every change is made through the app's own procedures (the real callers),
 * and every case builds its own trip, so a failing case cannot leak state into
 * the next one.
 *
 * What would leave this green that shouldn't? A fingerprint that never moves
 * passes every "does not move" case, so each of those sits beside a "moves"
 * case on the same fixture; a fingerprint that always moves passes every
 * "moves" case, so the stability and no-churn cases pin the other side.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function cup() {
  const { tripId, competitionId } = await ctx.createCupTrip({
    title: "fingerprint trip", name: "Fingerprint Cup", scoringModel: "points",
    members: [["planner", "Member"], ["member", "Member"]],
    teams: ["Blue", "Red"],
  });
  const { data: teams } = await ctx.admin.from("teams").select("id, name").eq("competition_id", competitionId);
  const byName = new Map((teams ?? []).map((t) => [t.name as string, t.id as string]));
  const planner = ctx.getUser("planner").id;
  const member = ctx.getUser("member").id;
  const caller = ctx.caller();
  const fp = () => caller.teamAssignments.rosterFingerprint({ tripId, competitionId }).then((r) => r.fingerprint);
  return { tripId, competitionId, blue: byName.get("Blue")!, red: byName.get("Red")!, planner, member, caller, fp };
}

describe("roster fingerprint — what moves it", () => {
  it("is stable across reads, and the query equals the server reader", async () => {
    const c = await cup();
    const a = await c.fp();
    expect(await c.fp()).toBe(a);
    expect(await readRosterFingerprint(ctx.admin, c.tripId, c.competitionId)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  }, 60000);

  it("moves on assign, move and remove — who is on which team", async () => {
    const c = await cup();
    const empty = await c.fp();

    await c.caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.blue });
    const assigned = await c.fp();
    expect(assigned).not.toBe(empty);

    await c.caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.red });
    const moved = await c.fp();
    expect(moved).not.toBe(assigned); // a MOVE changes credit, so it must refuse a stale preview

    await c.caller.teamAssignments.remove({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner });
    // Back to nobody assigned: the SAME content hashes the SAME, which is what
    // makes a stale preview detectable at all rather than always-refused.
    expect(await c.fp()).toBe(empty);
  }, 60000);

  it("moves when a team is created or deleted", async () => {
    const c = await cup();
    const before = await c.fp();
    const created = (await c.caller.teams.create({
      tripId: c.tripId, competitionId: c.competitionId, name: "Green", shortName: "GRN", color: "#22c55e", colorDim: "#14532d",
    })) as { id: string };
    const withGreen = await c.fp();
    expect(withGreen).not.toBe(before);
    await c.caller.teams.delete({ tripId: c.tripId, teamId: created.id });
    expect(await c.fp()).toBe(before);
  }, 60000);

  it("does NOT move on reorder, captain or rename — they credit nobody differently", async () => {
    const c = await cup();
    await c.caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.blue });
    await c.caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.member, teamId: c.blue });
    const base = await c.fp();

    await c.caller.teamAssignments.reorder({
      tripId: c.tripId, competitionId: c.competitionId, teamId: c.blue, orderedUserIds: [c.member, c.planner],
    });
    expect(await c.fp(), "reorder").toBe(base);

    await c.caller.teamAssignments.setCaptain({
      tripId: c.tripId, competitionId: c.competitionId, teamId: c.blue, userId: c.member, isCaptain: true,
    });
    expect(await c.fp(), "captain").toBe(base);

    await c.caller.teams.update({ tripId: c.tripId, teamId: c.blue, name: "Navy" });
    expect(await c.fp(), "rename").toBe(base);

    // CONTROL on the same fixture: the fingerprint is not simply frozen.
    await c.caller.teamAssignments.remove({ tripId: c.tripId, competitionId: c.competitionId, userId: c.member });
    expect(await c.fp()).not.toBe(base);
  }, 60000);
});

describe("assertRosterUnchanged — the confirm's refusal", () => {
  it("passes on an unchanged roster, and refuses once another organizer moved someone", async () => {
    const c = await cup();
    await c.caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.blue });
    const previewBuiltOn = await c.fp();

    await expect(assertRosterUnchanged(ctx.admin, c.tripId, c.competitionId, previewBuiltOn)).resolves.toBeUndefined();

    // Someone else moves the player while the preview is open.
    await c.caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.red });

    await expect(assertRosterUnchanged(ctx.admin, c.tripId, c.competitionId, previewBuiltOn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: ROSTER_CHANGED_MESSAGE,
    });
  }, 60000);

  it("refuses a competition from ANOTHER trip rather than hashing an empty roster", async () => {
    const a = await cup();
    const b = await cup();
    // Trip A's id with trip B's competition: rows the caller cannot scope would
    // read as empty and hash to a valid-looking value. It must be NOT_FOUND.
    await expect(
      a.caller.teamAssignments.rosterFingerprint({ tripId: a.tripId, competitionId: b.competitionId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 60000);
});
