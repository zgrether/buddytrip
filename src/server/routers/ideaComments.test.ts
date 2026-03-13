import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let ideaId: string;

describe("ideaComments router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Comments Test");
    await ctx.addTripMember(tripId, "member", "Member");
    ideaId = genId("idea");
    await ctx.admin.from("ideas").insert({
      id: ideaId,
      trip_id: tripId,
      title: "Test Idea",
      location: "Test Location",
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — any member can comment", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("member");
    const comment = await caller.ideaComments.create({
      tripId,
      ideaId,
      id: genId("comment"),
      text: "Great idea!",
    });
    expect(comment.text).toBe("Great idea!");
    expect(comment.user_id).toBe(member.id);
  });

  it("list — returns comments for an idea", async () => {
    const caller = ctx.caller();
    const comments = await caller.ideaComments.list({ tripId, ideaId });
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments[0].text).toBe("Great idea!");
  });
});
