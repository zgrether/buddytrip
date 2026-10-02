import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 202 — the chat history FLOOR is enforced by `messages_select`.
 *
 * The floor used to live only in `messages.list`, which read it without
 * checking the error. A failed read left it NULL ("sees all history"), so a
 * newly added member could be served Crew history from before they joined, and
 * a newly promoted Organizer planning history from before their promotion. A
 * disclosure does not roll back, so the floor now holds in the row policy.
 *
 * These cases read `messages` DIRECTLY through PostgREST with each person's own
 * JWT — the path that never had a floor at all — so they test the POLICY, not
 * the procedure. Each case builds its own trip, seeds one message BEFORE the
 * floor and one AFTER (explicit timestamps, so nothing depends on clocks), and
 * has a control: someone with no floor sees both, so "the old one is hidden" is
 * the floor and not a read that returns nothing.
 */

let ctx: TestContext;

const T_BEFORE = "2026-01-01T00:00:00.000Z";
const T_FLOOR = "2026-02-01T00:00:00.000Z";
const T_AFTER = "2026-03-01T00:00:00.000Z";

async function must(label: string, p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function seedMessage(opts: {
  tripId: string;
  authorId: string;
  createdAt: string;
  visibility?: "crew" | "planning";
  teamId?: string;
  text: string;
}): Promise<string> {
  const id = genId("msg");
  await must("seed message", ctx.admin.from("messages").insert({
    id,
    trip_id: opts.tripId,
    user_id: opts.authorId,
    channel: opts.teamId ? "team" : "trip",
    team_id: opts.teamId ?? null,
    text: opts.text,
    visibility: opts.teamId ? "crew" : opts.visibility ?? "crew",
    message_type: "user",
    created_at: opts.createdAt,
  }));
  return id;
}

/** The texts a person can read in a trip, straight from PostgREST under their own JWT. */
async function visibleTexts(role: "owner" | "planner" | "member", tripId: string): Promise<string[]> {
  const { data, error } = await ctx.authedClient(role).from("messages").select("text").eq("trip_id", tripId);
  if (error) throw new Error(`read messages as ${role}: ${error.message}`);
  return ((data ?? []) as { text: string }[]).map((m) => m.text).sort();
}

async function setFloor(tripId: string, role: "planner" | "member", col: "chat_visible_from" | "planning_visible_from") {
  await must(`set ${col}`, ctx.admin
    .from("trip_members")
    .update({ [col]: T_FLOOR })
    .eq("trip_id", tripId)
    .eq("user_id", ctx.getUser(role).id));
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("messages_select enforces the history floor (migration 202)", () => {
  it("Crew: a member added at the floor cannot read Crew history from before it", async () => {
    const tripId = await ctx.createTrip("Floor crew");
    await ctx.addTripMember(tripId, "member", "Member");
    await setFloor(tripId, "member", "chat_visible_from");
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, text: "before" });
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_AFTER, text: "after" });

    // Control: the owner has no floor and reads both.
    expect(await visibleTexts("owner", tripId)).toEqual(["after", "before"]);
    expect(await visibleTexts("member", tripId)).toEqual(["after"]);
  });

  it("Organizers: a member promoted at the floor cannot read planning from before the promotion", async () => {
    const tripId = await ctx.createTrip("Floor planning");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await setFloor(tripId, "planner", "planning_visible_from");
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, visibility: "planning", text: "plan-before" });
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_AFTER, visibility: "planning", text: "plan-after" });

    expect(await visibleTexts("owner", tripId)).toEqual(["plan-after", "plan-before"]); // control
    expect(await visibleTexts("planner", tripId)).toEqual(["plan-after"]);
  });

  it("the Crew floor does not reach planning, and the planning floor does not reach Crew", async () => {
    // Two columns, two rooms. An Organizer whose PLANNING floor is set still
    // reads all of Crew — a policy that applied one floor to both would fail.
    const tripId = await ctx.createTrip("Floor per room");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await setFloor(tripId, "planner", "planning_visible_from");
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, visibility: "crew", text: "crew-before" });
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, visibility: "planning", text: "plan-before" });

    expect(await visibleTexts("planner", tripId)).toEqual(["crew-before"]);
  });

  it("Team: a member assigned at the floor cannot read that team's history from before it", async () => {
    const tripId = await ctx.createTrip("Floor team");
    await ctx.addTripMember(tripId, "member", "Member");
    const comp = await ctx.createCompetition(tripId, "Floor team cup");
    const team = await ctx.createTeam(comp, "Floor Team");
    // Owner on the team with NO floor (the control); member assigned at the floor.
    await must("seed assignments", ctx.admin.from("team_assignments").insert([
      { competition_id: comp, team_id: team, user_id: ctx.user.id },
      { competition_id: comp, team_id: team, user_id: ctx.getUser("member").id, team_visible_from: T_FLOOR },
    ]));
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, teamId: team, text: "team-before" });
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_AFTER, teamId: team, text: "team-after" });

    expect(await visibleTexts("owner", tripId)).toEqual(["team-after", "team-before"]); // control
    expect(await visibleTexts("member", tripId)).toEqual(["team-after"]);
  });

  it("a person always sees their OWN messages, even from before their floor", async () => {
    // Required by messages.send: it INSERTs and reads the row back in one
    // statement, and the floor is stamped by the app clock while created_at is
    // the database's — without this, a skew of milliseconds could refuse a
    // just-promoted Organizer their own message. Showing someone what they
    // wrote discloses nothing.
    const tripId = await ctx.createTrip("Floor own");
    await ctx.addTripMember(tripId, "member", "Member");
    await setFloor(tripId, "member", "chat_visible_from");
    await seedMessage({ tripId, authorId: ctx.getUser("member").id, createdAt: T_BEFORE, text: "mine-before" });
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, text: "theirs-before" });

    expect(await visibleTexts("member", tripId)).toEqual(["mine-before"]);
  });

  it("messages.send works for someone whose floor is AHEAD of the database clock — the exemption is load-bearing", async () => {
    // The skew case, made deterministic: a floor an hour in the future stands in
    // for an app-server clock running ahead of the database's. `send` inserts
    // and reads the row back in ONE statement, so without the own-message
    // exemption the database's fresh created_at falls below the floor and the
    // send fails. Removing the exemption fails exactly this case.
    const tripId = await ctx.createTrip("Floor skew");
    await ctx.addTripMember(tripId, "member", "Member");
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await must("set future floor", ctx.admin
      .from("trip_members")
      .update({ chat_visible_from: future })
      .eq("trip_id", tripId)
      .eq("user_id", ctx.getUser("member").id));

    const id = genId("skew");
    const sent = await ctx.callerAs("member").messages.send({ tripId, id, channel: "trip", visibility: "crew", text: "just promoted" });
    expect((sent as { id: string }).id).toBe(id);
  });

  it("a member with NO floor (NULL) reads all history — the floor is opt-in per row", async () => {
    const tripId = await ctx.createTrip("Floor null");
    await ctx.addTripMember(tripId, "member", "Member");
    await seedMessage({ tripId, authorId: ctx.user.id, createdAt: T_BEFORE, text: "before" });
    expect(await visibleTexts("member", tripId)).toEqual(["before"]);
  });
});
