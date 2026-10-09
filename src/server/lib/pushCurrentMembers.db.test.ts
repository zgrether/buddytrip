import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { sendPushToUsers } from "./sendPushToUsers";

/**
 * PR 8d: a TRIP's push goes to that trip's CURRENT members only. Every call site
 * resolves its audience from rows that outlive a membership on purpose (a
 * finished game's participants, a decided match's seats), so the filter lives in
 * `sendPushToUsers`, keyed on `context.tripId` — the one place every trip push
 * passes through.
 *
 * Asserted on `recipients`: the audience after filtering. VAPID is absent in
 * tests, so nothing is delivered, but the count describes who WOULD be — and it
 * is the same number production records to `push_send_log`.
 */

let ctx: TestContext;
let owner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const PAYLOAD = { title: "Final: Test", body: "x", url: "/", tag: "t" };

/** A trip the owner and member are on; the member then LEAVES (removed, with history). */
async function tripWithALeaver(label: string) {
  const tripId = await ctx.createTrip(`Push audience ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const msg = await ctx.admin.from("messages").insert({
    id: genId("msg"), trip_id: tripId, user_id: member, channel: "trip", team_id: null, text: "hi",
  });
  if (msg.error) throw msg.error;
  await ctx.caller().tripMembers.remove({ tripId, userId: member });
  return tripId;
}

describe("a trip push reaches the trip's current members only", () => {
  it("someone who LEFT, and someone never on the trip, are dropped; the member stays", async () => {
    const tripId = await tripWithALeaver("filtered");
    const r = await sendPushToUsers([owner, member, outsider], "game_results", PAYLOAD, {
      admin: ctx.admin,
      context: { trigger: "game_finished", tripId },
    });
    expect(r.error).toBeNull();
    expect(r.recipients).toBe(1); // the owner, alone
  });

  it("CONTROL: a push with no trip in its context is not filtered", async () => {
    const r = await sendPushToUsers([owner, member, outsider], "game_results", PAYLOAD, {
      admin: ctx.admin,
      context: { trigger: "test_send" },
    });
    expect(r.recipients).toBe(3);
  });

  it("a FAILED membership read sends nothing and says why — never the unfiltered audience", async () => {
    const tripId = await tripWithALeaver("failed read");
    const failing = {
      from: (table: string) => {
        if (table !== "trip_members") return ctx.admin.from(table);
        const result = { data: null, error: { message: "simulated read failure" } };
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in"]) builder[m] = () => builder;
        builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
        return builder;
      },
    } as unknown as SupabaseClient;
    const r = await sendPushToUsers([owner, member], "game_results", PAYLOAD, {
      admin: failing,
      context: { trigger: "game_finished", tripId },
    });
    expect(r.recipients).toBe(0);
    expect(r.sent).toBe(0);
    expect(r.error).toMatch(/current members/);
  });
});
