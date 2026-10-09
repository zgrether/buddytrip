import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { tripDisplayNames } from "../lib/tripDisplayNames";
import { NOT_A_MEMBER_MESSAGE } from "../middleware";

/**
 * Names for people who have LEFT a trip (PR 8d-2). Their membership row is gone,
 * so every name source built on it misses them; the departure record keeps the
 * name the crew saw (migration 205).
 *
 *   - the SERVER source, `tripDisplayNames`, names them by the record — read with
 *     a CURRENT MEMBER's client, the way its router callers read it, where RLS
 *     hides their account name (`users_select` needs a shared trip) and the old
 *     code answered "Someone";
 *   - a current member always wins over an old record (someone who came back);
 *   - `tripMembers.departedNames` serves the client maps: members read it, the
 *     departed person does not (the record is the crew's, not theirs).
 *
 * Each case builds its own trip (destructive writes, CLAUDE.md).
 */

let ctx: TestContext;
let member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** The member, nicknamed, with a chat message (history), then removed. */
async function departed(label: string, nickname: string) {
  const tripId = await ctx.createTrip(`Departed names ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const nick = await ctx.admin.from("trip_members").update({ nickname }).eq("trip_id", tripId).eq("user_id", member);
  if (nick.error) throw nick.error;
  const msg = await ctx.admin.from("messages").insert({
    id: genId("msg"), trip_id: tripId, user_id: member, channel: "trip", team_id: null, text: "hello",
  });
  if (msg.error) throw msg.error;
  await ctx.caller().tripMembers.remove({ tripId, userId: member });
  return tripId;
}

describe("tripDisplayNames — the server's one name source", () => {
  it("names someone who LEFT by the name the crew saw, through a member's own client", async () => {
    const tripId = await departed("server", "Biscuit");
    const names = await tripDisplayNames(ctx.authedClient("owner"), tripId, [member]);
    expect(names.get(member)).toBe("Biscuit");
  });

  it("a CURRENT member is named by their membership, not by an old departure", async () => {
    const tripId = await departed("rejoined", "Biscuit");
    const back = await ctx.admin.from("trip_members").insert({
      id: crypto.randomUUID(), trip_id: tripId, user_id: member, role: "Member", status: "in", nickname: "Back Again",
    });
    if (back.error) throw back.error;
    // Premise: the old record is still there.
    const { count } = await ctx.admin.from("trip_departures").select("user_id", { count: "exact", head: true }).eq("trip_id", tripId).eq("user_id", member);
    expect(count).toBe(1);
    const names = await tripDisplayNames(ctx.authedClient("owner"), tripId, [member]);
    expect(names.get(member)).toBe("Back Again");
  });
});

describe("tripMembers.departedNames — for the client name maps", () => {
  it("current members read who has left, by name", async () => {
    const tripId = await departed("procedure", "Biscuit");
    expect(await ctx.caller().tripMembers.departedNames({ tripId })).toEqual([{ userId: member, displayName: "Biscuit" }]);
  });

  it("the departed person cannot read it — the trip has left their list", async () => {
    const tripId = await departed("not theirs", "Biscuit");
    await expect(ctx.callerAs("member").tripMembers.departedNames({ tripId })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: NOT_A_MEMBER_MESSAGE,
    });
  });

  it("CONTROL: a trip nobody has left has none", async () => {
    const tripId = await ctx.createTrip("Departed names none");
    expect(await ctx.caller().tripMembers.departedNames({ tripId })).toEqual([]);
  });
});
