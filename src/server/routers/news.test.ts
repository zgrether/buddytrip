import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId, createAnonCaller } from "../../__tests__/helpers/test-setup";
import type { NewsBlock } from "@/lib/news";

let ctx: TestContext;
let tripId: string;

// Insert a post directly (the create procedure lands in PR2; PR1 is read-only).
async function seedPost(opts: {
  authorId: string;
  blocks: NewsBlock[];
  pinned?: boolean;
  createdAt?: string;
}): Promise<string> {
  const id = genId("news");
  const { error } = await ctx.admin.from("news_posts").insert({
    id,
    trip_id: tripId,
    author_id: opts.authorId,
    blocks: opts.blocks,
    pinned: opts.pinned ?? false,
    ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
  });
  if (error) throw new Error(`seedPost failed: ${error.message}`);
  return id;
}

describe("news router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("News Test");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── list ────────────────────────────────────────────────────────────────

  it("list — returns posts pinned-first, then newest-first", async () => {
    const owner = ctx.user.id;
    await seedPost({
      authorId: owner,
      blocks: [{ type: "text", text: "Oldest, unpinned" }],
      createdAt: "2026-01-01T00:00:00Z",
    });
    await seedPost({
      authorId: owner,
      blocks: [{ type: "text", text: "Newest, unpinned" }],
      createdAt: "2026-03-01T00:00:00Z",
    });
    await seedPost({
      authorId: owner,
      blocks: [{ type: "callout", text: "Pinned (older)" }],
      pinned: true,
      createdAt: "2026-02-01T00:00:00Z",
    });

    const posts = await ctx.caller().news.list({ tripId });
    expect(posts.length).toBe(3);
    // Pinned floats above unpinned regardless of its own date…
    expect(posts[0].pinned).toBe(true);
    // …then unpinned in reverse-chronological order.
    expect(posts[1].blocks[0]).toMatchObject({ text: "Newest, unpinned" });
    expect(posts[2].blocks[0]).toMatchObject({ text: "Oldest, unpinned" });
  });

  it("list — blocks round-trip as a typed array", async () => {
    const posts = await ctx.caller().news.list({ tripId });
    const callout = posts.find((p) => p.blocks[0]?.type === "callout");
    expect(callout).toBeTruthy();
    expect(callout!.blocks[0]).toEqual({ type: "callout", text: "Pinned (older)" });
  });

  it("list — any member can read", async () => {
    const posts = await ctx.callerAs("member").news.list({ tripId });
    expect(posts.length).toBe(3);
  });

  it("list — a non-member is forbidden", async () => {
    await expect(
      ctx.callerAs("outsider").news.list({ tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — anonymous callers are unauthorized", async () => {
    await expect(
      createAnonCaller().news.list({ tripId })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // ── readState + markRead ──────────────────────────────────────────────────

  it("readState — null before the member has ever opened news", async () => {
    const state = await ctx.callerAs("member").news.readState({ tripId });
    expect(state.lastReadAt).toBeNull();
  });

  it("markRead — stamps a timestamp the member can read back", async () => {
    const res = await ctx.callerAs("member").news.markRead({ tripId });
    expect(res.lastReadAt).toBeTruthy();
    const state = await ctx.callerAs("member").news.readState({ tripId });
    expect(state.lastReadAt).toBe(res.lastReadAt);
  });

  // ── unreadCount ────────────────────────────────────────────────────────────

  it("unreadCount — excludes the caller's own posts (owner authored all)", async () => {
    const count = await ctx.caller().news.unreadCount({ tripId });
    expect(count).toBe(0);
  });

  it("unreadCount — zero right after the member marks read", async () => {
    await ctx.callerAs("member").news.markRead({ tripId });
    const count = await ctx.callerAs("member").news.unreadCount({ tripId });
    expect(count).toBe(0);
  });

  it("unreadCount — a newer post by someone else bumps the member's count", async () => {
    await ctx.callerAs("member").news.markRead({ tripId });
    await seedPost({
      authorId: ctx.getUser("planner").id,
      blocks: [{ type: "text", text: "Fresh drop" }],
    });
    const count = await ctx.callerAs("member").news.unreadCount({ tripId });
    expect(count).toBe(1);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  it("create — owner can post; it lands in the feed", async () => {
    const post = await ctx.caller().news.create({
      tripId,
      blocks: [{ type: "callout", text: "Heads up" }, { type: "text", text: "Body" }],
      pinned: true,
    });
    expect(post.authorId).toBe(ctx.user.id);
    expect(post.pinned).toBe(true);
    expect(post.blocks).toHaveLength(2);

    const posts = await ctx.caller().news.list({ tripId });
    expect(posts.some((p) => p.id === post.id)).toBe(true);
  });

  it("create — planner can post", async () => {
    const post = await ctx.callerAs("planner").news.create({
      tripId,
      blocks: [{ type: "text", text: "Planner says hi" }],
    });
    expect(post.pinned).toBe(false);
  });

  it("create — a plain member cannot post", async () => {
    await expect(
      ctx.callerAs("member").news.create({
        tripId,
        blocks: [{ type: "text", text: "nope" }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create — rejects an unknown block type (closed set enforced)", async () => {
    await expect(
      ctx.caller().news.create({
        tripId,
        // @ts-expect-error — 'poll' is not one of the six block types
        blocks: [{ type: "poll", options: ["a", "b"] }],
      })
    ).rejects.toThrow();
  });

  it("create — rejects an empty block stack", async () => {
    await expect(
      ctx.caller().news.create({ tripId, blocks: [] })
    ).rejects.toThrow();
  });

  // ── update / setPinned / delete ──────────────────────────────────────────

  it("update — owner edits blocks and pin state", async () => {
    const post = await ctx.caller().news.create({
      tripId,
      blocks: [{ type: "text", text: "v1" }],
    });
    const updated = await ctx.caller().news.update({
      tripId,
      postId: post.id,
      blocks: [{ type: "text", text: "v2 edited" }],
      pinned: true,
    });
    expect(updated.blocks[0]).toMatchObject({ text: "v2 edited" });
    expect(updated.pinned).toBe(true);
  });

  it("update — a member cannot edit", async () => {
    const post = await ctx.caller().news.create({
      tripId,
      blocks: [{ type: "text", text: "owned by owner" }],
    });
    await expect(
      ctx.callerAs("member").news.update({
        tripId,
        postId: post.id,
        blocks: [{ type: "text", text: "hijack" }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("setPinned — toggles pin without resending blocks", async () => {
    const post = await ctx.caller().news.create({
      tripId,
      blocks: [{ type: "text", text: "pin me" }],
    });
    const res = await ctx.caller().news.setPinned({ tripId, postId: post.id, pinned: true });
    expect(res.pinned).toBe(true);
    const posts = await ctx.caller().news.list({ tripId });
    expect(posts.find((p) => p.id === post.id)?.pinned).toBe(true);
  });

  it("delete — owner removes a post; member cannot", async () => {
    const post = await ctx.caller().news.create({
      tripId,
      blocks: [{ type: "text", text: "temporary" }],
    });
    await expect(
      ctx.callerAs("member").news.delete({ tripId, postId: post.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const res = await ctx.caller().news.delete({ tripId, postId: post.id });
    expect(res.id).toBe(post.id);
    const posts = await ctx.caller().news.list({ tripId });
    expect(posts.some((p) => p.id === post.id)).toBe(false);
  });

  // ── roster + competitionDraw (PR3) ────────────────────────────────────────
  // Own trip + competition so the post tests above aren't affected.
  describe("roster + competitionDraw", () => {
    let drawTrip: string;
    let compId: string;
    let teamA: string;
    let teamB: string;

    beforeAll(async () => {
      drawTrip = await ctx.createTrip("Draw Test");
      await ctx.addTripMember(drawTrip, "planner", "Planner");
      await ctx.addTripMember(drawTrip, "member", "Member");
      compId = await ctx.createCompetition(drawTrip);
      teamA = await ctx.createTeam(compId, "The Usual Suspects", { color: "#3b82f6" });
      teamB = await ctx.createTeam(compId, "Buddy's Last Stand", { color: "#2dd4bf" });
      // Owner → A, planner → B; member stays unassigned.
      await ctx.admin.from("team_assignments").insert([
        { competition_id: compId, user_id: ctx.user.id, team_id: teamA },
        { competition_id: compId, user_id: ctx.getUser("planner").id, team_id: teamB },
      ]);
    });

    it("roster — returns every member with name + initials", async () => {
      const people = await ctx.caller().news.roster({ tripId: drawTrip });
      expect(people.length).toBe(3);
      for (const p of people) {
        expect(p.userId).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(p.initials).toMatch(/^[A-Z?]{1,2}$/);
      }
    });

    it("roster — assigned members take their team color; unassigned have none", async () => {
      const people = await ctx.caller().news.roster({ tripId: drawTrip });
      const owner = people.find((p) => p.userId === ctx.user.id);
      const planner = people.find((p) => p.userId === ctx.getUser("planner").id);
      const member = people.find((p) => p.userId === ctx.getUser("member").id);
      expect(owner?.color).toBe("#3b82f6");
      expect(planner?.color).toBe("#2dd4bf");
      // No team assignment → no color (no palette fallback).
      expect(member?.color ?? null).toBeNull();
    });

    it("competitionDraw — returns the teams with their rosters", async () => {
      const draw = await ctx.caller().news.competitionDraw({ tripId: drawTrip });
      expect(draw).not.toBeNull();
      expect(draw!.teams.length).toBe(2);
      const a = draw!.teams.find((t) => t.name === "The Usual Suspects");
      expect(a?.color).toBe("#3b82f6");
      expect(a?.players.length).toBe(1);
    });

    it("competitionDraw — null when the trip has no competition", async () => {
      const plain = await ctx.createTrip("No Comp Trip");
      const draw = await ctx.caller().news.competitionDraw({ tripId: plain });
      expect(draw).toBeNull();
    });

    it("roster — a non-member is forbidden", async () => {
      await expect(
        ctx.callerAs("outsider").news.roster({ tripId: drawTrip })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
