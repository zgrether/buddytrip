import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * `messages.list`'s own history-floor read fails CLOSED (#1539).
 *
 * The floor read used to ignore its error, so a failed read left the floor
 * NULL — "sees all history" — and a newly added member could be served Crew
 * history from before they joined. Migration 202 moved the guarantee into the
 * row policy (see `chatHistoryFloor.rls.test.ts`); this is the procedure's half,
 * which now refuses on a failed read rather than leaning on the layer below.
 *
 * Both cases here stand on the PROCEDURE alone, so they hold with or without
 * migration 202 applied.
 */

let ctx: TestContext;

const T_BEFORE = "2026-01-01T00:00:00.000Z";
const T_FLOOR = "2026-02-01T00:00:00.000Z";
const T_AFTER = "2026-03-01T00:00:00.000Z";

async function must(label: string, p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
}

/** A trip with the member added at T_FLOOR, one Crew message before it and one after. */
async function flooredTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Floor read ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await must("set floor", ctx.admin
    .from("trip_members")
    .update({ chat_visible_from: T_FLOOR })
    .eq("trip_id", tripId)
    .eq("user_id", ctx.getUser("member").id));
  for (const [createdAt, text] of [[T_BEFORE, "before"], [T_AFTER, "after"]] as const) {
    await must("seed message", ctx.admin.from("messages").insert({
      id: genId("msg"), trip_id: tripId, user_id: ctx.user.id, channel: "trip", team_id: null,
      text, visibility: "crew", message_type: "user", created_at: createdAt,
    }));
  }
  return tripId;
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("messages.list — the procedure's own floor read fails closed", () => {
  it("CONTROL: real reads — list serves only the history after the floor", async () => {
    const tripId = await flooredTrip("control");
    const rows = (await ctx.callerAs("member").messages.list({ tripId, channel: "trip", visibility: "crew" })) as { text: string }[];
    expect(rows.map((m) => m.text)).toEqual(["after"]);
  });

  it("a FAILED floor read refuses rather than serving all history", async () => {
    const tripId = await flooredTrip("failing");
    const failing = callerFailingRead(ctx, "member", { table: "trip_members", columns: "chat_visible_from" });
    await expect(
      failing.messages.list({ tripId, channel: "trip", visibility: "crew" })
    ).rejects.toThrow("Couldn't check the chat history settings just now. This is temporary — try again in a moment.");
  });
});
