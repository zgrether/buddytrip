import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { notifyChatMessage } from "../lib/chatNotify";

/**
 * Team chat behaviour — read state, notifications, and history on a team change.
 *
 * The POLICY is tested through PostgREST with real JWTs in
 * `teamChatPolicy.rls.test.ts`, for the reason that file explains at length. This
 * file is the other half: the things the procedures own, which RLS cannot see and
 * a policy test cannot reach.
 *
 * The load-bearing case here is the read-state one. Before migration 172,
 * `chat_reads`'s key was (trip_id, user_id, visibility) and `messages.send`
 * stamps team messages `visibility='crew'` — so a team read row landed on the
 * CREW row and reading Team marked Crew read. That was a property of the key, not
 * a discipline callers had to follow, which is why the test for it asserts two
 * DIFFERENT rooms' marks after touching one.
 *
 * ── Confirmed non-vacuous, and the near-miss is the interesting part ───────
 *
 * `chatRoomReadRow` was mutated to return `{ visibility: "crew", team_id: null }`
 * for every room — the exact pre-172 collapse. 3 failed / 12 passed:
 *     × reading Team does not mark Crew read
 *     × readState reports the team room separately
 *     × viewing CREW does not suppress a TEAM notification
 *
 * What SURVIVED is the part worth writing down: *"someone looking at the team
 * panel is not notified"* still passed, because under the mutant the heartbeat
 * and the gate collapse onto the same row TOGETHER and agree with each other.
 * A suite that checked only same-room suppression would have gone green against
 * a build where Crew and Team share one read row — which is why the
 * cross-room case (view Crew, expect a Team notification anyway) is in here and
 * is the one that actually catches it.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Team Chat Behaviour");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");

  competitionId = await ctx.createCompetition(tripId);
  teamA = await ctx.createTeam(competitionId, "Buddy", { shortName: "BUD" });
  teamB = await ctx.createTeam(competitionId, "Banks", { shortName: "BNK" });

  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: ctx.getUser("member").id, team_id: teamA },
    { competition_id: competitionId, user_id: ctx.getUser("planner").id, team_id: teamB },
  ]);
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function readRows(userId: string) {
  const { data } = await ctx.admin
    .from("chat_reads")
    .select("visibility, team_id, last_read_at, viewing_at")
    .eq("trip_id", tripId)
    .eq("user_id", userId);
  return (data ?? []) as {
    visibility: string;
    team_id: string | null;
    last_read_at: string;
    viewing_at: string | null;
  }[];
}

describe("read state is per-room", () => {
  it("reading Team does not mark Crew read", async () => {
    const member = ctx.callerAs("member");
    const userId = ctx.getUser("member").id;

    await member.messages.markRead({ tripId, visibility: "crew" });
    const crewAfterCrew = (await readRows(userId)).find((r) => r.visibility === "crew")!;
    expect(crewAfterCrew).toBeDefined();

    // A beat, so a mark that DID move is distinguishable from one that did not.
    await new Promise((r) => setTimeout(r, 10));
    await member.messages.markRead({ tripId, visibility: "team", teamId: teamA });

    const rows = await readRows(userId);
    const crew = rows.find((r) => r.visibility === "crew")!;
    const team = rows.find((r) => r.visibility === "team")!;

    // Two rows, not one. Under the old key this was a single row and the
    // assertion below could not even be expressed.
    expect(rows.filter((r) => r.visibility === "crew" || r.visibility === "team")).toHaveLength(2);
    expect(team.team_id).toBe(teamA);
    // The point: Crew's mark is EXACTLY what it was before Team was read.
    expect(crew.last_read_at).toBe(crewAfterCrew.last_read_at);
    expect(team.last_read_at).not.toBe(crew.last_read_at);
  });

  it("readState reports the team room separately", async () => {
    const state = await ctx.callerAs("member").messages.readState({ tripId });
    expect(state.crew).not.toBeNull();
    expect(state.team).not.toBeNull();
    expect(state.team).not.toBe(state.crew);
  });

  it("a member cannot mark a team they are not on as read", async () => {
    await expect(
      ctx.callerAs("member").messages.markRead({ tripId, visibility: "team", teamId: teamB })
    ).rejects.toThrow(/team's members only/i);
  });

  it("a member cannot write a viewing mark for a team they are not on", async () => {
    // Sharper than it looks: viewing_at SUPPRESSES notifications, so a writable
    // mark for someone else's room would be a way to quiet a chat you cannot read.
    await expect(
      ctx.callerAs("member").messages.markViewing({ tripId, visibility: "team", teamId: teamB })
    ).rejects.toThrow(/team's members only/i);
  });

  it("the Owner, on no team, cannot mark any team read", async () => {
    await expect(
      ctx.callerAs("owner").messages.markRead({ tripId, visibility: "team", teamId: teamA })
    ).rejects.toThrow(/team's members only/i);
  });

  it("a team room requires a teamId, and a crew room refuses one", async () => {
    await expect(
      // @ts-expect-error — deliberately omitting the teamId the refine requires
      ctx.callerAs("member").messages.markRead({ tripId, visibility: "team" })
    ).rejects.toThrow();
    await expect(
      ctx.callerAs("member").messages.markRead({ tripId, visibility: "crew", teamId: teamA })
    ).rejects.toThrow();
  });
});

describe("list — the refusal is explicit, not an empty room", () => {
  it("a non-member of the team gets FORBIDDEN, not []", async () => {
    // The whole point: before this, RLS returned [] and an empty team chat and a
    // forbidden one were the same pixels.
    await expect(
      ctx.callerAs("member").messages.list({ tripId, channel: "team", teamId: teamB })
    ).rejects.toThrow(/team's members only/i);
  });

  it("the Owner gets the same refusal", async () => {
    await expect(
      ctx.callerAs("owner").messages.list({ tripId, channel: "team", teamId: teamA })
    ).rejects.toThrow(/team's members only/i);
  });

  it("a team member reads their own room", async () => {
    const id = genId("msg");
    await ctx.admin.from("messages").insert({
      id,
      trip_id: tripId,
      user_id: ctx.getUser("member").id,
      channel: "team",
      team_id: teamA,
      text: "hello team",
      visibility: "crew",
      message_type: "user",
    });
    const rows = await ctx.callerAs("member").messages.list({
      tripId,
      channel: "team",
      teamId: teamA,
    });
    expect(rows.map((r) => r.id)).toContain(id);
    await ctx.admin.from("messages").delete().eq("id", id);
  });
});

describe("history floor on a team change", () => {
  it("someone who joins a team sees nothing from before they joined", async () => {
    // A fresh trip so the outsider's assignment history is clean.
    const t = await ctx.createTrip("Floor Trip");
    await ctx.addTripMember(t, "member", "Member");
    await ctx.addTripMember(t, "planner", "Organizer");
    const comp = await ctx.createCompetition(t);
    const before = await ctx.createTeam(comp, "Before", { shortName: "BEF" });

    await ctx.admin.from("team_assignments").insert({
      competition_id: comp,
      user_id: ctx.getUser("planner").id,
      team_id: before,
    });

    const old = genId("msg");
    await ctx.admin.from("messages").insert({
      id: old,
      trip_id: t,
      user_id: ctx.getUser("planner").id,
      channel: "team",
      team_id: before,
      text: "said before they joined",
      visibility: "crew",
      message_type: "user",
    });

    // The joiner arrives through the real procedure, so the floor is stamped by
    // the code that actually runs rather than by the fixture — a hand-inserted
    // assignment would measure a path the app never takes.
    await new Promise((r) => setTimeout(r, 10));
    await ctx.callerAs("owner").teamAssignments.assign({
      tripId: t,
      competitionId: comp,
      userId: ctx.getUser("member").id,
      teamId: before,
    });

    const after = genId("msg");
    await ctx.admin.from("messages").insert({
      id: after,
      trip_id: t,
      user_id: ctx.getUser("planner").id,
      channel: "team",
      team_id: before,
      text: "said after they joined",
      visibility: "crew",
      message_type: "user",
    });

    const rows = await ctx.callerAs("member").messages.list({
      tripId: t,
      channel: "team",
      teamId: before,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(after);
    expect(ids).not.toContain(old);
  });

  it("a same-team re-assign does NOT move the floor", async () => {
    // The guard against a reorder or captain flip silently wiping history in a
    // room nobody left. Asserts the COLUMN rather than the rendered list,
    // because the list would look identical either way until new messages land.
    const { data: before } = await ctx.admin
      .from("team_assignments")
      .select("team_visible_from")
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("member").id)
      .maybeSingle();

    // Seed a floor via a real assign, then re-assign to the SAME team.
    await ctx.callerAs("owner").teamAssignments.assign({
      tripId,
      competitionId,
      userId: ctx.getUser("member").id,
      teamId: teamA,
    });
    const { data: stamped } = await ctx.admin
      .from("team_assignments")
      .select("team_visible_from")
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("member").id)
      .maybeSingle();

    await new Promise((r) => setTimeout(r, 10));
    await ctx.callerAs("owner").teamAssignments.assign({
      tripId,
      competitionId,
      userId: ctx.getUser("member").id,
      teamId: teamA,
    });
    const { data: afterSame } = await ctx.admin
      .from("team_assignments")
      .select("team_visible_from")
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("member").id)
      .maybeSingle();

    expect(before).not.toBeNull();
    expect(afterSame!.team_visible_from).toBe(stamped!.team_visible_from);
  });
});

describe("notifications follow the crew gate", () => {
  async function notifyTeam(senderRole: "member" | "planner", teamId: string) {
    const id = genId("msg");
    const createdAt = new Date().toISOString();
    await ctx.admin.from("messages").insert({
      id,
      trip_id: tripId,
      user_id: ctx.getUser(senderRole).id,
      channel: "team",
      team_id: teamId,
      text: "team ping",
      visibility: "crew",
      message_type: "user",
    });
    const res = await notifyChatMessage(
      {
        tripId,
        room: { kind: "team", teamId },
        messageId: id,
        messageCreatedAt: createdAt,
        senderId: ctx.getUser(senderRole).id,
      },
      { admin: ctx.admin }
    );
    await ctx.admin.from("messages").delete().eq("id", id);
    return res;
  }

  it("the audience is the TEAM's roster, not the trip's", async () => {
    // Team A holds exactly one person, the sender. So the audience after
    // excluding them is zero — and it is zero because the Owner and the
    // Organizer are NOT on team A, which is the assertion that matters. A
    // role-based audience would have put both of them here.
    const res = await notifyTeam("member", teamA);
    expect(res.audience).toBe(0);
  });

  it("a second member of the team IS notified, and the sender is not", async () => {
    // Put the owner on team B so it has two people, then send as planner.
    await ctx.admin.from("team_assignments").upsert(
      { competition_id: competitionId, user_id: ctx.getUser("owner").id, team_id: teamB },
      { onConflict: "competition_id,user_id" }
    );
    const res = await notifyTeam("planner", teamB);
    expect(res.audience).toBe(1);
    expect(res.eligible).toEqual([ctx.getUser("owner").id]);
    expect(res.eligible).not.toContain(ctx.getUser("planner").id);
    await ctx.admin
      .from("team_assignments")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("owner").id);
  });

  it("someone looking at the team panel is not notified", async () => {
    await ctx.admin.from("team_assignments").upsert(
      { competition_id: competitionId, user_id: ctx.getUser("owner").id, team_id: teamB },
      { onConflict: "competition_id,user_id" }
    );
    // The owner's heartbeat for THIS room. Written through the real procedure so
    // it lands on the room's own row rather than a hand-built one.
    await ctx.callerAs("owner").messages.markViewing({
      tripId,
      visibility: "team",
      teamId: teamB,
    });

    const res = await notifyTeam("planner", teamB);
    expect(res.audience).toBe(1);
    expect(res.eligible).toEqual([]);
    expect(res.suppressedActive).toBe(1);

    await ctx.admin
      .from("team_assignments")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("owner").id);
  });

  it("viewing CREW does not suppress a TEAM notification", async () => {
    // The read-state collision seen from the notification side: if the two rooms
    // still shared a row, having Crew open would silence team chat.
    await ctx.admin.from("team_assignments").upsert(
      { competition_id: competitionId, user_id: ctx.getUser("owner").id, team_id: teamB },
      { onConflict: "competition_id,user_id" }
    );
    // Clear any team viewing mark from the previous case, then view CREW only.
    await ctx.admin
      .from("chat_reads")
      .update({ viewing_at: null })
      .eq("trip_id", tripId)
      .eq("user_id", ctx.getUser("owner").id)
      .eq("visibility", "team");
    await ctx.callerAs("owner").messages.markViewing({ tripId, visibility: "crew" });

    const res = await notifyTeam("planner", teamB);
    expect(res.audience).toBe(1);
    expect(res.eligible).toEqual([ctx.getUser("owner").id]);

    await ctx.admin
      .from("team_assignments")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("owner").id);
  });
});
